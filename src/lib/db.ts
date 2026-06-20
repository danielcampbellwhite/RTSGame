import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Reuse a single PrismaClient across hot-reloads / serverless invocations.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "";
  const log: ("error" | "warn")[] = process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

  // Neon over its serverless driver (WebSocket/HTTP on 443). This is the
  // recommended path for serverless/Vercel and is required in any environment
  // where the raw Postgres port (5432) isn't reachable.
  if (url.includes("neon.tech")) {
    // In Node (scripts, server runtime) the driver needs a WebSocket impl.
    if (typeof WebSocket === "undefined") neonConfig.webSocketConstructor = ws;
    const adapter = new PrismaNeon({ connectionString: url });
    return new PrismaClient({ adapter, log });
  }

  return new PrismaClient({ log });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
