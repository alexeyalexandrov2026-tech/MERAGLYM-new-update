import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const parentIdParam = request.nextUrl.searchParams.get("parentId");
  let parentId: number | null = null;

  if (parentIdParam !== null && parentIdParam !== "null" && parentIdParam !== "") {
    if (!/^\d+$/.test(parentIdParam)) {
      return NextResponse.json({ error: "Invalid parentId" }, { status: 400 });
    }

    parentId = Number(parentIdParam);
    if (!Number.isSafeInteger(parentId) || parentId <= 0) {
      return NextResponse.json({ error: "Invalid parentId" }, { status: 400 });
    }
  }

  try {
    const nodes = await prisma.node.findMany({
      where: { parentId },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(nodes);
  } catch (error) {
    console.error("Error fetching nodes:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
