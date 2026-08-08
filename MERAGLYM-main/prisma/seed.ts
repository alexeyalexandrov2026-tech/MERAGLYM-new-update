import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const pool = new Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const existingJob = await prisma.job.findFirst({
    where: {
      type: "ingest_arf",
      status: {
        in: ["PENDING", "RUNNING", "RETRY"],
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (existingJob) {
    console.log(`ETL job ${existingJob.id} already exists; skipping duplicate seed.`);
    return;
  }

  const job = await prisma.job.create({
    data: {
      type: "ingest_arf",
      status: "PENDING",
      payload: {
        file_path:
          "https://raw.githubusercontent.com/lockfale/OSINT-Framework/master/public/arf.json",
      },
    },
  });

  console.log(`Created ETL job ${job.id}.`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
