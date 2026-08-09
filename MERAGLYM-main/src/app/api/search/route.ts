import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json([]);
  }

  if (query.length > 200) {
    return NextResponse.json({ error: "Query is too long" }, { status: 400 });
  }

  try {
    const nodes = await prisma.node.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { description: { contains: query } },
          { bestFor: { contains: query } },
          { input: { contains: query } },
          { output: { contains: query } },
        ],
      },
      take: 100,
      orderBy: { name: "asc" },
    });

    return NextResponse.json(nodes);
  } catch (error) {
    console.error("Error executing search:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
