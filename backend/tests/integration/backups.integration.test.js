import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase } from "./setup.js";
import { createProduct, createStaff, createTenant, login } from "./factories.js";
import { env } from "../../src/config/env.js";
import {
  __backupInternals,
  cleanupExpiredShopBackups,
  openShopBackup,
  previewShopBackupRestore,
  processShopBackupArtifact,
  restoreShopBackup,
  verifyBackupArtifactForTest,
} from "../../src/modules/backups/backup.service.js";
import { acquireShopMaintenanceLock, releaseShopMaintenanceLock } from "../../src/modules/backups/maintenance-lock.service.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("backup integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => {
    await resetDatabase(ctx.db);
    env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  describe("encrypted tenant backups", { concurrency: false }, () => {
    test("creates a checksummed encrypted shop artifact without credentials or cross-tenant data", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const other = await createTenant(ctx.db, { ownerPin: "5678" });
      const ownProduct = await createProduct(ctx.db, tenant.shop.id, { name: "Backup Rice" });
      const otherProduct = await createProduct(ctx.db, other.shop.id, { name: "Other Shop Secret" });
      const ownTallyPost = await ctx.db.tallyPost.create({ data: {
        shopId: tenant.shop.id,
        documentType: "sale",
        documentId: "backup-own-sale",
        voucherNumber: "SALE-BACKUP-OWN",
        remoteId: "kiranaos-backup-own-sale",
      } });
      const otherTallyPost = await ctx.db.tallyPost.create({ data: {
        shopId: other.shop.id,
        documentType: "sale",
        documentId: "backup-other-sale",
        voucherNumber: "SALE-BACKUP-OTHER",
        remoteId: "kiranaos-backup-other-sale",
      } });
      const ledgerRow = await ctx.db.financialLedger.create({ data: {
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
      assert.equal(snapshot.manifest.dataLayout, "flat_prisma_tables_v2");
      assert.equal(snapshot.data.tables.Product.some((row) => row.id === ownProduct.id), true);
      assert.equal(snapshot.data.tables.Product.some((row) => row.id === otherProduct.id), false);
      assert.equal(snapshot.data.tables.BankStatementImport.some((row) => row.id === statementImport.id), true);
      assert.equal(snapshot.data.tables.BankStatementTransaction.some((row) => row.id === statementTransaction.id), true);
      assert.equal(snapshot.data.tables.BankReconciliationAllocation.some((row) => row.id === allocation.id), true);
      assert.equal(snapshot.data.tables.BankReconciliationEvent.some((row) => row.id === reconciliationEvent.id), true);
      assert.equal(snapshot.data.tables.TallyPost.some((row) => row.id === ownTallyPost.id), true);
      assert.equal(snapshot.data.tables.TallyPost.some((row) => row.id === otherTallyPost.id), false);
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

    test("refuses to download a backup whose stored envelope no longer matches its checksum", async () => {
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
        data: { checksumSha256: "0".repeat(64) },
      });

      await assert.rejects(
        () => openShopBackup(tenant.shop.id, artifact.id),
        (error) => error?.code === "BACKUP_CHECKSUM_MISMATCH" && error?.statusCode === 409,
      );
    });

    test("restore preview validates tenant, schema, structure, and record counts without changing data", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      await createProduct(ctx.db, tenant.shop.id, { name: "Restore Preview Rice" });
      const artifact = await ctx.db.backupArtifact.create({
        data: {
          shopId: tenant.shop.id,
          requestedByUserId: tenant.owner.id,
          type: "shop_logical",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await processShopBackupArtifact(artifact.id, tenant.shop.id);
      const before = await ctx.db.product.count({ where: { shopId: tenant.shop.id } });
      const preview = await previewShopBackupRestore(tenant.shop.id, artifact.id);
      assert.equal(preview.restorable, true);
      assert.equal(preview.table_counts.Product, 1);
      assert.equal(preview.credentials_preserved, true);
      assert.ok(preview.record_count >= 1);
      assert.equal(await ctx.db.product.count({ where: { shopId: tenant.shop.id } }), before, "preview is read-only");

      const other = await createTenant(ctx.db, { ownerPin: "5678" });
      await assert.rejects(
        () => previewShopBackupRestore(other.shop.id, artifact.id),
        (error) => error?.code === "BACKUP_ARTIFACT_NOT_FOUND" && error?.statusCode === 404,
      );
    });

    test("transactionally restores business data, preserves credentials, creates recovery backup, and releases maintenance lock", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Before Restore", stockBaseQty: 7 });
      const tallyPost = await ctx.db.tallyPost.create({ data: {
        shopId: tenant.shop.id,
        documentType: "sale",
        documentId: "sale-before-restore",
        voucherNumber: "SALE-BEFORE-RESTORE",
        remoteId: "kiranaos-sale-before-restore",
      } });
      const device = await ctx.db.device.create({ data: { shopId: tenant.shop.id, userId: tenant.owner.id, deviceId: "restore-stale-device", status: "active", dataEpoch: 0 } });
      const artifact = await ctx.db.backupArtifact.create({ data: {
        shopId: tenant.shop.id, requestedByUserId: tenant.owner.id, type: "shop_logical",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      } });
      await processShopBackupArtifact(artifact.id, tenant.shop.id);
      const ownerBefore = await ctx.db.user.findUnique({ where: { id: tenant.owner.id }, select: { passwordHash: true, pinHash: true } });
      await ctx.db.product.update({ where: { id: product.id }, data: { name: "Changed Later", stockBaseQty: 99 } });
      await createProduct(ctx.db, tenant.shop.id, { name: "Created Later" });
      await ctx.db.tallyPost.delete({ where: { id: tallyPost.id } });
      await ctx.db.tallyPost.create({ data: {
        shopId: tenant.shop.id,
        documentType: "sale",
        documentId: "sale-created-later",
        voucherNumber: "SALE-CREATED-LATER",
        remoteId: "kiranaos-sale-created-later",
      } });

      const restored = await restoreShopBackup(tenant.shop.id, artifact.id, tenant.owner.id, `RESTORE ${artifact.id.slice(-6)}`);
      assert.ok(restored.restoredRecords > 0);
      assert.equal(restored.recovery_backup.status, "completed");
      assert.notEqual(restored.recovery_backup.id, artifact.id);
      const products = await ctx.db.product.findMany({ where: { shopId: tenant.shop.id }, orderBy: { name: "asc" } });
      assert.deepEqual(products.map((row) => row.name), ["Before Restore"]);
      assert.equal(products[0].stockBaseQty, 7);
      const restoredTallyPosts = await ctx.db.tallyPost.findMany({ where: { shopId: tenant.shop.id } });
      assert.deepEqual(restoredTallyPosts.map((row) => row.id), [tallyPost.id], "Tally idempotency history is restored so vouchers cannot be posted twice");
      const ownerAfter = await ctx.db.user.findUnique({ where: { id: tenant.owner.id }, select: { passwordHash: true, pinHash: true } });
      assert.deepEqual(ownerAfter, ownerBefore, "password and PIN hashes remain installation-controlled");
      const epochState = await ctx.db.shop.findUnique({ where: { id: tenant.shop.id }, select: { dataEpoch: true } });
      const staleDevice = await ctx.db.device.findUnique({ where: { id: device.id }, select: { dataEpoch: true } });
      assert.equal(epochState.dataEpoch, 1);
      assert.equal(staleDevice.dataEpoch, 0, "preserved devices remain stale until explicit rebootstrap");
      assert.equal(await ctx.db.shopMaintenanceLock.count({ where: { shopId: tenant.shop.id } }), 0, "lock releases after success");
    });

    test("restores the complete manufacturing genealogy without losing recall evidence", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const finished = await createProduct(ctx.db, tenant.shop.id, { name: "Finished Spice" });
      const material = await createProduct(ctx.db, tenant.shop.id, { name: "Raw Spice" });
      const bom = await ctx.db.manufacturingBom.create({ data: {
        shopId: tenant.shop.id,
        finishedProductId: finished.id,
        name: "Backup recipe",
        outputQuantityBaseQty: 10,
      } });
      const bomItem = await ctx.db.manufacturingBomItem.create({ data: {
        shopId: tenant.shop.id,
        bomId: bom.id,
        materialProductId: material.id,
        quantityBaseQty: 11,
        wastagePercent: 2,
      } });
      const run = await ctx.db.productionRun.create({ data: {
        shopId: tenant.shop.id,
        locationId: "backup-manufacturing-location",
        bomId: bom.id,
        runNumber: "RUN-BACKUP-001",
        status: "completed",
        plannedOutputBaseQty: 10,
        actualOutputBaseQty: 9.8,
        finishedBatchNumber: "FG-BACKUP-001",
        qcStatus: "passed",
      } });
      const consumption = await ctx.db.productionConsumption.create({ data: {
        shopId: tenant.shop.id,
        runId: run.id,
        productId: material.id,
        plannedBaseQty: 11,
        actualBaseQty: 10.8,
        sourceBatchNumber: "RM-BACKUP-001",
      } });
      const output = await ctx.db.productionOutput.create({ data: {
        shopId: tenant.shop.id,
        runId: run.id,
        productId: finished.id,
        quantityBaseQty: 9.8,
        batchNumber: "FG-BACKUP-001",
      } });
      const artifact = await ctx.db.backupArtifact.create({ data: {
        shopId: tenant.shop.id,
        requestedByUserId: tenant.owner.id,
        type: "shop_logical",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      } });

      await processShopBackupArtifact(artifact.id, tenant.shop.id);
      const snapshot = await verifyBackupArtifactForTest(tenant.shop.id, artifact.id);
      assert.equal(snapshot.data.tables.ManufacturingBom.some((row) => row.id === bom.id), true);
      assert.equal(snapshot.data.tables.ManufacturingBomItem.some((row) => row.id === bomItem.id), true);
      assert.equal(snapshot.data.tables.ProductionRun.some((row) => row.id === run.id), true);
      assert.equal(snapshot.data.tables.ProductionConsumption.some((row) => row.id === consumption.id), true);
      assert.equal(snapshot.data.tables.ProductionOutput.some((row) => row.id === output.id), true);

      await ctx.db.productionOutput.deleteMany({ where: { shopId: tenant.shop.id } });
      await ctx.db.productionConsumption.deleteMany({ where: { shopId: tenant.shop.id } });
      await ctx.db.productionRun.deleteMany({ where: { shopId: tenant.shop.id } });
      await ctx.db.manufacturingBomItem.deleteMany({ where: { shopId: tenant.shop.id } });
      await ctx.db.manufacturingBom.deleteMany({ where: { shopId: tenant.shop.id } });

      const confirmation = "RESTORE " + artifact.id.slice(-6);
      await restoreShopBackup(tenant.shop.id, artifact.id, tenant.owner.id, confirmation);

      assert.deepEqual((await ctx.db.manufacturingBom.findMany({ where: { shopId: tenant.shop.id }, select: { id: true } })).map((row) => row.id), [bom.id]);
      assert.deepEqual((await ctx.db.manufacturingBomItem.findMany({ where: { shopId: tenant.shop.id }, select: { id: true } })).map((row) => row.id), [bomItem.id]);
      assert.deepEqual((await ctx.db.productionRun.findMany({ where: { shopId: tenant.shop.id }, select: { id: true } })).map((row) => row.id), [run.id]);
      assert.deepEqual((await ctx.db.productionConsumption.findMany({ where: { shopId: tenant.shop.id }, select: { id: true } })).map((row) => row.id), [consumption.id]);
      assert.deepEqual((await ctx.db.productionOutput.findMany({ where: { shopId: tenant.shop.id }, select: { id: true } })).map((row) => row.id), [output.id]);
    });
    test("restores wholesale and export order allocation and dispatch evidence", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const order = await ctx.db.tradeOrder.create({ data: {
        shopId: tenant.shop.id,
        locationId: "backup-trade-location",
        orderNumber: "EXPORT-BACKUP-001",
        customerName: "Backup Export Buyer",
        orderType: "export",
        currencyCode: "USD",
        exchangeRate: 83.5,
        status: "dispatched",
        countryOfDestination: "AE",
      } });
      const item = await ctx.db.tradeOrderItem.create({ data: {
        shopId: tenant.shop.id,
        orderId: order.id,
        productId: "backup-finished-product",
        description: "Finished spice carton",
        quantity: 10,
        quantityBaseQty: 100,
        unitPrice: 20,
        lineTotal: 200,
        packedQuantity: 10,
      } });
      const allocation = await ctx.db.tradeOrderAllocation.create({ data: {
        shopId: tenant.shop.id,
        orderItemId: item.id,
        inventoryLotId: "backup-finished-lot",
        batchNumber: "FG-BACKUP-001",
        quantityBaseQty: 100,
      } });
      const dispatch = await ctx.db.tradeDispatch.create({ data: {
        shopId: tenant.shop.id,
        orderId: order.id,
        dispatchNumber: "DSP-BACKUP-001",
        dispatchDate: new Date("2026-08-13T00:00:00.000Z"),
        transporterName: "Backup Transport",
        shippingBillNumber: "SB-BACKUP-001",
      } });
      const artifact = await ctx.db.backupArtifact.create({ data: {
        shopId: tenant.shop.id,
        requestedByUserId: tenant.owner.id,
        type: "shop_logical",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      } });

      await processShopBackupArtifact(artifact.id, tenant.shop.id);
      const snapshot = await verifyBackupArtifactForTest(tenant.shop.id, artifact.id);
      assert.equal(snapshot.data.tables.TradeOrder.some((row) => row.id === order.id), true);
      assert.equal(snapshot.data.tables.TradeOrderItem.some((row) => row.id === item.id), true);
      assert.equal(snapshot.data.tables.TradeOrderAllocation.some((row) => row.id === allocation.id), true);
      assert.equal(snapshot.data.tables.TradeDispatch.some((row) => row.id === dispatch.id), true);

      await ctx.db.tradeDispatch.deleteMany({ where: { shopId: tenant.shop.id } });
      await ctx.db.tradeOrderAllocation.deleteMany({ where: { shopId: tenant.shop.id } });
      await ctx.db.tradeOrderItem.deleteMany({ where: { shopId: tenant.shop.id } });
      await ctx.db.tradeOrder.deleteMany({ where: { shopId: tenant.shop.id } });

      await restoreShopBackup(
        tenant.shop.id,
        artifact.id,
        tenant.owner.id,
        `RESTORE ${artifact.id.slice(-6)}`,
      );

      assert.deepEqual((await ctx.db.tradeOrder.findMany({ where: { shopId: tenant.shop.id }, select: { id: true } })).map((row) => row.id), [order.id]);
      assert.deepEqual((await ctx.db.tradeOrderItem.findMany({ where: { shopId: tenant.shop.id }, select: { id: true } })).map((row) => row.id), [item.id]);
      assert.deepEqual((await ctx.db.tradeOrderAllocation.findMany({ where: { shopId: tenant.shop.id }, select: { id: true } })).map((row) => row.id), [allocation.id]);
      assert.deepEqual((await ctx.db.tradeDispatch.findMany({ where: { shopId: tenant.shop.id }, select: { id: true } })).map((row) => row.id), [dispatch.id]);
    });

    test("rolls back every deletion when a restored row fails and blocks concurrent tenant writes", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Rollback Product", stockBaseQty: 4 });
      const artifact = await ctx.db.backupArtifact.create({ data: {
        shopId: tenant.shop.id, requestedByUserId: tenant.owner.id, type: "shop_logical",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      } });
      await processShopBackupArtifact(artifact.id, tenant.shop.id);
      const snapshot = await verifyBackupArtifactForTest(tenant.shop.id, artifact.id);
      snapshot.data.tables.Product.push({ ...snapshot.data.tables.Product[0] });
      await assert.rejects(() => ctx.db.$transaction(
        (tx) => __backupInternals.replaceRestorableShopData(tx, tenant.shop.id, snapshot),
        { isolationLevel: "Serializable", timeout: 180_000 },
      ));
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } }))?.name, "Rollback Product", "failed restore transaction leaves original rows intact");

      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const lock = await acquireShopMaintenanceLock(tenant.shop.id, tenant.owner.id, "restore-test");
      try {
        const blocked = await ctx.post("/api/jobs/backups", {}, { token: auth.accessToken, ownerPin: tenant.ownerPin });
        assert.equal(blocked.status, 423);
        assert.equal(blocked.body.code, "SHOP_MAINTENANCE_LOCKED");
      } finally {
        await releaseShopMaintenanceLock(tenant.shop.id, lock.token);
      }
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

      const previewDenied = await ctx.post(
        `/api/jobs/backups/${created.id}/restore-preview`,
        {},
        { token: ownerAuth.accessToken },
      );
      assert.equal(previewDenied.status, 403);
      const previewed = await ctx.post(
        `/api/jobs/backups/${created.id}/restore-preview`,
        {},
        { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
      );
      assert.equal(previewed.status, 200, JSON.stringify(previewed.body));
      assert.equal(previewed.body.data.preview.restorable, true);
      assert.equal(previewed.body.data.preview.table_counts.Product, 1);

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
        new Set(["SHOP_BACKUP_REQUESTED", "SHOP_BACKUP_COMPLETED", "SHOP_BACKUP_DOWNLOADED", "SHOP_BACKUP_RESTORE_PREVIEWED"]),
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
