import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  recordErrorEvent,
  createSupportRequest,
  listErrorGroups,
  listSupportRequests,
  computeFingerprint,
  normalizeForFingerprint,
} from "../src/modules/diagnostics/diagnostics.service.js";

// Proves the own-backend error store (Diagnostics §1) and the Report-Issue support
// store (§7): grouping collapses repeats, tenant scoping never leaks across shops,
// and auto-collected context is PII-redacted before it is persisted.

const suffix = `diag-test-${Date.now()}`;
let shopA;
let shopB;

async function main() {
  shopA = await db.shop.create({ data: { name: `A ${suffix}`, ownerName: "A", city: "X", address: "Y" } });
  shopB = await db.shop.create({ data: { name: `B ${suffix}`, ownerName: "B", city: "X", address: "Y" } });

  // 1) Grouping — two occurrences differing only in the product id collapse into ONE issue.
  const e1 = await recordErrorEvent({ shopId: shopA.id, message: "Inventory update failed because Product 982 no longer exists", errorCode: "SYNC_ENTITY_MISSING" });
  const e2 = await recordErrorEvent({ shopId: shopA.id, message: "Inventory update failed because Product 17 no longer exists", errorCode: "SYNC_ENTITY_MISSING" });
  assert.ok(e1 && e2, "both events recorded");
  assert.equal(e1.groupId, e2.groupId, "same normalized error groups together");
  assert.equal(e2.count, 2, "group count increments on repeat");

  const groupA = await db.errorGroup.findUnique({ where: { id: e1.groupId } });
  assert.equal(groupA.count, 2, "persisted group count = 2");
  assert.equal(await db.errorEvent.count({ where: { groupId: e1.groupId } }), 2, "two ErrorEvent rows for the group");

  // 2) Tenant isolation — same text in another shop is a DIFFERENT group, and a
  //    shop's listing never returns another shop's group.
  const e3 = await recordErrorEvent({ shopId: shopB.id, message: "Inventory update failed because Product 982 no longer exists", errorCode: "SYNC_ENTITY_MISSING" });
  assert.notEqual(e3.groupId, e1.groupId, "same text in another shop is a separate group");

  const listA = await listErrorGroups({ shopId: shopA.id });
  assert.ok(listA.some((g) => g.id === e1.groupId), "shop A sees its own group");
  assert.ok(!listA.some((g) => g.id === e3.groupId), "shop A never sees shop B's group");

  // 3) Fingerprint is deterministic, number-insensitive, and shop-scoped.
  const fpA1 = computeFingerprint({ source: "frontend", shopId: shopA.id, message: "Bill 12 failed", errorCode: "E" });
  const fpA2 = computeFingerprint({ source: "frontend", shopId: shopA.id, message: "Bill 999 failed", errorCode: "E" });
  const fpB = computeFingerprint({ source: "frontend", shopId: shopB.id, message: "Bill 12 failed", errorCode: "E" });
  assert.equal(fpA1, fpA2, "numbers don't fragment fingerprints");
  assert.notEqual(fpA1, fpB, "different shops => different fingerprints");
  assert.equal(normalizeForFingerprint("Bill 12 failed"), normalizeForFingerprint("Bill 999 failed"), "normalized text matches");

  // 4) Support request — stored, and PII in the auto-collected context is REDACTED.
  const sr = await createSupportRequest({
    shopId: shopA.id,
    userId: "user-123",
    description: "Bills are not syncing since morning",
    page: "/sync",
    context: {
      note: "reach me at 9876543210 or owner@example.com",
      token: "supersecrettoken",
      recent: [{ authorization: "Bearer abc.def.ghi" }],
      appVersion: "1.2.3",
    },
  });
  const stored = await db.supportRequest.findUnique({ where: { id: sr.id } });
  assert.equal(stored.description, "Bills are not syncing since morning", "description stored verbatim");
  for (const secret of ["9876543210", "owner@example.com", "supersecrettoken", "abc.def.ghi"]) {
    assert.ok(!stored.contextJson.includes(secret), `context must not leak ${secret}`);
  }
  assert.ok(stored.contextJson.includes("1.2.3"), "non-sensitive context (appVersion) is retained");

  const srList = await listSupportRequests({ shopId: shopA.id });
  assert.ok(srList.some((r) => r.id === sr.id), "support request is listed for its shop");
  const srListB = await listSupportRequests({ shopId: shopB.id });
  assert.ok(!srListB.some((r) => r.id === sr.id), "support request never leaks to another shop");

  console.log("diagnostics-error-store.examples.js OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const ids = [shopA?.id, shopB?.id].filter(Boolean);
    try {
      await db.errorEvent.deleteMany({ where: { shopId: { in: ids } } });
      await db.errorGroup.deleteMany({ where: { shopId: { in: ids } } });
      await db.supportRequest.deleteMany({ where: { shopId: { in: ids } } });
      await db.shop.deleteMany({ where: { id: { in: ids } } });
    } catch (cleanupError) {
      console.error("cleanup failed", cleanupError);
    }
    await db.$disconnect();
  });
