interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const parentIdParam = url.searchParams.get("parentId");
  
  let parentId: number | null = null;
  if (parentIdParam !== null && parentIdParam !== "null" && parentIdParam !== "") {
    if (!/^\d+$/.test(parentIdParam)) {
      return Response.json({ error: "Invalid parentId" }, { status: 400 });
    }
    parentId = Number(parentIdParam);
    if (!Number.isSafeInteger(parentId) || parentId <= 0) {
      return Response.json({ error: "Invalid parentId" }, { status: 400 });
    }
  }

  try {
    let stmt;
    if (parentId === null) {
      stmt = env.DB.prepare('SELECT * FROM Node WHERE parentId IS NULL ORDER BY name ASC');
    } else {
      stmt = env.DB.prepare('SELECT * FROM Node WHERE parentId = ? ORDER BY name ASC').bind(parentId);
    }
    const { results } = await stmt.all();

    // Map boolean integers 0/1 back to boolean for JSON schema compatibility
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
    console.error("Error fetching nodes:", error);
    return Response.json({ error: "Internal Server Error", details: String(error) }, { status: 500 });
  }
};
