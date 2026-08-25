/**
 * MERAGLYM Production Job Lifecycle Engine
 * Handles:
 * - POST /api/jobs (Create job & trigger execution)
 * - GET  /api/jobs (List jobs)
 * - GET  /api/jobs/:id (Get job details)
 * - POST /api/jobs/:id/cancel (Cancel job)
 * - POST /api/jobs/:id/retry (Retry job)
 */

interface Env {
  DB?: D1Database;
  ENVIRONMENT?: string;
  FSSP_API_KEY?: string;
  OPENCTI_URL?: string;
  OPENCTI_TOKEN?: string;
  SPIDERFOOT_SERVER_URL?: string;
  MERAGLYM_QUEUE?: Queue;
}

interface JobRecord {
  id: string;
  type: string;
  status: "PENDING" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT" | "CANCELLED" | "RETRYING";
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempt: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string | null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const jobId = pathParts.length > 2 && pathParts[1] === "jobs" ? pathParts[2] : null;

  // Single Job Inspection: GET /api/jobs/:id
  if (jobId) {
    if (env?.DB) {
      try {
        const row = await env.DB.prepare("SELECT * FROM Job WHERE id = ?").bind(jobId).first();
        if (row) {
          return Response.json({
            ...row,
            payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
            result: typeof row.result === "string" ? JSON.parse(row.result) : row.result,
            error: typeof row.error === "string" && (row.error.startsWith("{") || row.error.startsWith("[")) ? JSON.parse(row.error) : row.error,
          });
        }
      } catch (err) {
        console.warn("D1 query error for job id:", err);
      }
    }

    return Response.json(
      { error: { code: "NOT_FOUND", message: `Job ${jobId} not found` } },
      { status: 404 }
    );
  }

  // Jobs List: GET /api/jobs
  const jobsList: JobRecord[] = [];

  if (env?.DB) {
    try {
      const { results } = await env.DB.prepare("SELECT * FROM Job ORDER BY updatedAt DESC LIMIT 50").all();
      if (results && results.length > 0) {
        for (const row of results) {
          jobsList.push({
            id: String(row.id),
            type: String(row.type || "unknown"),
            status: row.status as JobRecord["status"],
            payload: typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload as Record<string, unknown>) || {},
            result: typeof row.result === "string" ? JSON.parse(row.result) : (row.result as Record<string, unknown>) || null,
            error: (row.error as string) || null,
            attempt: Number(row.attempt || 1),
            maxAttempts: Number(row.maxAttempts || 3),
            startedAt: (row.startedAt as string) || null,
            completedAt: (row.completedAt as string) || null,
            createdAt: (row.createdAt as string) || new Date().toISOString(),
            updatedAt: (row.updatedAt as string) || new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.warn("D1 list query failed:", err);
    }
  }

  return Response.json(jobsList);
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);

  // Check for sub-actions: /api/jobs/:id/cancel or /api/jobs/:id/retry
  if (pathParts.length >= 4 && pathParts[1] === "jobs") {
    const targetJobId = pathParts[2];
    const action = pathParts[3];

    if (!env?.DB) {
      return Response.json({ error: { code: "DB_UNAVAILABLE", message: "Database not available" } }, { status: 503 });
    }

    try {
      const row = await env.DB.prepare("SELECT * FROM Job WHERE id = ?").bind(targetJobId).first();
      if (!row) {
        return Response.json({ error: { code: "NOT_FOUND", message: `Job ${targetJobId} not found` } }, { status: 404 });
      }

      if (action === "cancel") {
        await env.DB.prepare("UPDATE Job SET status = 'CANCELLED', updatedAt = ?, completedAt = ? WHERE id = ?")
          .bind(new Date().toISOString(), new Date().toISOString(), targetJobId).run();
        return Response.json({ status: "ok", message: `Job ${targetJobId} cancelled` });
      }

      if (action === "retry") {
        const attempt = Number(row.attempt || 1);
        const maxAttempts = Number(row.maxAttempts || 3);
        if (attempt >= maxAttempts) {
          return Response.json({ error: { code: "MAX_ATTEMPTS_REACHED", message: `Job ${targetJobId} reached max attempts (${maxAttempts})` } }, { status: 400 });
        }
        await env.DB.prepare("UPDATE Job SET status = 'QUEUED', attempt = attempt + 1, error = null, updatedAt = ? WHERE id = ?")
          .bind(new Date().toISOString(), targetJobId).run();
        
        if (env.MERAGLYM_QUEUE) {
          await env.MERAGLYM_QUEUE.send({ jobId: targetJobId, type: row.type });
        }

        return Response.json({ status: "ok", message: `Job ${targetJobId} queued for retry (attempt ${attempt + 1})` });
      }
    } catch (err) {
      console.error("Action error", err);
      return Response.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, { status: 500 });
    }
  }

  // Idempotency check via DB
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey && env?.DB) {
    try {
      const row = await env.DB.prepare("SELECT * FROM Job WHERE idempotencyKey = ?").bind(idempotencyKey).first();
      if (row) {
        return Response.json({
          ...row,
          payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
          result: typeof row.result === "string" ? JSON.parse(row.result) : row.result,
        }, { status: 200 });
      }
    } catch (err) {
      console.warn("Idempotency query failed:", err);
    }
  }

  // Parse request body
  let body: { type?: string; payload?: Record<string, unknown>; timeoutMs?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Malformed JSON payload in request" } }, { status: 400 });
  }

  if (!body.type || typeof body.type !== "string") {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Job 'type' is required (string)" } }, { status: 400 });
  }

  const newJobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const newJob: JobRecord = {
    id: newJobId,
    type: body.type,
    status: "QUEUED",
    payload: body.payload || {},
    result: null,
    error: null,
    attempt: 1,
    maxAttempts: 3,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    idempotencyKey: idempotencyKey || null,
  };

  // Persist to D1 if available
  if (env?.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO Job (id, type, status, payload, result, error, createdAt, updatedAt, startedAt, completedAt, idempotencyKey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        newJob.id,
        newJob.type,
        newJob.status,
        JSON.stringify(newJob.payload),
        newJob.result ? JSON.stringify(newJob.result) : null,
        newJob.error,
        newJob.createdAt,
        newJob.updatedAt,
        newJob.startedAt,
        newJob.completedAt,
        newJob.idempotencyKey
      ).run();

      if (env.MERAGLYM_QUEUE) {
        await env.MERAGLYM_QUEUE.send({ jobId: newJob.id, type: newJob.type });
      }
    } catch (err) {
      console.warn("Failed to persist job to D1 or Queue:", err);
      return Response.json({ error: { code: "INTERNAL_ERROR", message: "Failed to enqueue job" } }, { status: 500 });
    }
  }

  return Response.json(newJob, { status: 202 });
};
