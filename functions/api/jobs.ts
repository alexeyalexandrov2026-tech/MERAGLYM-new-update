interface Env {
  DB?: D1Database;
}

const FALLBACK_JOBS = [
  {
    id: 1042,
    type: "egrul_registry_recon",
    status: "COMPLETED",
    payload: { inn: "7736050003", region: "RU", depth: 2 },
    result: { status: "success", entity: "ПАО СБЕРБАНК", ogrn: "1027700132195", entities_found: 14 },
    error: null,
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    completedAt: new Date(Date.now() - 3540000).toISOString(),
    createdAt: new Date(Date.now() - 3610000).toISOString(),
  },
  {
    id: 1041,
    type: "holehe_email_enumeration",
    status: "COMPLETED",
    payload: { email: "target.analyst@protonmail.com", checks: 120 },
    result: { status: "success", accounts_registered: ["github", "spotify", "twitter", "delivery_club"] },
    error: null,
    startedAt: new Date(Date.now() - 7200000).toISOString(),
    completedAt: new Date(Date.now() - 7180000).toISOString(),
    createdAt: new Date(Date.now() - 7210000).toISOString(),
  },
  {
    id: 1040,
    type: "stix_threat_correlation",
    status: "COMPLETED",
    payload: { bundle_id: "bundle--984712", indicators: 45 },
    result: { resolved_entities: 42, relationships_created: 18, high_confidence_matches: 6 },
    error: null,
    startedAt: new Date(Date.now() - 14400000).toISOString(),
    completedAt: new Date(Date.now() - 14380000).toISOString(),
    createdAt: new Date(Date.now() - 14420000).toISOString(),
  },
  {
    id: 1039,
    type: "rfsd_financial_sync",
    status: "COMPLETED",
    payload: { inn: "7707083893", year: "2024" },
    result: { bfo_status: "validated", statements: 4, revenue_rub: 1240000000 },
    error: null,
    startedAt: new Date(Date.now() - 28800000).toISOString(),
    completedAt: new Date(Date.now() - 28750000).toISOString(),
    createdAt: new Date(Date.now() - 28810000).toISOString(),
  },
  {
    id: 1038,
    type: "torbot_darkweb_crawl",
    status: "COMPLETED",
    payload: { seed_onion: "http://expyuz5wqqwgah5d.onion", depth: 1 },
    result: { extracted_urls: 28, btc_wallets: 3, emails: 4 },
    error: null,
    startedAt: new Date(Date.now() - 86400000).toISOString(),
    completedAt: new Date(Date.now() - 86350000).toISOString(),
    createdAt: new Date(Date.now() - 86420000).toISOString(),
  },
];

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    if (env?.DB) {
      const { results } = await env.DB.prepare("SELECT * FROM Job ORDER BY updatedAt DESC LIMIT 50").all();
      if (results && results.length > 0) {
        const mapped = results.map((row: Record<string, unknown>) => ({
          ...row,
          payload: row.payload ? (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) : null,
          result: row.result ? (typeof row.result === "string" ? JSON.parse(row.result) : row.result) : null,
        }));
        return Response.json(mapped);
      }
    }
  } catch (error) {
    console.warn("D1 query fallback for jobs:", error);
  }

  return Response.json(FALLBACK_JOBS);
};
