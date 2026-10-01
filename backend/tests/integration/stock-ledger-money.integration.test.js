import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIntegrationContext, resetDatabase } from "./setup.js";
import { createTenant, createProduct } from "./factories.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("stock ledger money migration unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));
  test("stock money migration fills only missing paise and can be replayed", async (t) => {
    if (!process.env.DATABASE_URL?.startsWith("postgres")) return t.skip("PostgreSQL migration");
    const { shop } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);
    const row = await ctx.db.stockLedger.create({ data: {
      shopId: shop.id, productId: product.id, productName: product.name,
      action: "purchase", changeBaseQty: 1, oldStockBaseQty: 0, newStockBaseQty: 1,
      purchaseBillAmount: 12.34, purchaseBillAmountPaise: null,
      calculatedBuyRate: 12.34, calculatedBuyRatePaise: null,
      purchasePaidAmount: 10.01, purchasePaidAmountPaise: null,
      purchaseDueAmount: 2.33, purchaseDueAmountPaise: null,
      // An established value must remain visible to reconciliation even when
      // inconsistent. A schema migration must not silently rewrite that history.
      damageLossValue: 0, damageLossValuePaise: 999n,
    } });
    const sql = readFileSync(new URL("../../prisma-postgres/migrations/000140_stock_ledger_money_defaults/migration.sql", import.meta.url), "utf8");
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await ctx.db.$transaction(async (tx) => {
          for (const statement of sql.split(";").filter((part) => part.trim())) await tx.$executeRawUnsafe(statement);
        });
        const saved = await ctx.db.stockLedger.findUnique({ where: { id: row.id } });
        for (const [field, paise] of Object.entries({ purchaseBillAmount: 1234n, calculatedBuyRate: 1234n, purchasePaidAmount: 1001n, purchaseDueAmount: 233n, damageLossValue: 999n })) {
          assert.equal(saved[`${field}Paise`], paise);
          assert.equal(saved[field], row[field], `${field} history is unchanged`);
        }
      }
    } finally {
      await ctx.db.stockLedger.delete({ where: { id: row.id } });
    }
  });
}
