import fs from "fs";
import path from "path";
import process from "process";
import crypto from "crypto";
import { replaySafetyViolations } from "./replay-safety.js";

const root = process.cwd();
const migrationRoot = path.join(root, "prisma-postgres", "migrations");
const allowDestructive = String(process.env.ALLOW_DESTRUCTIVE_MIGRATION || "").toLowerCase() === "true";

const errors = [];
const warnings = [];

// These migrations were both deployed with the 000062 prefix. Prisma keys
// migrations by the complete directory name, so renaming either one breaks
// existing databases even though a fresh database appears healthy.
const immutableHistoricalMigrations = new Map([
  ["000062_bill_discount_reason", "4e683f98814ad0f93949f325086f9534a88d7b5a2547a83e7c88cf491232792d"],
  ["000062_bill_item_hsn_snapshot", "9d9f8794a63074a281530bdf78dc0aecc78a44838f326d06fbdf3844a443b249"],
]);

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function read(file) { return fs.readFileSync(file, "utf8"); }

if (!fs.existsSync(migrationRoot)) {
  fail("Missing prisma-postgres/migrations directory");
} else {
  const migrationDirs = fs.readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();


  for (const [dir, expectedChecksum] of immutableHistoricalMigrations) {
    const sqlFile = path.join(migrationRoot, dir, "migration.sql");
    if (!fs.existsSync(sqlFile)) {
      fail(`Immutable production migration is missing or renamed: ${dir}`);
      continue;
    }
    const checksum = crypto.createHash("sha256").update(fs.readFileSync(sqlFile)).digest("hex");
    if (checksum !== expectedChecksum) fail(`Immutable production migration was modified: ${dir}`);
  }
  if (!migrationDirs.length) fail("No PostgreSQL migration directories found");

  const seenPrefixes = new Set();
  let previousPrefix = 0;
  for (const dir of migrationDirs) {
    const match = dir.match(/^(\d{6})_[a-z0-9_]+$/i);
    if (!match) {
      fail(`Migration directory must use 000001_name format: ${dir}`);
      continue;
    }

    const prefix = Number(match[1]);
    const isHistoricalDuplicate = immutableHistoricalMigrations.has(dir);
    if (seenPrefixes.has(prefix) && !isHistoricalDuplicate) fail(`Duplicate migration numeric prefix: ${match[1]}`);
    seenPrefixes.add(prefix);

    if (previousPrefix && (prefix < previousPrefix || (prefix === previousPrefix && !isHistoricalDuplicate))) {
      fail(`Migration prefixes must be strictly increasing: ${dir}`);
    }
    previousPrefix = prefix;

    const sqlFile = path.join(migrationRoot, dir, "migration.sql");
    if (!fs.existsSync(sqlFile)) {
      fail(`Migration is missing migration.sql: ${dir}`);
      continue;
    }
    const sql = read(sqlFile);
    if (!sql.trim()) fail(`Migration SQL is empty: ${dir}`);

    const destructivePatterns = [
      [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
      [/\bDROP\s+COLUMN\b/i, "DROP COLUMN"],
      [/\bTRUNCATE\b/i, "TRUNCATE"],
      [/\bDELETE\s+FROM\b/i, "DELETE FROM"],
      [/\bALTER\s+TABLE\b[\s\S]*\bALTER\s+COLUMN\b[\s\S]*\bTYPE\b/i, "ALTER COLUMN TYPE"],
    ];
    for (const [pattern, label] of destructivePatterns) {
      if (pattern.test(sql)) {
        const message = `Potentially destructive migration statement found in ${dir}: ${label}`;
        if (allowDestructive) warn(`${message} (allowed by ALLOW_DESTRUCTIVE_MIGRATION=true)`);
        else fail(`${message}. Set ALLOW_DESTRUCTIVE_MIGRATION=true only after backup + restore drill + rollback approval.`);
      }
    }

    if (/ALTER\s+TABLE\s+"\w+"\s+ADD\s+COLUMN\s+"\w+"\s+[^;]*\s+NOT\s+NULL/i.test(sql) && !/DEFAULT/i.test(sql)) {
      fail(`Migration ${dir} adds a NOT NULL column without DEFAULT; this can fail on existing production rows`);
    }

    // Replay-safety: a new migration must be able to self-heal an interrupted
    // deploy (P3009), and a migration that claims @replay-safe must not lie.
    // See scripts/replay-safety.js for the full contract.
    for (const violation of replaySafetyViolations(dir, sql)) fail(violation);
  }

  const expected = [...seenPrefixes].sort((a, b) => a - b);
  for (let i = 0; i < expected.length; i += 1) {
    const want = i + 1;
    if (expected[i] !== want) {
      fail(`Migration numeric prefixes should be contiguous; expected ${String(want).padStart(6, "0")} but found ${String(expected[i]).padStart(6, "0")}`);
      break;
    }
  }
}

for (const message of warnings) console.warn(JSON.stringify({ type: "migration_safety_warning", message }));
if (errors.length) {
  for (const message of errors) console.error(JSON.stringify({ type: "migration_safety_error", message }));
  console.error(JSON.stringify({ type: "migration_safety", status: "failed", errorCount: errors.length }));
  process.exit(1);
}

console.log(JSON.stringify({ type: "migration_safety", status: "passed", warningCount: warnings.length }));
