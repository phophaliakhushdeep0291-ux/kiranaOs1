import "dotenv/config";
import { spawnSync } from "node:child_process";
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
runPrisma(["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"]);
if (process.env.SKIP_LOCAL_PRISMA_GENERATE !== "true") {
  runPrisma(["generate", "--generator", "client", "--schema", "prisma/schema.prisma"]);
}
console.log("Local SQLite schema is aligned with prisma/schema.prisma.");
