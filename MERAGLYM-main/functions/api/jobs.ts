interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM Job ORDER BY updatedAt DESC LIMIT 50').all();
    const mapped = (results || []).map((row: any) => ({
      ...row,
      payload: row.payload ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) : null,
      result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : null,
    }));
    return Response.json(mapped);
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return Response.json({ error: "Internal Server Error", details: String(error) }, { status: 500 });
  }
};
