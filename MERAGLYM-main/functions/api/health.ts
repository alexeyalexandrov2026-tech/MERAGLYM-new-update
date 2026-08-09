interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const { results } = await env.DB.prepare('SELECT 1').all();
    return Response.json({ status: "ok", database: "ok", results });
  } catch (error) {
    return Response.json({ status: "error", database: "unavailable", error: String(error) }, { status: 503 });
  }
};
