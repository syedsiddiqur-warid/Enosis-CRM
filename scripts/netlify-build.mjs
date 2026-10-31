// Netlify build: find the database (DATABASE_URL, or the Netlify Database connection), apply migrations,
// set up the workspace on the very first deploy (empty database only), then build the app.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const env = { ...process.env };
if (!env.DATABASE_URL) {
  // Netlify Database (NETLIFY_DB_URL), or the older Netlify DB extension (direct connection, for migrations)
  env.DATABASE_URL = env.NETLIFY_DB_URL || env.NETLIFY_DATABASE_URL_UNPOOLED || env.NETLIFY_DATABASE_URL;
}
if (!env.DATABASE_URL) {
  console.error("No database configured. Create a Netlify Database (Project → Database) or set DATABASE_URL in Site configuration → Environment variables.");
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: "inherit", env });

run("npx prisma migrate deploy");

// First deploy: a brand-new database gets the workspace setup (admin, roles, properties, lists, layouts), no sample data.
// The seed itself refuses to touch a database that already holds records.
const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const users = await db.user.count();
await db.$disconnect();
if (!users) {
  console.log("Empty database: setting up the workspace (no sample data)…");
  run("npx prisma db seed -- --no-sample-data");
}

// New properties, pick lists and follow-up scores from this version (safe to run every deploy)
run("npx tsx scripts/sync-metadata.ts");

run("npx next build");
