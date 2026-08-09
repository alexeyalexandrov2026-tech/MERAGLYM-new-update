import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@prisma/client";

type PrismaGlobals = {
  prisma?: PrismaClient;
};

const globalForPrisma = globalThis as typeof globalThis & PrismaGlobals;

function getD1Binding() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    if (ctx?.env?.DB) return ctx.env.DB;
  } catch {
    // Ignore error if context isn't available
  }

  const g = globalThis as unknown as Record<string, unknown>;
  if (g.DB) return g.DB;
  if ((process.env as unknown as Record<string, unknown>).DB) return (process.env as unknown as Record<string, unknown>).DB;

  return undefined;
}

export function createPrismaClient(): PrismaClient {
  const d1 = getD1Binding();
  if (d1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new PrismaD1(d1 as any);
    return new PrismaClient({ adapter });
  }

  return globalForPrisma.prisma ?? new PrismaClient();
}

export function getPrisma(): PrismaClient {
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma ??= createPrismaClient();
    return globalForPrisma.prisma;
  }
  return createPrismaClient();
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma();
    return Reflect.get(client, property, client);
  },
});

export default prisma;
