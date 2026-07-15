import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase } from "./setup.js";
import { createProduct, createTenant } from "./factories.js";
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
      const otherProduct = await createProduct(ctx.db, other.shop.id, { name: "Other Shop Secret" });
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
      assert.equal(snapshot.data.products.some((row) => row.id === otherProduct.id), false);
      const serialized = JSON.stringify(snapshot);
      assert.equal(serialized.includes("passwordHash"), true, "manifest documents intentional credential exclusion");
      assert.equal(serialized.includes(tenant.owner.passwordHash), false, "credential hashes are never present in the artifact");
      assert.equal(serialized.includes("Other Shop Secret"), false, "another tenant's data is never present");
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
  });
}
