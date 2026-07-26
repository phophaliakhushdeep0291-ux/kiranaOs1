import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase } from "./setup.js";
import { createProduct, createStaff, createTenant, login } from "./factories.js";
import { env } from "../../src/config/env.js";
import {
  cleanupExpiredShopBackups,
  processShopBackupArtifact,
  verifyBackupArtifactForTest,
} from "../../src/modules/backups/backup.service.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("backup integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => {
    await resetDatabase(ctx.db);
    env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  describe("encrypted tenant backups", () => {
    test("creates a checksummed encrypted shop artifact without credentials or cross-tenant data", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const other = await createTenant(ctx.db, { ownerPin: "5678" });
      const ownProduct = await createProduct(ctx.db, tenant.shop.id, { name: "Backup Rice" });
      const otherProduct = await createProduct(ctx.db, other.shop.id, { name: "Other Shop Secret" });      const ledgerRow = await ctx.db.financialLedger.create({ data: {
        shopId: tenant.shop.id,
        sourceType: "backup_reconciliation",
        sourceId: "backup-bank-source",
        entryType: "bank_in",
        direction: "debit",
        amountPaise: 12_300n,
        paymentMode: "bank",
        businessDate: new Date("2026-07-20T12:00:00.000Z"),
        idempotencyKey: "backup-reconciliation-ledger",
      } });
      const statementImport = await ctx.db.bankStatementImport.create({ data: {
        shopId: tenant.shop.id,
        accountType: "bank",
        accountName: "Backup bank evidence",
        fileName: "backup-bank.csv",
        statementFrom: new Date("2026-07-20T12:00:00.000Z"),
        statementTo: new Date("2026-07-20T12:00:00.000Z"),
        rowCount: 1,
        importedCount: 1,
        duplicateCount: 0,
        fingerprint: "backup-import-fingerprint",
      } });
      const statementTransaction = await ctx.db.bankStatementTransaction.create({ data: {
        shopId: tenant.shop.id,
        importId: statementImport.id,
        rowNumber: 2,
        transactionDate: new Date("2026-07-20T12:00:00.000Z"),
        description: "Backup settlement evidence",
        reference: "BACKUP-123",
        direction: "credit",
        amountPaise: 12_300n,
        fingerprint: "backup-transaction-fingerprint",
        matchStatus: "matched",
        reconciledAmountPaise: 12_300n,
      } });
      const allocation = await ctx.db.bankReconciliationAllocation.create({ data: {
        shopId: tenant.shop.id,
        bankStatementTransactionId: statementTransaction.id,
        ledgerRowId: ledgerRow.id,
        amountPaise: 12_300n,
        activeLedgerKey: ledgerRow.id,
        activeBankLedgerKey: `${statementTransaction.id}:${ledgerRow.id}`,
        method: "manual_exact_direction",
        evidenceJson: JSON.stringify({ autoMatched: false }),
      } });
      const reconciliationEvent = await ctx.db.bankReconciliationEvent.create({ data: {
        shopId: tenant.shop.id,
        bankStatementTransactionId: statementTransaction.id,
        action: "match",
        payloadJson: JSON.stringify({ autoMatched: false }),
      } });
      await ctx.db.bankStatementImport.create({ data: {
        shopId: other.shop.id,
        accountType: "bank",
        accountName: "Other Bank Secret",
        fileName: "other-bank.csv",
        statementFrom: new Date("2026-07-20T12:00:00.000Z"),
        statementTo: new Date("2026-07-20T12:00:00.000Z"),
        rowCount: 0,
        importedCount: 0,
        duplicateCount: 0,
        fingerprint: "other-backup-import-fingerprint",
      } });
      const artifact = await ctx.db.backupArtifact.create({
        data: {
          shopId: tenant.shop.id,
          requestedByUserId: tenant.owner.id,
          type: "shop_logical",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const completed = await processShopBackupArtifact(artifact.id, tenant.shop.id);
      assert.equal(completed.status, "completed");
      assert.equal(completed.format, "kiranaos_aes256gcm_gzip_v1");
      assert.equal(completed.checksum_sha256.length, 64);
      assert.ok(BigInt(completed.size_bytes) > 0n);
      assert.ok(completed.record_count > 0);

      const snapshot = await verifyBackupArtifactForTest(tenant.shop.id, artifact.id);
      assert.equal(snapshot.manifest.shopId, tenant.shop.id);
      assert.equal(snapshot.manifest.credentialsExcluded.includes("passwordHash"), true);
      assert.equal(snapshot.data.products.some((row) => row.id === ownProduct.id), true);
      assert.equal(snapshot.data.products.some((row) => row.id === otherProduct.id), false);      assert.equal(snapshot.data.bankStatementImports.some((row) => row.id === statementImport.id), true);
      assert.equal(snapshot.data.bankStatementTransactions.some((row) => row.id === statementTransaction.id), true);
      assert.equal(snapshot.data.bankReconciliationAllocations.some((row) => row.id === allocation.id), true);
      assert.equal(snapshot.data.bankReconciliationEvents.some((row) => row.id === reconciliationEvent.id), true);
      const serialized = JSON.stringify(snapshot);
      assert.equal(serialized.includes("passwordHash"), true, "manifest documents intentional credential exclusion");
      assert.equal(serialized.includes(tenant.owner.passwordHash), false, "credential hashes are never present in the artifact");
      assert.equal(serialized.includes("Other Shop Secret"), false, "another tenant's data is never present");
      assert.equal(serialized.includes("Other Bank Secret"), false, "another tenant's statement evidence is never present");
    });

    test("expired backup cleanup deletes the object but preserves auditable metadata", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const artifact = await ctx.db.backupArtifact.create({
        data: {
          shopId: tenant.shop.id,
          requestedByUserId: tenant.owner.id,
          type: "shop_logical",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await processShopBackupArtifact(artifact.id, tenant.shop.id);
      await ctx.db.backupArtifact.update({
        where: { id: artifact.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const cleanup = await cleanupExpiredShopBackups({ limit: 10 });
      assert.equal(cleanup.cleaned, 1);
      const expired = await ctx.db.backupArtifact.findUnique({ where: { id: artifact.id } });
      assert.equal(expired.status, "expired");
      assert.equal(expired.objectKey, null);
      assert.equal(expired.checksumSha256.length, 64, "checksum metadata survives object expiry");
    });

    test("owner backup routes enforce PIN, role, tenant scope, audit, and protected download", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      await createProduct(ctx.db, tenant.shop.id, { name: "Route Backup Product" });
      const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);

      const withoutPin = await ctx.post("/api/jobs/backups", {}, { token: ownerAuth.accessToken });
      assert.equal(withoutPin.status, 403, "creating a portable data artifact requires owner PIN");

      const createdResponse = await ctx.post(
        "/api/jobs/backups",
        {},
        { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
      );
      assert.equal(createdResponse.status, 202, JSON.stringify(createdResponse.body));
      const created = createdResponse.body.data.backup;
      assert.equal(created.status, "completed", "development mode safely executes inline when Redis is disabled");

      const listed = await ctx.get("/api/jobs/backups", { token: ownerAuth.accessToken });
      assert.equal(listed.status, 200);
      assert.equal(listed.body.data.backups[0].id, created.id);
      assert.equal("objectKey" in listed.body.data.backups[0], false, "storage keys are never exposed by list API");

      const downloadDenied = await ctx.get(
        `/api/jobs/backups/${created.id}/download`,
        { token: ownerAuth.accessToken },
      );
      assert.equal(downloadDenied.status, 403);
      const downloaded = await ctx.get(
        `/api/jobs/backups/${created.id}/download`,
        { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
      );
      assert.equal(downloaded.status, 200);
      assert.equal(downloaded.text.startsWith("KOSB1"), true, "protected download returns the encrypted backup envelope");

      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const staffDenied = await ctx.get("/api/jobs/backups", { token: staffAuth.accessToken });
      assert.equal(staffDenied.status, 403, "cashiers cannot list portable shop backups");

      const other = await createTenant(ctx.db, { ownerPin: "5678" });
      const otherAuth = await login(ctx, other.ownerMobile, other.ownerPassword);
      const otherList = await ctx.get("/api/jobs/backups", { token: otherAuth.accessToken });
      assert.equal(otherList.status, 200);
      assert.equal(otherList.body.data.backups.length, 0, "backup metadata never crosses shop boundaries");

      const auditActions = await ctx.db.auditLog.findMany({
        where: { shopId: tenant.shop.id, entityId: created.id },
        select: { action: true },
      });
      assert.deepEqual(
        new Set(auditActions.map((row) => row.action)),
        new Set(["SHOP_BACKUP_REQUESTED", "SHOP_BACKUP_COMPLETED", "SHOP_BACKUP_DOWNLOADED"]),
      );
    });

    test("a duplicate worker cannot process the same backup artifact concurrently", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const artifact = await ctx.db.backupArtifact.create({
        data: {
          shopId: tenant.shop.id,
          requestedByUserId: tenant.owner.id,
          type: "shop_logical",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      const attempts = await Promise.allSettled([
        processShopBackupArtifact(artifact.id, tenant.shop.id),
        processShopBackupArtifact(artifact.id, tenant.shop.id),
      ]);
      const fulfilled = attempts.filter((result) => result.status === "fulfilled");
      const rejected = attempts.filter((result) => result.status === "rejected");
      assert.ok(fulfilled.length >= 1, "one worker must complete the artifact");
      assert.ok(
        rejected.length === 0 || rejected.every((result) => result.reason.code === "BACKUP_IN_PROGRESS"),
        "a truly concurrent duplicate is rejected; a later duplicate returns the idempotent completed result",
      );
      assert.ok(fulfilled.every((result) => result.value.status === "completed"));
      const stored = await ctx.db.backupArtifact.findUnique({ where: { id: artifact.id } });
      assert.equal(stored.status, "completed");
      const completionAudits = await ctx.db.auditLog.count({
        where: { shopId: tenant.shop.id, entityId: artifact.id, action: "SHOP_BACKUP_COMPLETED" },
      });
      assert.equal(completionAudits, 1, "duplicate delivery can write the artifact and completion audit only once");
    });
  });
}
