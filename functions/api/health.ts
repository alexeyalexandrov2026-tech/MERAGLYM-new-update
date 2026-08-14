interface Env {
  DB?: D1Database;
  AI?: unknown;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  let dbStatus = "simulated_fallback";
  try {
    if (env?.DB) {
      await env.DB.prepare("SELECT 1").all();
      dbStatus = "d1_connected";
    }
  } catch (error) {
    dbStatus = "d1_unavailable";
  }

  const registeredAdapters = [
    "egrul_registry",
    "rfsd_financials",
    "efrsb_bankruptcy",
    "fns_tax",
    "sudrf_courts",
    "mvd_wanted",
    "kad_arbitr",
    "fssp_check",
    "stix_ingest",
    "email_recon",
    "holehe_recon",
    "social_recon",
    "geospatial_mapper",
    "metadata_extractor",
    "crypto_recon",
    "camera_recon",
    "darkweb_mapper",
    "spiderfoot_meta",
    "opencti_connector",
  ];

  return Response.json({
    status: "ok",
    version: "2.5.0",
    platform: "MERAGLYM Open Intelligence",
    database: dbStatus,
    ai_engine: env?.AI ? "cloudflare_workers_ai" : "tactical_osint_core",
    supported_locales: ["en", "ru"],
    total_adapters: registeredAdapters.length,
    cis_adapters: 8,
    global_adapters: 11,
    adapters: registeredAdapters,
    timestamp: new Date().toISOString(),
  });
};
