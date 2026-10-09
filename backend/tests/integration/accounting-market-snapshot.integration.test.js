import test from "node:test";
import assert from "node:assert/strict";
import db from "../../src/db.js";
import { confirmBill, createSaleReturn, listBills } from "../../src/modules/bills/bills.service.js";
import { updateShop } from "../../src/modules/shops/shops.service.js";
import { pushOfflineActions, pullSince } from "../../src/modules/sync/sync.service.js";
import { accountingMarketSnapshot } from "../../src/modules/shops/market-policy.js";
import { createTenant, createProduct, billPayload } from "./factories.js";

test("persisted sale/return markets survive reload, retry and legacy requests without currency relabeling", async () => {
  await db.$connect();
  try {
    const tenant = await createTenant(db);
    const product = await createProduct(db, tenant.shop.id, { stockBaseQty: 20, defaultPricePerRateUnit: 105 });
    const actor = { userId: tenant.owner.id, ownerPinVerified: true };
    const snapshot = { countryCode: "IN", currencyCode: "INR", accountingTimeZone: "Asia/Kolkata", taxRegime: "GST" };
    assert.deepEqual(accountingMarketSnapshot(tenant.shop), snapshot);
    const input = { ...billPayload(product), clientBillId: "market-sale", idempotencyKey: "market-sale" };
    const bill = await confirmBill(tenant.shop.id, input, actor);
    assert.deepEqual(accountingMarketSnapshot(bill), snapshot);
    for (const payment of bill.payments) for (const [key, value] of Object.entries(snapshot)) assert.equal(payment[key], value);
    for (const model of [db.financialLedger, db.journalEntry]) {
      const savedRows = await model.findMany({ where: { shopId: tenant.shop.id } });
      assert.ok(savedRows.length > 0);
      for (const row of savedRows) for (const [key, value] of Object.entries(snapshot)) assert.equal(row[key], value);
    }
    const reloaded = await db.bill.findUniqueOrThrow({ where: { id: bill.id } });
    for (const [key, value] of Object.entries(snapshot)) assert.equal(reloaded[key], value);
    assert.equal((await confirmBill(tenant.shop.id, { ...input, ...snapshot }, actor)).id, bill.id);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 18);

    const assertNoWrite = async (operation, code = "ACCOUNTING_MARKET_MISMATCH") => {
      const before = await db.bill.count({ where: { shopId: tenant.shop.id } });
      const stockBefore = (await db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty;
      const paymentsBefore = await db.payment.count({ where: { shopId: tenant.shop.id } });
      await assert.rejects(operation, { code });
      assert.equal(await db.bill.count({ where: { shopId: tenant.shop.id } }), before);
      assert.equal(await db.payment.count({ where: { shopId: tenant.shop.id } }), paymentsBefore);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, stockBefore);
    };
    await assertNoWrite(() => confirmBill(tenant.shop.id, { ...input, currencyCode: "AED" }, actor));
    await assertNoWrite(() => confirmBill(tenant.shop.id, { ...input, clientBillId: "new-wrong-market", idempotencyKey: "new-wrong-market", currencyCode: "AED" }, actor));
    await assertNoWrite(() => confirmBill(tenant.shop.id, { ...input, accountingTimeZone: "Asia/Dubai" }, actor));
    await assert.rejects(() => updateShop(tenant.shop.id, { currencyCode: "AED" }, { role: "owner", userId: tenant.owner.id }), { code: "MARKET_NOT_LIVE" });
    await assert.rejects(() => updateShop(tenant.shop.id, { accountingTimeZone: "Asia/Dubai" }, { role: "owner", userId: tenant.owner.id }), { code: "ACCOUNTING_MARKET_MISMATCH" });

    const returnInput = {
      clientBillId: "market-return", idempotencyKey: "market-return", returnOfBillId: bill.id,
      refundMode: "cash", reason: "Original currency reversal",
      items: [{ ...input.items[0], quantity: 1, originalBillItemId: bill.items[0].id }],
    };
    await assertNoWrite(() => createSaleReturn(tenant.shop.id, { ...returnInput, currencyCode: "AED" }, actor));
    const returned = await createSaleReturn(tenant.shop.id, returnInput, actor);
    for (const [key, value] of Object.entries(snapshot)) assert.equal(returned[key], bill[key]);
    assert.equal(returned.grandTotal, -105);
    for (const payment of returned.payments) for (const [key, value] of Object.entries(snapshot)) assert.equal(payment[key], value);
    assert.equal((await createSaleReturn(tenant.shop.id, { ...returnInput, ...snapshot }, actor)).id, returned.id);
    await assertNoWrite(() => createSaleReturn(tenant.shop.id, { ...returnInput, taxRegime: "VAT" }, actor));
    const list = await listBills(tenant.shop.id, { view: "list", page: 1, limit: 100, status: "all" });
    const rows = Array.isArray(list) ? list : list.bills ?? list.data ?? [];
    assert.ok(rows.length >= 2);
    for (const row of rows) for (const [key, value] of Object.entries(snapshot)) assert.equal(row[key], value);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 19);

    // Exercise the actual outbox ingestion and pull response, including retries
    // with a new event id but the same durable bill identity.
    const syncUser = { userId: tenant.owner.id, role: "owner", shopId: tenant.shop.id };
    const syncInput = { ...input, ...snapshot, clientBillId: "market-offline-sale", idempotencyKey: "market-offline-sale" };
    const event = { eventId: "market-offline-event", type: "CREATE_BILL", payload: { bill: syncInput } };
    const push = await pushOfflineActions(tenant.shop.id, [event], syncUser);
    assert.equal(push.applied, 1, JSON.stringify(push.results));
    for (const [key, value] of Object.entries(snapshot)) assert.equal(push.results[0].bill[key], value);
    const serverId = push.results[0].bill.id;
    const replay = await pushOfflineActions(tenant.shop.id, [event, { ...event, eventId: "market-offline-retry" }], syncUser);
    assert.equal(replay.applied, 2, JSON.stringify(replay.results));
    for (const result of replay.results) assert.equal(result.bill.id, serverId);
    const badReplay = await pushOfflineActions(tenant.shop.id, [{
      ...event, eventId: "market-offline-wrong-currency", payload: { bill: { ...syncInput, currencyCode: "AED" } },
    }], syncUser);
    assert.equal(badReplay.applied, 0);
    assert.equal(badReplay.results[0].result.code, "ACCOUNTING_MARKET_MISMATCH");
    const pull = await pullSince(tenant.shop.id, new Date(0).toISOString(), { role: "owner" });
    const pulled = pull.bills.find((row) => row.id === serverId);
    assert.ok(pulled, "The bill must be available to another counter");
    for (const [key, value] of Object.entries(snapshot)) assert.equal(pulled[key], value);
    assert.equal(await db.bill.count({ where: { shopId: tenant.shop.id, clientBillId: syncInput.clientBillId } }), 1);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 17);
  } finally { await db.$disconnect(); }
});
