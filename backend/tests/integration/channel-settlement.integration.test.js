import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("channel settlement integration skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  const mapping = {
    externalOrderId: "Order ID",
    orderDate: "Order Date",
    orderStatus: "Status",
    gross: "Gross",
    merchantDiscount: "Merchant Discount",
    platformCommission: "Commission",
    paymentFee: "Payment Fee",
    taxOnFees: "GST on Fees",
    tcs: "TCS",
    tds: "TDS",
    adjustment: "Adjustment",
    refund: "Refund",
    paidNet: "Paid Net",
  };

  const csvText = [
    "Order ID,Order Date,Status,Gross,Merchant Discount,Commission,Payment Fee,GST on Fees,TCS,TDS,Adjustment,Refund,Paid Net",
    "ZOM-100,2026-08-01,delivered,1000,50,100,10,1.80,10,10,0,0,818.20",
    "ZOM-404,2026-08-02,delivered,500,0,50,0,0,0,0,0,0,430",
  ].join("\n");

  async function ownerContext(planCode = "pro") {
    const tenant = await createTenant(ctx.db, { planCode });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, auth };
  }

  describe("channel order and payout reconciliation", () => {
    test("imports atomically, deduplicates files, suggests without posting, resolves explicitly, and isolates tenants", async () => {
      const { tenant, auth } = await ownerContext();
      const location = await ctx.db.storeLocation.create({
        data: { shopId: tenant.shop.id, code: "MAIN", name: "Main Outlet", isPrimary: true },
      });
      const bill = await ctx.db.bill.create({
        data: { shopId: tenant.shop.id, locationId: location.id, billNo: "KOS-CHANNEL-1", grandTotal: 1000, grandTotalPaise: 100000n, actualAmount: 1000, actualAmountPaise: 100000n },
      });
      const order = await ctx.db.customerOrder.create({
        data: {
          shopId: tenant.shop.id,
          locationId: location.id,
          customerName: "Channel Customer",
          customerMobile: "9999900001",
          itemsJson: "[]",
          itemCount: 1,
          estimatedTotal: 1000,
          sourceChannel: "marketplace",
          externalOrderId: "ZOM-100",
          status: "fulfilled",
          fulfillmentStatus: "fulfilled",
          paymentStatus: "paid",
          billId: bill.id,
        },
      });
      const input = { provider: "Zomato report", locationId: location.id, fileName: "payout-2026-08.csv", csvText, mapping };

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_channel_import_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'CHANNEL_SETTLEMENT_IMPORTED'
        BEGIN
          SELECT RAISE(ABORT, 'forced channel import audit failure');
        END
      `);
      let failedAction;
      try {
        failedAction = await ctx.post("/api/accounting/channel-settlements/import", input, {
          token: auth.accessToken,
          ownerPin: tenant.ownerPin,
        });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_channel_import_audit_failure");
      }
      assert.equal(assertFailure(failedAction, 503).code, "CHANNEL_SETTLEMENT_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.channelSettlementImport.count({ where: { shopId: tenant.shop.id } }), 0);
      assert.equal(await ctx.db.channelSettlementRow.count({ where: { shopId: tenant.shop.id } }), 0);

      const imported = assertSuccess(await ctx.post("/api/accounting/channel-settlements/import", input, {
        token: auth.accessToken, ownerPin: tenant.ownerPin,
      }), 201);
      assert.equal(imported.rowCount, 2);
      assert.equal(imported.gross.paise, 150000);
      assert.equal(imported.calculatedNet.paise, 126820);
      assert.equal(imported.paidNet.paise, 124820);
      assert.equal(imported.variance.paise, -2000);
      assert.equal(imported.idempotentReplay, false);

      const replay = assertSuccess(await ctx.post("/api/accounting/channel-settlements/import", input, {
        token: auth.accessToken, ownerPin: tenant.ownerPin,
      }));
      assert.equal(replay.id, imported.id);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(await ctx.db.channelSettlementImport.count({ where: { shopId: tenant.shop.id } }), 1);
      assert.equal(await ctx.db.channelSettlementRow.count({ where: { shopId: tenant.shop.id } }), 2);
      assert.equal(await ctx.db.payment.count({ where: { shopId: tenant.shop.id } }), 0, "import must never auto-post a payment");

      const report = assertSuccess(await ctx.get(`/api/accounting/channel-settlements?importId=${imported.id}`, { token: auth.accessToken }));
      assert.equal(report.autoPost, false);
      assert.equal(report.summary.rowCount, 2);
      assert.equal(report.summary.openCount, 2);
      assert.equal(report.summary.mismatchCount, 1);
      assert.equal(report.rollups[0].locationName, "Main Outlet");
      const suggested = report.rows.find((row) => row.externalOrderId === "ZOM-100");
      const missing = report.rows.find((row) => row.externalOrderId === "ZOM-404");
      assert.equal(suggested.matchStatus, "suggested");
      assert.equal(suggested.candidateCustomerOrderId, order.id);
      assert.deepEqual(suggested.mismatches, []);
      assert.equal(missing.matchStatus, "missing");
      assert.deepEqual(new Set(missing.mismatches), new Set(["missing_order", "net_mismatch"]));

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_channel_match_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'CHANNEL_SETTLEMENT_MATCH'
        BEGIN
          SELECT RAISE(ABORT, 'forced channel match audit failure');
        END
      `);
      try {
        failedAction = await ctx.post(`/api/accounting/channel-settlement-rows/${suggested.id}/resolve`, {
          action: "match", customerOrderId: order.id, billId: bill.id, reason: "Forced audit rollback proof",
        }, { token: auth.accessToken, ownerPin: tenant.ownerPin });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_channel_match_audit_failure");
      }
      assert.equal(assertFailure(failedAction, 503).code, "CHANNEL_SETTLEMENT_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.channelSettlementRow.findUniqueOrThrow({ where: { id: suggested.id } })).resolutionStatus, "open");
      assert.equal(await ctx.db.channelSettlementEvent.count({ where: { rowId: suggested.id } }), 0);

      const matched = assertSuccess(await ctx.post(`/api/accounting/channel-settlement-rows/${suggested.id}/resolve`, {
        action: "match", customerOrderId: order.id, billId: bill.id, reason: "Confirmed against channel order ID",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(matched.resolutionStatus, "matched");
      assert.equal(matched.matchedBillId, bill.id);
      assert.equal(matched.events[0].action, "match");

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_channel_ignore_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'CHANNEL_SETTLEMENT_IGNORE'
        BEGIN
          SELECT RAISE(ABORT, 'forced channel ignore audit failure');
        END
      `);
      try {
        failedAction = await ctx.post(`/api/accounting/channel-settlement-rows/${missing.id}/resolve`, {
          action: "ignore", reason: "Forced audit rollback proof",
        }, { token: auth.accessToken, ownerPin: tenant.ownerPin });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_channel_ignore_audit_failure");
      }
      assert.equal(assertFailure(failedAction, 503).code, "CHANNEL_SETTLEMENT_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.channelSettlementRow.findUniqueOrThrow({ where: { id: missing.id } })).resolutionStatus, "open");
      assert.equal(await ctx.db.channelSettlementEvent.count({ where: { rowId: missing.id } }), 0);

      const ignored = assertSuccess(await ctx.post(`/api/accounting/channel-settlement-rows/${missing.id}/resolve`, {
        action: "ignore", reason: "Known test adjustment outside POS",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(ignored.resolutionStatus, "ignored");

      const { tenant: other, auth: otherAuth } = await ownerContext();
      const isolated = assertFailure(await ctx.post(`/api/accounting/channel-settlement-rows/${suggested.id}/resolve`, {
        action: "reverse", reason: "Attempt from another tenant",
      }, { token: otherAuth.accessToken, ownerPin: other.ownerPin }), 404);
      assert.equal(isolated.code, "CHANNEL_SETTLEMENT_ROW_NOT_FOUND");

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_channel_reverse_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'CHANNEL_SETTLEMENT_REVERSE'
        BEGIN
          SELECT RAISE(ABORT, 'forced channel reverse audit failure');
        END
      `);
      try {
        failedAction = await ctx.post(`/api/accounting/channel-settlement-rows/${suggested.id}/resolve`, {
          action: "reverse", reason: "Forced audit rollback proof",
        }, { token: auth.accessToken, ownerPin: tenant.ownerPin });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_channel_reverse_audit_failure");
      }
      assert.equal(assertFailure(failedAction, 503).code, "CHANNEL_SETTLEMENT_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.channelSettlementRow.findUniqueOrThrow({ where: { id: suggested.id } })).resolutionStatus, "matched");
      assert.equal(await ctx.db.channelSettlementEvent.count({ where: { rowId: suggested.id } }), 1);

      const reversed = assertSuccess(await ctx.post(`/api/accounting/channel-settlement-rows/${suggested.id}/resolve`, {
        action: "reverse", reason: "Re-opened after source evidence changed",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(reversed.resolutionStatus, "open");
      assert.equal(reversed.matchStatus, "suggested");
      assert.equal(reversed.events.length, 2);
      assert.deepEqual(reversed.events.map((event) => event.action), ["reverse", "match"]);
    });

    test("rejects malformed mapped rows atomically and enforces the Business plan", async () => {
      const { tenant, auth } = await ownerContext();
      const invalid = await ctx.post("/api/accounting/channel-settlements/import", {
        provider: "Generic channel",
        fileName: "invalid.csv",
        csvText: "Order ID,Order Date,Gross,Paid Net\nBAD-1,not-a-date,100,100",
        mapping: { externalOrderId: "Order ID", orderDate: "Order Date", gross: "Gross", paidNet: "Paid Net" },
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin });
      const failure = assertFailure(invalid, 422);
      assert.equal(failure.code, "CHANNEL_SETTLEMENT_ROW_INVALID");
      assert.equal(await ctx.db.channelSettlementImport.count({ where: { shopId: tenant.shop.id } }), 0);

      const { tenant: growth, auth: growthAuth } = await ownerContext("growth");
      const gated = await ctx.post("/api/accounting/channel-settlements/import", {
        provider: "Generic channel", fileName: "gated.csv", csvText, mapping,
      }, { token: growthAuth.accessToken, ownerPin: growth.ownerPin });
      assert.equal(gated.status, 403, JSON.stringify(gated.body));
      assert.equal(gated.body.code, "FEATURE_NOT_INCLUDED");
    });
  });
}
