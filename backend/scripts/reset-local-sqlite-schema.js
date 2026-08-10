import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { maskDatabaseUrl } from "./test-db-utils.js";

const databaseUrl = String(process.env.DATABASE_URL || "");
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to reset a local SQLite database while NODE_ENV=production.");
  process.exit(1);
}
if (!databaseUrl.startsWith("file:")) {
  console.error(`Local SQLite reset requires a file: DATABASE_URL; received ${maskDatabaseUrl(databaseUrl)}`);
  process.exit(1);
}

const rawPath = decodeURIComponent(databaseUrl.slice("file:".length).split("?")[0]);
const databasePath = path.isAbsolute(rawPath) || /^[A-Za-z]:[\\/]/.test(rawPath)
  ? path.normalize(rawPath)
  : path.resolve(process.cwd(), "prisma", rawPath);
const filename = path.basename(databasePath).toLowerCase();
if (!new Set(["dev.db", "test.db"]).has(filename)) {
  console.error(`Refusing local reset outside the explicit dev.db/test.db targets: ${databasePath}`);
  process.exit(1);
}

const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const result = spawnSync(process.execPath, [
  prismaCli,
  "db",
  "push",
  "--force-reset",
  "--accept-data-loss",
  "--skip-generate",
  "--schema",
  "prisma/schema.prisma",
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (process.env.SKIP_LOCAL_PRISMA_GENERATE !== "true") {
  const generated = spawnSync(process.execPath, [prismaCli, "generate", "--generator", "client", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (generated.error) throw generated.error;
  if (generated.status !== 0) process.exit(generated.status ?? 1);
}

console.log(`Reset local SQLite schema at ${maskDatabaseUrl(databaseUrl)}.`);
