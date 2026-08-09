interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return Response.json([]);
  }

  if (query.length > 200) {
    return Response.json({ error: "Query is too long" }, { status: 400 });
  }

  try {
    const pattern = `%${query}%`;
    const { results } = await env.DB.prepare(
      `SELECT * FROM Node 
       WHERE name LIKE ? OR description LIKE ? OR bestFor LIKE ? OR input LIKE ? OR output LIKE ? 
       ORDER BY name ASC LIMIT 100`
    ).bind(pattern, pattern, pattern, pattern, pattern).all();

    const mapped = (results || []).map((row: any) => ({
      ...row,
      localInstall: Boolean(row.localInstall),
      googleDork: Boolean(row.googleDork),
      registration: Boolean(row.registration),
      editUrl: Boolean(row.editUrl),
      api: Boolean(row.api),
      invitationOnly: Boolean(row.invitationOnly),
      deprecated: Boolean(row.deprecated),
    }));

    return Response.json(mapped);
  } catch (error) {
    console.error("Error executing search:", error);
    return Response.json({ error: "Internal Server Error", details: String(error) }, { status: 500 });
  }
};
