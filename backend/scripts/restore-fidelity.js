import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { postgresCliUrl } from "./postgres-url-safety.js";

export function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let size;
    while ((size = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
  } finally { fs.closeSync(handle); }
  return hash.digest("hex");
}

// Sorting fixed-width row hashes makes this independent of physical row order.
// Hashing the entire row catches same-count changes to money, stock, identities,
// dates and the migration ledger without putting their contents in the report.
// A statement timeout bounds the work; a large-table memory/query failure is a
// failed proof, never an incomplete manifest reported as success.
export const FIDELITY_SQL = `
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
DO $kiranaos$
DECLARE item record; counted text; digest text;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('SELECT count(*)::text, encode(sha256(convert_to(COALESCE(string_agg(row_hash, '''' ORDER BY row_hash COLLATE "C"), ''''), ''UTF8'')), ''hex'') FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text, ''UTF8'')), ''hex'') AS row_hash FROM public.%I t) rows', item.tablename) INTO counted, digest;
    INSERT INTO kiranaos_dr_manifest VALUES (item.tablename, counted, digest);
  END LOOP;
END
$kiranaos$;
SELECT jsonb_build_object('tables', COALESCE(jsonb_object_agg(table_name, jsonb_build_object('rows', row_count, 'sha256', content_sha256) ORDER BY table_name), '{}'::jsonb))::text FROM kiranaos_dr_manifest;`;

export function validateManifest(manifest) {
  if (!manifest?.tables || typeof manifest.tables !== "object" || Array.isArray(manifest.tables) || !Object.keys(manifest.tables).length) {
    throw new Error("Restore manifest must contain public tables");
  }
  for (const [table, entry] of Object.entries(manifest.tables)) {
    if (!entry || typeof entry.rows !== "string" || !/^(0|[1-9]\d*)$/.test(entry.rows) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid count or digest in restore manifest for ${table}`);
    }
  }
  return manifest;
}

export function compareRestoreManifests(source, restored, { requireBusinessRows = true } = {}) {
  validateManifest(source);
  validateManifest(restored);
  const tables = [...new Set([...Object.keys(source.tables), ...Object.keys(restored.tables)])].sort();
  const mismatches = tables.filter((table) => {
    const a = source.tables[table];
    const b = restored.tables[table];
    return !a || !b || a.rows !== b.rows || a.sha256 !== b.sha256;
  });
  if (mismatches.length) {
    const error = new Error(`Restore fidelity failed for ${mismatches.length} table(s)`);
    error.code = "RESTORE_FIDELITY_MISMATCH";
    error.details = { tables: mismatches };
    throw error;
  }
  const count = (table) => BigInt(source.tables[table]?.rows || "0");
  if (count("_prisma_migrations") === 0n) throw new Error("Restore manifest has no migration ledger");
  const businessTables = ["Shop", "Product", "Customer", "Bill", "BillItem", "Payment", "UdharLedger"];
  const missingBusinessTables = businessTables.filter((table) => count(table) === 0n);
  if (requireBusinessRows && missingBusinessTables.length) {
    const error = new Error("Restore proof needs non-empty sales, stock, payments and customer balances; an empty schema is insufficient");
    error.code = "RESTORE_WORKLOAD_EMPTY";
    error.details = { tables: missingBusinessTables };
    throw error;
  }
  return {
    tableCount: tables.length,
    totalRows: tables.reduce((sum, table) => sum + count(table), 0n).toString(),
    migrationRows: count("_prisma_migrations").toString(),
    exactMatch: true,
    contentHashesMatched: true,
    businessWorkloadVerified: missingBusinessTables.length === 0,
  };
}

// Keeps the exporting transaction alive until pg_dump has imported its
// snapshot. The source transaction is READ ONLY and never seeds live data.
export async function openPostgresSnapshot(databaseUrl, { timeoutMs = 300_000, binDir = process.env.PG_BIN_DIR } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 900_000) throw new Error("Invalid snapshot timeout");
  const executable = binDir ? path.join(binDir, process.platform === "win32" ? "psql.exe" : "psql") : "psql";
  const child = spawn(executable, ["--dbname", postgresCliUrl(databaseUrl), "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    env: { ...process.env, PGCONNECT_TIMEOUT: "10" },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false,
  });
  let output = "";
  let stderr = "";
  let snapshotId;
  let settled = false;
  let closeResolve;
  const closed = new Promise((resolve) => { closeResolve = resolve; });
  child.on("close", closeResolve);
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PostgreSQL snapshot capture timed out"));
    }, timeoutMs + 10_000);
    const fail = () => {
      clearTimeout(timer);
      if (!settled) reject(new Error(`PostgreSQL snapshot capture failed${stderr ? ": " + stderr.slice(-2000) : ""}`));
    };
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.on("close", fail);
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.length > 4 * 1024 * 1024) {
        child.kill(); fail(); return;
      }
      let newline;
      while ((newline = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, newline).trim();
        output = output.slice(newline + 1);
        if (line.startsWith("SNAPSHOT:")) snapshotId = line.slice(9);
        if (line.startsWith('{"tables"')) {
          try {
            const manifest = validateManifest(JSON.parse(line));
            if (!/^[0-9A-Fa-f-]+$/.test(snapshotId || "")) throw new Error("Invalid exported snapshot identity");
            settled = true;
            clearTimeout(timer);
            resolve({ snapshotId, manifest, close: async () => {
              if (child.exitCode !== null) return;
              child.stdin.end("ROLLBACK;\n\\q\n");
              const stopTimer = setTimeout(() => child.kill(), 5000);
              await closed;
              clearTimeout(stopTimer);
            } });
          } catch (error) { clearTimeout(timer); child.kill(); reject(error); }
        }
      }
    });
  });
  child.stdin.write(`CREATE TEMP TABLE kiranaos_dr_manifest (table_name text PRIMARY KEY, row_count text NOT NULL, content_sha256 text NOT NULL);\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout = ${Math.floor(timeoutMs)};\nSET LOCAL lock_timeout = 10000;\nSELECT 'SNAPSHOT:' || pg_export_snapshot();\n${FIDELITY_SQL}\n`);
  return ready;
}
