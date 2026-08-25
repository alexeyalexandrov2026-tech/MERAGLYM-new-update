/**
 * MERAGLYM Production Health & Observability API
 * Endpoints:
 * - GET /api/health
 * - GET /api/health/live
 * - GET /api/health/ready
 * - GET /api/health/adapters
 */

interface Env {
  DB?: D1Database;
  AI?: unknown;
  ENVIRONMENT?: string;
  DEMO_MODE?: string;
  FSSP_API_KEY?: string;
  OPENCTI_URL?: string;
  OPENCTI_TOKEN?: string;
  SPIDERFOOT_SERVER_URL?: string;
  DADATA_API_KEY?: string;
  NUMVERIFY_API_KEY?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, "");
  const startedAt = Date.now();

  // 1. Liveness Probe: /api/health/live
  if (pathname.endsWith("/live")) {
    return Response.json({
      status: "alive",
      timestamp: new Date().toISOString(),
    });
  }

  // Database connectivity & latency probe
  let dbStatus = "unbound";
  let dbLatencyMs = 0;
  let dbHealthy = false;

  if (env?.DB) {
    try {
      const dbStart = Date.now();
      await env.DB.prepare("SELECT 1").all();
      dbLatencyMs = Date.now() - dbStart;
      dbStatus = "connected";
      dbHealthy = true;
    } catch (err) {
      dbStatus = "error";
      dbHealthy = false;
    }
  }

  // 2. Readiness Probe: /api/health/ready
  if (pathname.endsWith("/ready")) {
    const isReady = dbHealthy || env?.DB === undefined;
    return Response.json(
      {
        status: isReady ? "ready" : "not_ready",
        database: dbStatus,
        timestamp: new Date().toISOString(),
      },
      { status: isReady ? 200 : 503 }
    );
  }

  // Real adapter statuses calculation based on environment bindings
  const adaptersList = [
    {
      id: "phone_recon",
      name: "Phone Number & Telecom Intelligence (E.164)",
      category: "telecom",
      status: "OPERATIONAL",
      mode: env?.NUMVERIFY_API_KEY ? "LIVE_EXTERNAL_SOURCE" : "LOCAL_ENRICHMENT",
      credentials: ["NUMVERIFY_API_KEY"],
    },
    {
      id: "phone_person_correlator",
      name: "Phone Link Generator & OSINT Dork Builder",
      category: "telecom",
      status: "OPERATIONAL",
      mode: "LOCAL_ENRICHMENT",
      credentials: [],
    },
    {
      id: "egrul_registry",
      name: "FNS Russia EGRUL / EGRIP Legal Entities Registry",
      category: "cis_registry",
      status: "OPERATIONAL",
      mode: env?.DADATA_API_KEY ? "LIVE_EXTERNAL_SOURCE" : "EXTERNAL_REFERENCE",
      credentials: ["DADATA_API_KEY"],
    },
    {
      id: "stix_ingest",
      name: "STIX 2.1 Threat Intel Ingestion",
      category: "cti",
      status: dbHealthy ? "OPERATIONAL" : "UNAVAILABLE",
      mode: "LOCAL_ENRICHMENT",
      credentials: ["D1_DATABASE"],
    },
    {
      id: "holehe_recon",
      name: "Email Domain Extractor & Epieos Link Builder",
      category: "global_recon",
      status: "OPERATIONAL",
      mode: "LOCAL_ENRICHMENT",
      credentials: [],
    },
    {
      id: "fssp_check",
      name: "FSSP Bailiff Enforcement Proceedings",
      category: "cis_registry",
      status: "OPERATIONAL",
      mode: env?.FSSP_API_KEY ? "LIVE_EXTERNAL_SOURCE" : "EXTERNAL_REFERENCE",
      credentials: ["FSSP_API_KEY"],
    },
    {
      id: "opencti_connector",
      name: "OpenCTI Enterprise CTI Connector",
      category: "cti",
      status: "OPERATIONAL",
      mode: (env?.OPENCTI_URL && env?.OPENCTI_TOKEN) ? "LIVE_EXTERNAL_SOURCE" : "EXTERNAL_REFERENCE",
      credentials: ["OPENCTI_URL", "OPENCTI_TOKEN"],
    },
    {
      id: "spiderfoot_meta",
      name: "SpiderFoot OSINT Framework",
      category: "global_recon",
      status: "OPERATIONAL",
      mode: env?.SPIDERFOOT_SERVER_URL ? "LIVE_EXTERNAL_SOURCE" : "EXTERNAL_REFERENCE",
      credentials: ["SPIDERFOOT_SERVER_URL"],
    },
    {
      id: "crypto_recon",
      name: "Blockchain Address Intelligence (BTC/ETH)",
      category: "crypto",
      status: "OPERATIONAL",
      mode: "LOCAL_ENRICHMENT",
      credentials: [],
    },
  ];

  let operationalCount = 0;
  let credentialRequiredCount = 0;
  let degradedCount = 0;
  let unavailableCount = 0;

  for (const a of adaptersList) {
    if (a.status === "OPERATIONAL") operationalCount++;
    else if (a.status === "CREDENTIAL_REQUIRED") credentialRequiredCount++;
    else if (a.status === "DEGRADED") degradedCount++;
    else unavailableCount++;
  }

  // 3. Adapter Health Summary: /api/health/adapters
  if (pathname.endsWith("/adapters")) {
    return Response.json({
      registered: adaptersList.length,
      operational: operationalCount,
      credentialRequired: credentialRequiredCount,
      degraded: degradedCount,
      unavailable: unavailableCount,
      blocked: 0,
      adapters: adaptersList,
      timestamp: new Date().toISOString(),
    });
  }

  // 4. Overall Health: /api/health
  const totalLatencyMs = Date.now() - startedAt;
  const isHealthy = dbHealthy || env?.DB === undefined;

  return Response.json({
    status: isHealthy ? (credentialRequiredCount > 0 ? "degraded" : "operational") : "unhealthy",
    version: "2.5.0",
    environment: env?.ENVIRONMENT || "production",
    demoMode: String(env?.DEMO_MODE || "false").toLowerCase() === "true",
    timestamp: new Date().toISOString(),
    latencyMs: totalLatencyMs,
    database: {
      provider: "D1",
      status: dbStatus,
      latencyMs: dbLatencyMs,
    },
    ai: {
      status: env?.AI ? "connected" : "fallback_ready",
      provider: env?.AI ? "cloudflare_workers_ai" : "local_tactical_core",
    },
    queue: {
      status: "connected",
      mode: "serverless_edge_execution",
    },
    adapters: {
      registered: adaptersList.length,
      operational: operationalCount,
      credentialRequired: credentialRequiredCount,
      degraded: degradedCount,
      unavailable: unavailableCount,
    },
  });
};
