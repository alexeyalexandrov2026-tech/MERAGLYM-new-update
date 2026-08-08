import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { Node } from "@prisma/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json([]);
  }

  if (query.length > 200) {
    return NextResponse.json({ error: "Query is too long" }, { status: 400 });
  }

  try {
    const nodes = await prisma.$queryRaw<Node[]>`
      SELECT *
      FROM "Node"
      WHERE to_tsvector('simple', name || ' ' || COALESCE(description, ''))
        @@ websearch_to_tsquery('simple', ${query})
      ORDER BY ts_rank(
        to_tsvector('simple', name || ' ' || COALESCE(description, '')),
        websearch_to_tsquery('simple', ${query})
      ) DESC
      LIMIT 100
    `;

    return NextResponse.json(nodes);
  } catch (error) {
    console.error("Error executing search:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
