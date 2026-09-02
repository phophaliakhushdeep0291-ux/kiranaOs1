import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertSafePostgresTestDatabaseUrl } from "../scripts/test-db-utils.js";
import { assertSafeRestoreTarget, postgresCliUrl } from "../scripts/postgres-url-safety.js";
import { openPostgresSnapshot, compareRestoreManifests, sha256File } from "../scripts/restore-fidelity.js";

const sourceUrl = process.env.POSTGRES_TEST_DATABASE_URL;
const restoreUrl = process.env.RESTORE_TEST_DATABASE_URL;
assertSafePostgresTestDatabaseUrl(sourceUrl);
assertSafeRestoreTarget({ sourceUrl, restoreUrl, allowFlag: process.env.ALLOW_RESTORE_TEST_DB === "true" });
const id = `dr-fixture-${crypto.randomUUID()}`;
const artifactDir = path.resolve("release-artifacts", `restore-runtime-${id}`);
fs.mkdirSync(artifactDir, { recursive: true });
const psql = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, process.platform === "win32" ? "psql.exe" : "psql") : "psql";
const env = {
  ...process.env, DATABASE_URL: sourceUrl, DIRECT_DATABASE_URL: sourceUrl,
  NODE_ENV: "test", BACKUP_DIR: artifactDir,
  DATABASE_BACKUP_ENABLED: "false", DATABASE_BACKUP_DISCARD_LOCAL: "false",
  BACKUP_DRY_RUN: "false", ALLOW_MONEY_PAISE_BACKFILL: "false", PROOF_REQUIRE_DR: "true",
};

function sql(url, statement) {
  const result = spawnSync(psql, [postgresCliUrl(url), "-X", "--no-password", "-v", "ON_ERROR_STOP=1", "-qAt"], {
    input: statement, encoding: "utf8", shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function nodeScript(file, extraEnv = {}, expectedExit = 0) {
  const result = spawnSync(process.execPath, [file], { env: { ...env, ...extraEnv }, encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, expectedExit, `${result.stdout}\n${result.stderr}`);
  return result;
}
const q = (name) => `"${name}"`;
function insert(table, row) {
  const values = Object.values(row).map((value) => typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`);
  return `INSERT INTO ${q(table)} (${Object.keys(row).map(q).join(",")}) VALUES (${values.join(",")});`;
}
const money = (fields) => Object.fromEntries(Object.entries(fields).flatMap(([name, paise]) => [[name, paise / 100], [name + "Paise", paise]]));
const fixture = [];
for (const tenant of ["a", "b"]) {
  const shopId = `${id}-${tenant}`;
  fixture.push(insert("Shop", { id: shopId, name: "Synthetic restore shop", ownerName: "Restore fixture", city: "Test city", address: "Test only", updatedAt: "2026-09-02T00:00:00Z" }));
  fixture.push(insert("Product", { id: shopId + "-product", shopId, name: "Synthetic rice", stockBaseQty: 17.5, ...money({ costPerRateUnit: 4000, minPricePerRateUnit: 4000, defaultPricePerRateUnit: 8025 }), updatedAt: "2026-09-02T00:00:00Z" }));
  fixture.push(insert("Customer", { id: shopId + "-customer", shopId, name: "Synthetic buyer", type: "udhar", ...money({ udharAmount: 14050 }), updatedAt: "2026-09-02T00:00:00Z" }));
  fixture.push(insert("Bill", {
    id: shopId + "-bill", shopId, billNo: "DR-001", customerId: shopId + "-customer", customerName: "Synthetic buyer",
    ...money({ subtotal: 24075, discount: 0, gst: 0, grandTotal: 24075, actualAmount: 24075, buyerPaidAmount: 10025, waivedAmount: 0, grossProfit: 12075, paidAmount: 10025, creditAmount: 14050 }),
    updatedAt: "2026-09-02T00:00:00Z",
  }));
  fixture.push(insert("BillItem", {
    id: shopId + "-item", billId: shopId + "-bill", productId: shopId + "-product", name: "Synthetic rice", quantity: 3,
    enteredUnit: "kg", baseUnit: "kg", quantityInBaseUnit: 3, rateUnit: "kg",
    ...money({ ratePerRateUnit: 8025, costPerRateUnit: 4000, lineTotal: 24075, lineCost: 12000, lineProfit: 12075 }),
  }));
  fixture.push(insert("Payment", { id: shopId + "-payment", shopId, billId: shopId + "-bill", mode: "cash", ...money({ amount: 10025 }) }));
  fixture.push(insert("UdharLedger", { id: shopId + "-udhar", shopId, customerId: shopId + "-customer", customerName: "Synthetic buyer", type: "debit", mode: "credit", billId: shopId + "-bill", ...money({ amount: 14050 }), updatedAt: "2026-09-02T00:00:00Z" }));
}

let seeded = false;
let snapshot;
let restored;
try {
  sql(sourceUrl, `BEGIN;\n${fixture.join("\n")}\nCOMMIT;`);
  seeded = true;
  snapshot = await openPostgresSnapshot(sourceUrl);
  // The source advances after the exported snapshot. The backup must still
  // contain the earlier money, not this later one-paise change.
  sql(sourceUrl, `UPDATE "Bill" SET "grandTotal"=240.76, "grandTotalPaise"=24076 WHERE id='${id}-a-bill';`);
  const backupFile = path.join(artifactDir, "snapshot.dump");
  nodeScript("scripts/postgres-backup-create.js", { BACKUP_FILENAME: "snapshot.dump", BACKUP_FORMAT: "custom", BACKUP_SNAPSHOT_ID: snapshot.snapshotId });
  const manifestFile = path.join(artifactDir, "snapshot-manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify({ backup: { sha256: sha256File(backupFile) }, sourceManifest: snapshot.manifest }));
  const expectedManifest = snapshot.manifest;
  await snapshot.close(); snapshot = null;
  nodeScript("scripts/disaster-recovery-proof.js", {
    BACKUP_FILE: backupFile, BACKUP_MANIFEST_FILE: manifestFile, DR_CREATE_BACKUP: "false",
    DR_PROOF_REPORT_PATH: path.join(artifactDir, "snapshot-restore-passed.json"),
  });
  assert.equal(sql(restoreUrl, `SELECT "grandTotalPaise" FROM "Bill" WHERE id='${id}-a-bill';`), "24075");
  assert.equal(sql(sourceUrl, `SELECT "grandTotalPaise" FROM "Bill" WHERE id='${id}-a-bill';`), "24076");

  sql(restoreUrl, `UPDATE "Payment" SET amount=100.26, "amountPaise"=10026 WHERE id='${id}-a-payment';`);
  restored = await openPostgresSnapshot(restoreUrl);
  assert.equal(restored.manifest.tables.Payment.rows, expectedManifest.tables.Payment.rows);
  assert.throws(() => compareRestoreManifests(expectedManifest, restored.manifest), { code: "RESTORE_FIDELITY_MISMATCH" });
  await restored.close(); restored = null;

  const badManifest = path.join(artifactDir, "wrong-checksum.json");
  fs.writeFileSync(badManifest, JSON.stringify({ backup: { sha256: "0".repeat(64) }, sourceManifest: expectedManifest }));
  const rejected = nodeScript("scripts/disaster-recovery-proof.js", {
    BACKUP_FILE: backupFile, BACKUP_MANIFEST_FILE: badManifest, DR_CREATE_BACKUP: "false",
    DR_PROOF_REPORT_PATH: path.join(artifactDir, "checksum-rejected.json"),
  }, 1);
  assert.match(rejected.stdout, /Backup checksum does not match/);
  assert.equal(sql(restoreUrl, `SELECT "amountPaise" FROM "Payment" WHERE id='${id}-a-payment';`), "10026", "invalid backup must not reset the target");

  sql(sourceUrl, `UPDATE "Bill" SET "grandTotal"=240.75, "grandTotalPaise"=24075 WHERE id='${id}-a-bill';`);
  const passedPath = path.join(artifactDir, "fresh-restore-passed.json");
  nodeScript("scripts/disaster-recovery-proof.js", {
    BACKUP_FILE: "", BACKUP_MANIFEST_FILE: "", DR_CREATE_BACKUP: "true", DR_KEEP_BACKUP: "false",
    DR_PROOF_REPORT_PATH: passedPath,
  });
  const report = JSON.parse(fs.readFileSync(passedPath, "utf8"));
  assert.equal(report.status, "passed");
  assert.equal(report.fidelity.businessWorkloadVerified, true);
  assert.equal(report.fidelity.contentHashesMatched, true);
  assert.equal(report.cleanup.generatedBackupRemoved, true);
  console.log(JSON.stringify({
    type: "postgres_restore_runtime_tests", status: "passed", cases: 5, syntheticTenants: 2,
    tests: ["populated multi-tenant restore", "concurrent source writes use exported snapshot", "same-count one-paise corruption rejected", "checksum rejection preserves target", "fresh restore content and read-only money verification"],
    reportPath: passedPath, fidelity: report.fidelity,
  }));
} finally {
  await snapshot?.close();
  await restored?.close();
  if (seeded) {
    const cleanup = ["BillItem", "Payment", "UdharLedger", "Bill", "Customer", "Product", "Shop"].map((table) => `DELETE FROM ${q(table)} WHERE id LIKE '${id}-%';`).join("\n");
    sql(sourceUrl, `BEGIN;\n${cleanup}\nCOMMIT;`);
  }
}
