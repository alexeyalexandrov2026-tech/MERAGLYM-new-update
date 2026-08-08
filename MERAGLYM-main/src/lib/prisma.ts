import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

type PrismaGlobals = {
  prisma?: PrismaClient;
  pool?: Pool;
};

const globalForPrisma = globalThis as typeof globalThis & PrismaGlobals;

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required at runtime.");
  }

  const pool =
    globalForPrisma.pool ??
    new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

  const client =
    globalForPrisma.prisma ??
    new PrismaClient({
      adapter: new PrismaPg(pool),
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.pool = pool;
    globalForPrisma.prisma = client;
  }

  return client;
}

let prismaClient: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  prismaClient ??= createPrismaClient();
  return prismaClient;
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma();
    return Reflect.get(client, property, client);
  },
});

export default prisma;
