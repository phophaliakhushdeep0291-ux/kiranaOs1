/**
 * SYNC-005 evidence that the drill itself cannot provide.
 *
 * scripts/backup-drill.js proves the happy path reconciles. These prove the things a
 * green drill says nothing about: that a damaged artifact is refused before it can touch
 * the shop, that the drill can actually fail, and that a device which was live before the
 * restore cannot replay its outbox into the rebuilt shop and duplicate a day's bills.
 */
import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase } from "./setup.js";
import { activateDeviceViaApi, createProduct, createTenant, login, productPayload } from "./factories.js";
import { env } from "../../src/config/env.js";
import { getObject, putObject } from "../../src/lib/objectStorage.js";
import {
  processShopBackupArtifact,
  restoreShopBackup,
} from "../../src/modules/backups/backup.service.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("backup drill integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => {
    await resetDatabase(ctx.db);
    env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  async function seedBackedUpShop() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const product = await createProduct(ctx.db, tenant.shop.id, { name: "Drill Rice" });
    const artifactRow = await ctx.db.backupArtifact.create({
      data: {
        shopId: tenant.shop.id,
        requestedByUserId: tenant.owner.id,
        type: "shop_logical",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await processShopBackupArtifact(artifactRow.id, tenant.shop.id);
    return { tenant, product, artifactId: artifactRow.id };
  }

  const confirmationFor = (artifactId) => `RESTORE ${artifactId.slice(-6)}`;

  describe("a damaged artifact never reaches the shop", { concurrency: false }, () => {
    test("a truncated artifact is rejected and the shop is left untouched", async () => {
      const { tenant, artifactId } = await seedBackedUpShop();
      const row = await ctx.db.backupArtifact.findUniqueOrThrow({ where: { id: artifactId } });

      // Half an upload: the bytes stop mid-envelope. This is the realistic corruption —
      // an interrupted transfer, not a hostile edit.
      const whole = await getObject({ key: row.objectKey });
      await putObject({ key: row.objectKey, body: whole.subarray(0, Math.floor(whole.length / 2)) });

      const before = await ctx.db.product.count({ where: { shopId: tenant.shop.id } });
      await assert.rejects(
        () => restoreShopBackup(tenant.shop.id, artifactId, tenant.owner.id, confirmationFor(artifactId)),
        (error) => error?.statusCode >= 400,
      );
      // The shop must be exactly as it was: rejection happens before any write.
      assert.equal(await ctx.db.product.count({ where: { shopId: tenant.shop.id } }), before);
      assert.equal(before, 1);
    });

    test("a tampered artifact is rejected on checksum and the shop is left untouched", async () => {
      const { tenant, artifactId } = await seedBackedUpShop();
      const row = await ctx.db.backupArtifact.findUniqueOrThrow({ where: { id: artifactId } });

      const whole = await getObject({ key: row.objectKey });
      const tampered = Buffer.from(whole);
      tampered[tampered.length - 1] ^= 0xff; // flip the last byte
      await putObject({ key: row.objectKey, body: tampered });

      const before = await ctx.db.product.count({ where: { shopId: tenant.shop.id } });
      await assert.rejects(
        () => restoreShopBackup(tenant.shop.id, artifactId, tenant.owner.id, confirmationFor(artifactId)),
        (error) => error?.code === "BACKUP_CHECKSUM_MISMATCH" || error?.code === "BACKUP_DECRYPTION_FAILED",
      );
      assert.equal(await ctx.db.product.count({ where: { shopId: tenant.shop.id } }), before);
    });
  });

  describe("a restore does not let a stale device duplicate the shop", { concurrency: false }, () => {
    test("a device that was live before the restore must re-bootstrap instead of replaying", async () => {
      const { tenant, artifactId } = await seedBackedUpShop();
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const token = auth.accessToken;

      // Device A is the till that was serving customers when the server was restored.
      const device = await activateDeviceViaApi(ctx, token, { deviceId: "counter-till" });
      const deviceHeaders = { "x-device-id": device.deviceId };
      const beforeBills = await ctx.db.bill.count({ where: { shopId: tenant.shop.id } });

      await restoreShopBackup(tenant.shop.id, artifactId, tenant.owner.id, confirmationFor(artifactId));

      // Its pending outbox arrives after the restore, through the real push route the
      // device uses. The shop's dataEpoch has moved on, so the device is told to rebuild
      // rather than being allowed to push — which is what stops a day of already-restored
      // bills being written a second time.
      const replay = await ctx.post("/api/sync/push", {
        events: [{
          eventId: "pending-local-bill-1",
          type: "CREATE_PRODUCT",
          payload: { localProductId: "local_pending_1", product: productPayload({ name: "Pending Local Item" }) },
        }],
      }, { token, headers: deviceHeaders, autoDevice: false });

      assert.equal(replay.status, 409, `expected re-bootstrap, got ${replay.status} ${JSON.stringify(replay.body)}`);
      assert.equal(replay.body?.code, "DEVICE_REBOOTSTRAP_REQUIRED");
      // The refused push wrote nothing.
      assert.equal(await ctx.db.product.count({ where: { shopId: tenant.shop.id, name: "Pending Local Item" } }), 0);

      // Zero duplicates, and zero lost writes: the restored state is exactly the backup.
      assert.equal(await ctx.db.bill.count({ where: { shopId: tenant.shop.id } }), beforeBills);
    });
  });

  describe("the automatic recovery backup is a real rollback", { concurrency: false }, () => {
    test("restoring the recovery artifact returns the shop to its exact pre-restore state", async () => {
      const { tenant, product, artifactId } = await seedBackedUpShop();

      // State A is in artifactId. State B is the live shop immediately before the
      // restore and must therefore be captured by the automatic recovery backup.
      await ctx.db.product.update({
        where: { id: product.id },
        data: { name: "Live Before Restore", stockBaseQty: 42 },
      });
      const postBackupProduct = await createProduct(ctx.db, tenant.shop.id, {
        name: "Created After Backup",
        stockBaseQty: 17,
      });

      const restoredA = await restoreShopBackup(
        tenant.shop.id,
        artifactId,
        tenant.owner.id,
        confirmationFor(artifactId),
      );
      assert.equal(restoredA.recovery_backup.status, "completed");
      const stateA = await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } });
      assert.equal(stateA.name, "Drill Rice");
      assert.equal(await ctx.db.product.count({ where: { id: postBackupProduct.id } }), 0);

      const rollbackId = restoredA.recovery_backup.id;
      await restoreShopBackup(
        tenant.shop.id,
        rollbackId,
        tenant.owner.id,
        confirmationFor(rollbackId),
      );

      const rolledBack = await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } });
      assert.equal(rolledBack.name, "Live Before Restore");
      assert.equal(rolledBack.stockBaseQty, 42);
      const restoredPostBackupProduct = await ctx.db.product.findUnique({ where: { id: postBackupProduct.id } });
      assert.equal(restoredPostBackupProduct?.name, "Created After Backup");
      assert.equal(restoredPostBackupProduct?.stockBaseQty, 17);

      const restoreAudits = await ctx.db.auditLog.count({
        where: { shopId: tenant.shop.id, action: "SHOP_BACKUP_RESTORED" },
      });
      assert.equal(restoreAudits, 2, "the forward restore and rollback are both audited");
      const shop = await ctx.db.shop.findUniqueOrThrow({
        where: { id: tenant.shop.id },
        select: { dataEpoch: true },
      });
      assert.equal(shop.dataEpoch, 2, "every restore invalidates stale device state");
    });
  });

  // Proving the drill can FAIL lives in scripts/backup-drill-verify.js, not here: it has
  // to run the drill as its own process against its own database, and nesting that inside
  // this suite made the child contend with the parent for prisma/test.db.
}
