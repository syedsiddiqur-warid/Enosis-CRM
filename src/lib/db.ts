import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** A hosted DATABASE_URL is kept to a few connections per serverless function, so the connection string can be used
 *  exactly as the provider gives it. */
function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  const u = new URL(url);
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return undefined; // local: Prisma reads it itself
  if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "5");
  if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "15");
  return u.toString();
}

export const db = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: databaseUrl() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
