import fs from "fs";
import path from "path";
import process from "process";

const root = process.cwd();
const migrationRoot = path.join(root, "prisma-postgres", "migrations");
const allowDestructive = String(process.env.ALLOW_DESTRUCTIVE_MIGRATION || "").toLowerCase() === "true";

const errors = [];
const warnings = [];

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
    if (seenPrefixes.has(prefix)) fail(`Duplicate migration numeric prefix: ${match[1]}`);
    seenPrefixes.add(prefix);

    if (previousPrefix && prefix <= previousPrefix) {
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
