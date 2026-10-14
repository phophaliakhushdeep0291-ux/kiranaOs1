import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess } from "./setup.js";
import { createTenant, createProduct, login } from "./factories.js";
import { createAccountingPeriod, closeAccountingPeriod, createManualJournal, ensureSystemAccounts } from "../../src/modules/finance/general-ledger.service.js";
import { recordDamage } from "../../src/modules/inventory/inventory.service.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("stock damage accounting unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));
  async function fixture() {
    const tenant = await createTenant(ctx.db);
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, costPerRateUnit: 12.35 });
    return { tenant, product, options: { token: auth.accessToken, ownerPin: tenant.ownerPin },
      body: { productId: product.id, quantity: 3, enteredUnit: product.baseUnit, idempotencyKey: "damage-accounting-original", note: "Water damage" } };
  }
  test("damage reduces recorded inventory and earnings once, with the original cost and source evidence", async () => {
    const { tenant, product, options, body } = await fixture();
    await ensureSystemAccounts(tenant.shop.id);
    await createManualJournal(tenant.shop.id, { reference: "opening-inventory", description: "Verified opening stock", businessDate: new Date().toISOString(), lines: [
      { accountCode: "1200", debitPaise: 12350, creditPaise: 0 }, { accountCode: "3000", debitPaise: 0, creditPaise: 12350 },
    ] });
    const response = assertSuccess(await ctx.post("/api/inventory/damage", body, options));
    assert.equal(response.damageLossValue, 37.05);
    assert.equal(response.newStock, 7);
    await ctx.db.product.update({ where: { id: product.id }, data: { costPerRateUnit: 99 } });
    assert.equal(assertSuccess(await ctx.post("/api/inventory/damage", body, options)).idempotentReplay, true);
    const movement = await ctx.db.stockLedger.findFirstOrThrow({ where: { shopId: tenant.shop.id, action: "damage" } });
    const rows = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, sourceType: "stock_damage" }, orderBy: { entryType: "asc" } });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row.entryType), ["inventory_loss", "inventory_write_off"]);
    assert.ok(rows.every(row => row.sourceId === movement.id && row.amountPaise === 3705n));
    assert.equal(await ctx.db.journalEntry.count({ where: { shopId: tenant.shop.id, sourceType: "stock_damage" } }), 1);
    const pnl = assertSuccess(await ctx.get("/api/accounting/profit-and-loss", options));
    assert.equal(pnl.netProfitPaise, -3705);
    const sheet = assertSuccess(await ctx.get("/api/accounting/balance-sheet", options));
    assert.equal(sheet.assets.find(row => row.code === "1200").amountPaise, 8645);
    assert.equal(sheet.totalEquityPaise, 8645);
    assert.equal(sheet.differencePaise, 0);
    assert.equal(sheet.integrity.status, "verified");
    assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 7);
  });
  test("journal failure rolls back stock, source rows, journal and required audit together", async () => {
    const { tenant, product, options, body } = await fixture();
    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER force_damage_journal_failure BEFORE INSERT ON JournalEntry WHEN NEW.sourceType = 'stock_damage' BEGIN SELECT RAISE(ABORT, 'forced damage journal failure'); END`);
    try { const result = await ctx.post("/api/inventory/damage", body, options); assert.ok(result.status >= 400, JSON.stringify(result.body)); assert.equal(result.body.success, false); }
    finally { await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_damage_journal_failure"); }
    assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 10);
    assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, action: "damage" } }), 0);
    assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id } }), 0);
    assert.equal(await ctx.db.journalEntry.count({ where: { shopId: tenant.shop.id } }), 0);
    assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "STOCK_DAMAGED" } }), 0);
  });
  test("dated damage cannot bypass a closed period, including zero-cost goods, but a saved replay remains harmless", async () => {
    const { tenant, product, body } = await fixture();
    const businessDate = "2033-03-04T10:00:00Z";
    const identity = { businessDate, idempotencyKey: body.idempotencyKey };
    await recordDamage(tenant.shop.id, body, identity);
    const movement = await ctx.db.stockLedger.findFirstOrThrow({ where: { shopId: tenant.shop.id, action: "damage" } });
    assert.equal(movement.createdAt.toISOString(), new Date(businessDate).toISOString());
    const rows = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id } });
    assert.ok(rows.every(row => row.businessDate.toISOString() === new Date(businessDate).toISOString()));
    const period = await createAccountingPeriod(tenant.shop.id, { name: "March", startsAt: "2033-03-01T00:00:00Z", endsAt: "2033-03-31T23:59:59Z" });
    await closeAccountingPeriod(tenant.shop.id, period.id, { reason: "Reviewed" }, tenant.owner.id);
    assert.equal((await recordDamage(tenant.shop.id, body, identity)).idempotentReplay, true);
    await assert.rejects(recordDamage(tenant.shop.id, body, { ...identity, idempotencyKey: "new-closed-damage" }), { code: "ACCOUNTING_PERIOD_CLOSED" });
    await ctx.db.product.update({ where: { id: product.id }, data: { costPerRateUnit: 0 } });
    await assert.rejects(recordDamage(tenant.shop.id, body, { ...identity, idempotencyKey: "zero-cost-closed" }), { code: "ACCOUNTING_PERIOD_CLOSED" });
    assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 7);
  });
}
