import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { maskDatabaseUrl } from "./test-db-utils.js";

const databaseUrl = String(process.env.DATABASE_URL || "");
if (!databaseUrl.startsWith("file:")) {
  console.error(`Local SQLite schema update requires a file: DATABASE_URL; received ${maskDatabaseUrl(databaseUrl)}`);
  process.exit(1);
}

const rawPath = decodeURIComponent(databaseUrl.slice("file:".length).split("?")[0]);
const databasePath = path.isAbsolute(rawPath) || /^[A-Za-z]:[\\/]/.test(rawPath)
  ? path.normalize(rawPath)
  : path.resolve(process.cwd(), "prisma", rawPath);
const filename = path.basename(databasePath).toLowerCase();
if (filename.includes("prod") || filename.includes("production") || !filename.endsWith(".db")) {
  console.error(`Refusing local schema update for production-looking or non-SQLite target: ${databasePath}`);
  process.exit(1);
}

const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Updating local SQLite schema at ${maskDatabaseUrl(databaseUrl)} without destructive acceptance flags.`);
// Prisma's SQLite engine on Windows can fail without a useful message when
// the target file does not exist. Create it without truncating existing data.
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
fs.closeSync(fs.openSync(databasePath, "a"));
runPrisma(["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"]);
if (process.env.SKIP_LOCAL_PRISMA_GENERATE !== "true") {
  runPrisma(["generate", "--generator", "client", "--schema", "prisma/schema.prisma"]);
}
// Schema push does not execute SQL migrations. Local shops need the same
// mutation log as test/production databases for incremental device sync.
const triggers = spawnSync(process.execPath, ["scripts/install-sqlite-sync-triggers.js"], {
  cwd: process.cwd(), env: process.env, stdio: "inherit",
});
if (triggers.error) throw triggers.error;
if (triggers.status !== 0) process.exit(triggers.status ?? 1);
console.log("Local SQLite schema is aligned with prisma/schema.prisma.");
