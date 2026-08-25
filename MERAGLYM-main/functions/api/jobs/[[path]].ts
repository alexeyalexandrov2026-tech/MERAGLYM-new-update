/**
 * MERAGLYM Production Job Lifecycle Engine
 * Handles:
 * - POST /api/jobs (Create job & execute synchronously against the adapter registry)
 * - GET  /api/jobs (List jobs)
 * - GET  /api/jobs/:id (Get job details)
 * - POST /api/jobs/:id/cancel (Cancel job)
 * - POST /api/jobs/:id/retry (Re-run job synchronously)
 */

import { AdapterRegistry } from "../../../src/lib/adapters/registry";
import type { AdapterResult, ExecutionContext } from "../../../src/lib/adapters/types";

interface Env {
  DB?: D1Database;
  ENVIRONMENT?: string;
  FSSP_API_KEY?: string;
  OPENCTI_URL?: string;
  OPENCTI_TOKEN?: string;
  SPIDERFOOT_SERVER_URL?: string;
  DADATA_API_KEY?: string;
  NUMVERIFY_API_KEY?: string;
}

interface JobRecord {
  id: string;
  type: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | string | null;
  retryCount: number;
  maxRetries: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Cloudflare Pages Functions run on the Workers runtime with a hard wall-clock
// budget per request. There is no background queue consumer in this project
// (Pages Functions cannot run a queue() handler), so every job is executed
// synchronously, in-request, against the local adapter registry below this
// timeout guard.
const EXECUTION_TIMEOUT_MS = 25000;

/** Fallback result for job types with no registered adapter (most catalog
 * entries are manual/external tools that cannot run on the edge). Surfaces
 * as an EXTERNAL_REFERENCE card instead of hanging or erroring. */
function buildExternalReferenceResult(type: string, payload: Record<string, unknown>): AdapterResult {
  const started = new Date().toISOString();
  const query = String(payload.target || payload.phone || payload.inn || payload.email || payload.address || "");
  const sourceUrl = typeof payload.sourceUrl === "string" && payload.sourceUrl.startsWith("http") ? payload.sourceUrl : undefined;
  const sourceName = typeof payload.sourceName === "string" && payload.sourceName ? payload.sourceName : type;

  return {
    success: true,
    adapter: type,
    adapterVersion: "1.0.0",
    startedAt: started,
    completedAt: new Date().toISOString(),
    verified: false,
    confidence: sourceUrl ? 0.6 : 0.3,
    data: {
      target: query,
      mode: "EXTERNAL_REFERENCE",
      sourceName,
      sourceUrl: sourceUrl || null,
      portalTitle: sourceUrl
        ? `Инструмент «${sourceName}» не имеет автоматического серверного адаптера — откройте источник вручную.`
        : `Для типа задачи «${type}» нет зарегистрированного адаптера и внешней ссылки.`,
      instructions: sourceUrl
        ? ["1. Нажмите на ссылку официального источника ниже.", `2. Введите параметры объекта: «${query}».`]
        : [],
    },
    observations: [],
    entities: query ? [{ type: "person", value: query, confidence: 0.3 }] : [],
    relationships: [],
    source: [
      {
        sourceId: "src_no_adapter_fallback",
        sourceType: "EXTERNAL_REFERENCE",
        sourceName,
        sourceUrl,
        url: sourceUrl,
        adapter: type,
        adapterVersion: "1.0.0",
        retrievedAt: started,
        requestId: "n/a",
        verified: false,
      },
    ],
  };
}

async function executeJobNow(
  type: string,
  payload: Record<string, unknown>,
  env: Env
): Promise<{ status: "COMPLETED" | "FAILED"; result: AdapterResult | null; error: Record<string, unknown> | null }> {
  const adapter = AdapterRegistry.get(type);
  const ctx: ExecutionContext = {
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    env: env as unknown as Record<string, unknown>,
  };

  if (!adapter) {
    return { status: "COMPLETED", result: buildExternalReferenceResult(type, payload), error: null };
  }

  try {
    await adapter.validate(payload as never);
  } catch (err) {
    return {
      status: "FAILED",
      result: null,
      error: { code: "VALIDATION_ERROR", message: err instanceof Error ? err.message : "Invalid input for adapter" },
    };
  }

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("ADAPTER_TIMEOUT")), EXECUTION_TIMEOUT_MS)
    );
    const result = await Promise.race([adapter.execute(payload as never, ctx), timeout]);
    return { status: "COMPLETED", result, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Adapter execution failed";
    return {
      status: "FAILED",
      result: null,
      error: { code: message === "ADAPTER_TIMEOUT" ? "TIMEOUT" : "EXECUTION_ERROR", message },
    };
  }
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
            retryCount: Number(row.retryCount || 0),
            maxRetries: Number(row.maxRetries || 3),
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

  // Sub-actions: /api/jobs/:id/cancel or /api/jobs/:id/retry
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
        const retryCount = Number(row.retryCount || 0);
        const maxRetries = Number(row.maxRetries || 3);
        if (retryCount >= maxRetries) {
          return Response.json({ error: { code: "MAX_ATTEMPTS_REACHED", message: `Job ${targetJobId} reached max retries (${maxRetries})` } }, { status: 400 });
        }

        const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload as Record<string, unknown>) || {};
        const now = new Date().toISOString();
        const outcome = await executeJobNow(String(row.type), payload, env);
        const finishedAt = new Date().toISOString();

        await env.DB.prepare(
          `UPDATE Job SET status = ?, result = ?, error = ?, retryCount = retryCount + 1, startedAt = ?, completedAt = ?, updatedAt = ? WHERE id = ?`
        ).bind(
          outcome.status,
          outcome.result ? JSON.stringify(outcome.result) : null,
          outcome.error ? JSON.stringify(outcome.error) : null,
          now,
          finishedAt,
          finishedAt,
          targetJobId
        ).run();

        return Response.json({ status: "ok", message: `Job ${targetJobId} re-executed (attempt ${retryCount + 2})`, jobStatus: outcome.status });
      }
    } catch (err) {
      console.error("Action error", err);
      return Response.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, { status: 500 });
    }
  }

  // Parse request body
  let body: { type?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Malformed JSON payload in request" } }, { status: 400 });
  }

  if (!body.type || typeof body.type !== "string") {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Job 'type' is required (string)" } }, { status: 400 });
  }

  if (!env?.DB) {
    return Response.json({ error: { code: "DB_UNAVAILABLE", message: "D1 database is not bound in this environment" } }, { status: 503 });
  }

  const payload = body.payload || {};
  const startedAt = new Date().toISOString();
  const outcome = await executeJobNow(body.type, payload, env);
  const finishedAt = new Date().toISOString();

  const newJob: JobRecord = {
    id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type: body.type,
    status: outcome.status,
    payload,
    result: (outcome.result as unknown as Record<string, unknown>) || null,
    error: outcome.error,
    retryCount: 0,
    maxRetries: 3,
    startedAt,
    completedAt: finishedAt,
    createdAt: startedAt,
    updatedAt: finishedAt,
  };

  try {
    await env.DB.prepare(
      "INSERT INTO Job (id, type, status, payload, result, error, createdAt, updatedAt, startedAt, completedAt, retryCount, maxRetries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      newJob.id,
      newJob.type,
      newJob.status,
      JSON.stringify(newJob.payload),
      newJob.result ? JSON.stringify(newJob.result) : null,
      newJob.error ? JSON.stringify(newJob.error) : null,
      newJob.createdAt,
      newJob.updatedAt,
      newJob.startedAt,
      newJob.completedAt,
      newJob.retryCount,
      newJob.maxRetries
    ).run();
  } catch (err) {
    console.error("Failed to persist executed job to D1:", err);
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Job executed but failed to persist result" } }, { status: 500 });
  }

  return Response.json(newJob, { status: 200 });
};
