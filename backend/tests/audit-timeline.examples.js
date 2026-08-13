import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  AUDIT_MODULES,
  AUDIT_RESULTS,
  createAuditLog,
  inferAuditModule,
  inferAuditResult,
  withAudit,
} from "../src/modules/audit/audit.service.js";

// Proves the §2 "Complete Audit Log" contract: every entry carries timestamp,
// user, shop, DEVICE, MODULE, previous value, new value, RESULT and DURATION —
// the four columns the spec requires beyond what the original table stored — and
// that a timeline can be reconstructed by module and by result.

const suffix = `audit-test-${Date.now()}`;
let shopA;
let shopB;

async function main() {
  shopA = await db.shop.create({ data: { name: `A ${suffix}`, ownerName: "A", city: "X", address: "Y" } });
  shopB = await db.shop.create({ data: { name: `B ${suffix}`, ownerName: "B", city: "X", address: "Y" } });

  // 1) All four new spec columns round-trip, including before/after values.
  const entry = await createAuditLog({
    shopId: shopA.id,
    deviceId: "device-abc",
    module: AUDIT_MODULES.INVENTORY,
    action: "STOCK_ADJUSTED",
    entityType: "product",
    entityId: "p-1",
    before: { stock: 10 },
    after: { stock: 4 },
    result: AUDIT_RESULTS.SUCCESS,
    durationMs: 125,
  });
  assert.ok(entry, "audit entry created");
  assert.equal(entry.deviceId, "device-abc", "device is recorded");
  assert.equal(entry.module, "inventory", "module is recorded");
  assert.equal(entry.result, "success", "result is recorded");
  assert.equal(entry.durationMs, 125, "duration is recorded");
  assert.equal(JSON.parse(entry.beforeJson).stock, 10, "previous value is recorded");
  assert.equal(JSON.parse(entry.afterJson).stock, 4, "new value is recorded");
  assert.ok(entry.createdAt instanceof Date, "timestamp is recorded");

  // 2) The ~35 pre-existing call sites pass no module/result, so both must be
  //    inferred from the action name — otherwise most of the timeline is unfiltered.
  assert.equal(inferAuditModule("CREATE_BILL"), AUDIT_MODULES.BILLING);
  assert.equal(inferAuditModule("BILL_CANCELLED"), AUDIT_MODULES.BILLING);
  assert.equal(inferAuditModule("DEVICE_REMOVED"), AUDIT_MODULES.DEVICES);
  assert.equal(inferAuditModule("SUPPLIER_CREATED"), AUDIT_MODULES.SUPPLIERS);
  assert.equal(inferAuditModule("CUSTOMER_CREATED"), AUDIT_MODULES.CUSTOMERS);
  assert.equal(inferAuditModule("LOGIN"), AUDIT_MODULES.AUTH);
  assert.equal(inferAuditModule("LOGOUT"), AUDIT_MODULES.AUTH);
  assert.equal(inferAuditModule("SYNC_COMPLETED"), AUDIT_MODULES.SYNC);
  assert.equal(inferAuditModule("SETTINGS_CHANGED"), AUDIT_MODULES.SETTINGS);
  assert.equal(inferAuditModule("REMINDER_DELIVERED"), AUDIT_MODULES.REMINDERS);
  assert.equal(inferAuditModule("SOMETHING_UNMAPPED"), AUDIT_MODULES.OTHER);

  assert.equal(inferAuditResult("CREATE_BILL"), AUDIT_RESULTS.SUCCESS, "completed actions default to success");
  assert.equal(inferAuditResult("PAYMENT_FAILED"), AUDIT_RESULTS.FAILURE);
  assert.equal(inferAuditResult("DEVICE_LIMIT_LOGIN_REJECTED"), AUDIT_RESULTS.FAILURE);
  assert.equal(inferAuditResult("CUSTOMER_DELETE_BLOCKED"), AUDIT_RESULTS.FAILURE);

  const inferred = await createAuditLog({ shopId: shopA.id, action: "PAYMENT_FAILED" });
  assert.equal(inferred.module, AUDIT_MODULES.PAYMENTS, "module inferred when omitted");
  assert.equal(inferred.result, AUDIT_RESULTS.FAILURE, "result inferred when omitted");

  // 3) Device falls back to the request header when not passed explicitly.
  const fromReq = await createAuditLog({
    shopId: shopA.id,
    action: "BILL_CANCELLED",
    req: { headers: { "x-device-id": "hdr-device-9", "user-agent": "Artha/1.0" }, ip: "10.0.0.4" },
  });
  assert.equal(fromReq.deviceId, "hdr-device-9", "device read from x-device-id header");
  assert.equal(fromReq.ipAddress, "10.0.0.4", "ip captured");
  assert.equal(fromReq.userAgent, "Artha/1.0", "user agent captured");

  // 4) withAudit times a successful operation and records its outcome.
  const value = await withAudit(
    { shopId: shopA.id, action: "REPORT_EXPORTED", after: (v) => ({ rows: v.rows }) },
    async () => {
      await new Promise((r) => setTimeout(r, 12));
      return { rows: 7 };
    },
  );
  assert.equal(value.rows, 7, "withAudit returns the operation's value");
  const okRow = await db.auditLog.findFirst({
    where: { shopId: shopA.id, action: "REPORT_EXPORTED" },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(okRow.result, AUDIT_RESULTS.SUCCESS, "success recorded");
  assert.ok(okRow.durationMs >= 10, `duration measured (got ${okRow.durationMs}ms)`);
  assert.equal(JSON.parse(okRow.afterJson).rows, 7, "after value resolved from the return value");

  // 5) withAudit records a failure WITH duration and rethrows unchanged.
  await assert.rejects(
    () => withAudit({ shopId: shopA.id, action: "BACKUP_RESTORED" }, async () => {
      throw new Error("disk unavailable");
    }),
    /disk unavailable/,
    "the original error still propagates to the caller",
  );
  const failRow = await db.auditLog.findFirst({
    where: { shopId: shopA.id, action: "BACKUP_RESTORED" },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(failRow.result, AUDIT_RESULTS.FAILURE, "thrown operation recorded as failure");
  assert.ok(failRow.durationMs !== null, "failed operation still records duration");
  assert.match(JSON.parse(failRow.metadataJson).error, /disk unavailable/, "failure reason captured");

  // 6) Timeline reconstruction — filter by module and by result, tenant-scoped.
  const inventoryRows = await db.auditLog.findMany({
    where: { shopId: shopA.id, module: AUDIT_MODULES.INVENTORY },
  });
  assert.equal(inventoryRows.length, 1, "module filter selects only inventory events");
  const failures = await db.auditLog.findMany({
    where: { shopId: shopA.id, result: AUDIT_RESULTS.FAILURE },
  });
  assert.ok(failures.length >= 2, "result filter selects the failures");

  await createAuditLog({ shopId: shopB.id, action: "CREATE_BILL" });
  const shopARows = await db.auditLog.findMany({ where: { shopId: shopA.id } });
  assert.ok(shopARows.every((r) => r.shopId === shopA.id), "a shop's timeline never includes another shop's events");

  // 7) Audit logging must never break the business flow it is recording.
  const bad = await createAuditLog({ shopId: "does-not-exist", action: "CREATE_BILL" });
  assert.equal(bad, null, "a failed audit write returns null instead of throwing");

  console.log("audit-timeline.examples.js OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const ids = [shopA?.id, shopB?.id].filter(Boolean);
    try {
      await db.auditLog.deleteMany({ where: { shopId: { in: ids } } });
      await db.shop.deleteMany({ where: { id: { in: ids } } });
    } catch (cleanupError) {
      console.error("cleanup failed", cleanupError);
    }
    await db.$disconnect();
  });
