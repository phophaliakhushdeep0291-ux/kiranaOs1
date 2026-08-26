import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import db from "../src/db.js";

const apply = process.argv.includes("--apply");
const keepNames = new Set([
  "Khushi Kirana Store",
  "Sharma Cloth House",
  "Sharma General Store",
  "Verma Kirana Store",
]);

const shops = await db.shop.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
const candidates = shops.filter((shop) => !keepNames.has(shop.name));
const kept = shops.filter((shop) => keepNames.has(shop.name));

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", total: shops.length, remove: candidates.length, keep: kept.length }));
console.log(`Keeping: ${[...new Set(kept.map((shop) => shop.name))].join(", ")}`);

if (!apply) {
  console.log("No data changed. Re-run with --apply after reviewing the preserved names.");
  await db.$disconnect();
  process.exit(0);
}

if (!String(process.env.DATABASE_URL || "").toLowerCase().includes("dev.db")) {
  throw new Error("QA cleanup is restricted to an explicitly configured dev.db");
}

const databasePath = path.resolve(process.cwd(), "prisma", "dev.db");
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const backupPath = path.resolve(process.cwd(), "prisma", `dev.before-qa-cleanup-${stamp}.db`);
fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);

try {
  const deleted = await db.shop.deleteMany({ where: { id: { in: candidates.map((shop) => shop.id) } } });
  const violations = await db.$queryRawUnsafe("PRAGMA foreign_key_check");
  if (violations.length) throw new Error(`Foreign-key verification found ${violations.length} violation(s)`);
  console.log(JSON.stringify({ deleted: deleted.count, backupPath, foreignKeyViolations: 0 }));
} catch (error) {
  console.error(`Cleanup failed; the unchanged backup is available at ${backupPath}`);
  throw error;
} finally {
  await db.$disconnect();
}
