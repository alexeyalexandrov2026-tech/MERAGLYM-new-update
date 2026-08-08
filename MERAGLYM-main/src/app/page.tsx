import prisma from "@/lib/prisma";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [rootNodes, initialJobs] = await Promise.all([
    prisma.node.findMany({
      where: { parentId: null },
      orderBy: { name: "asc" },
    }),
    prisma.job.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <main>
      <Dashboard initialNodes={rootNodes} initialJobs={initialJobs} />
    </main>
  );
}
