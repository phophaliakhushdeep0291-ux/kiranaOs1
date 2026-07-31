/**
 * Regression test for the CANCEL_BILL / INVALID_EVENT conflicts seen in production.
 *
 * A bill cancelled on a device before that bill had ever reached the server has no
 * server id yet, so the client legitimately sends `serverBillId: null`. The payload
 * schema used `z.string().min(1).optional()`, and `.optional()` tolerates a MISSING
 * key but not an explicit `null` — so every such cancellation was rejected with
 * INVALID_EVENT and `retryable: false`, permanently stuck in the conflict queue.
 *
 * Observed live payload (Cloud Backup > "Backup needs attention"):
 *   type: "CANCEL_BILL", original_operation_type: "SOFT_DELETE_BILL_PENDING"
 *   payload: { billId, localBillId, serverBillId: null, reason: "..." }
 *   -> code: "INVALID_EVENT", retryable: false
 *      message: expected "string", received "null", path ["serverBillId"]
 *
 * These tests push that exact shape through the real /api/sync/push endpoint and
 * assert the cancellation is APPLIED, not conflicted.
 */
import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess } from "./setup.js";
import { activateDeviceViaApi, billPayload, createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("offline cancel null serverBillId tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const device = await activateDeviceViaApi(ctx, ownerAuth.accessToken, { deviceId: "cancel-null-device" });
    return { tenant, ownerAuth, deviceHeaders: { "x-device-id": device.deviceId } };
  }

  async function pushOfflineBill(ownerAuth, deviceHeaders, tenant, localBillId) {
    const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
    const body = {
      ...billPayload(product, { quantity: 1, ratePerRateUnit: 100, buyerPaidAmount: 100, payments: [{ mode: "cash", amount: 100 }] }),
      localBillId,
      clientBillId: localBillId,
      idempotencyKey: `create-bill:${localBillId}`,
    };
    const response = await ctx.post("/api/sync/push", {
      events: [{
        eventId: `create-${localBillId}`,
        type: "CREATE_BILL",
        payload: { localBillId, clientBillId: localBillId, idempotencyKey: `create-bill:${localBillId}`, bill: body },
      }],
    }, { token: ownerAuth.accessToken, headers: deviceHeaders });
    assertSuccess(response);
    return ctx.db.bill.findFirst({ where: { shopId: tenant.shop.id, clientBillId: localBillId } });
  }

  describe("offline CANCEL_BILL with a null serverBillId", () => {
    test("cancellation with serverBillId: null is applied, not rejected as INVALID_EVENT", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-cancel-null-1";
      const bill = await pushOfflineBill(ownerAuth, deviceHeaders, tenant, localBillId);
      assert.equal(bill.status, "active", "bill should start active");

      const response = await ctx.post("/api/sync/push", {
        events: [{
          eventId: "soft_delete_bill_pending_null_serverid",
          type: "CANCEL_BILL",
          // Exactly the production shape: an explicit null serverBillId.
          payload: { billId: bill.id, localBillId, serverBillId: null, reason: "cancelled offline" },
          ownerPin: "1234",
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.failed ?? 0, 0, "a null serverBillId must not fail the event");
      assert.equal(data.summary.synced, 1, "the cancellation must be applied");

      const cancelled = await ctx.db.bill.findUnique({ where: { id: bill.id } });
      assert.equal(cancelled.status, "cancelled", "the bill must actually end up cancelled");
    });

    test("a blank/too-short reason falls back to a default instead of failing", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-cancel-null-2";
      const bill = await pushOfflineBill(ownerAuth, deviceHeaders, tenant, localBillId);

      const response = await ctx.post("/api/sync/push", {
        events: [{
          eventId: "soft_delete_bill_pending_blank_reason",
          type: "CANCEL_BILL",
          payload: { billId: bill.id, localBillId, serverBillId: null, reason: "" },
          ownerPin: "1234",
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.failed ?? 0, 0, "a blank reason must not fail the event");

      const cancelled = await ctx.db.bill.findUnique({ where: { id: bill.id } });
      assert.equal(cancelled.status, "cancelled");
    });

    test("replaying the same cancellation stays idempotent", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-cancel-null-3";
      const bill = await pushOfflineBill(ownerAuth, deviceHeaders, tenant, localBillId);

      const cancelEvent = {
        type: "CANCEL_BILL",
        payload: { billId: bill.id, localBillId, serverBillId: null, reason: "cancelled offline" },
        ownerPin: "1234",
      };

      assertSuccess(await ctx.post("/api/sync/push", {
        events: [{ ...cancelEvent, eventId: "cancel-null-replay-1" }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      // Retry under a fresh event id, as a client would after a lost ack.
      assertSuccess(await ctx.post("/api/sync/push", {
        events: [{ ...cancelEvent, eventId: "cancel-null-replay-2" }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const cancelled = await ctx.db.bill.findUnique({ where: { id: bill.id } });
      assert.equal(cancelled.status, "cancelled");

      // The reversal must be posted once, not once per retry.
      const reversals = await ctx.db.financialLedger.findMany({
        where: { shopId: tenant.shop.id, billId: bill.id, entryType: "sale_reversal" },
      });
      assert.ok(reversals.length <= 1, `expected at most one sale reversal, found ${reversals.length}`);
    });
  });
}
