import assert from "assert";
import { readFileSync } from "fs";
import { generateBillNo } from "../src/utils/billNumber.js";

function createMockTx() {
  const counters = new Map();
  return {
    counters,
    billCounter: {
      async upsert({ where, create, update, select }) {
        const shopId = where.shopId;
        if (!counters.has(shopId)) {
          counters.set(shopId, {
            lastNumber: create.lastNumber ?? 0,
            estimateLastNumber: create.estimateLastNumber ?? 0,
          });
        } else {
          const current = counters.get(shopId);
          counters.set(shopId, {
            lastNumber: current.lastNumber + (update.lastNumber?.increment ?? 0),
            estimateLastNumber: current.estimateLastNumber + (update.estimateLastNumber?.increment ?? 0),
          });
        }
        const row = counters.get(shopId);
        return Object.fromEntries(Object.keys(select).map((field) => [field, row[field]]));
      },
    },
  };
}

async function run() {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert(schema.includes("model BillCounter"), "Prisma schema must include BillCounter model");
  assert.match(schema, /\bshopId\s+String\s+@unique\b/, "BillCounter.shopId must be unique");
  assert.match(schema, /\blastNumber\s+Int\b/, "BillCounter must track lastNumber");
  assert.match(schema, /\bestimateLastNumber\s+Int\b/, "BillCounter must track estimateLastNumber separately");
  assert.match(schema, /\bbillCounter\s+BillCounter\?(?:\s|$)/, "Shop must expose optional billCounter relation");

  const billNumberSource = readFileSync("src/utils/billNumber.js", "utf8");
  assert(billNumberSource.includes("billCounter.upsert"), "generateBillNo must use BillCounter upsert");
  assert(!billNumberSource.includes("bill.findFirst"), "generateBillNo must not query last bill");
  assert(!billNumberSource.includes("orderBy"), "generateBillNo must not order bills to find last bill");
  assert(billNumberSource.includes("padStart(6"), "Bill numbers must use 6-digit padding");

  const tx = createMockTx();
  const first = await generateBillNo("shop-a", tx);
  const firstEstimate = await generateBillNo("shop-a", tx, { billType: "estimate" });
  const second = await generateBillNo("shop-a", tx);
  const secondEstimate = await generateBillNo("shop-a", tx, { billType: "estimate" });
  const third = await generateBillNo("shop-a", tx);
  const otherShopFirst = await generateBillNo("shop-b", tx);
  const otherShopEstimate = await generateBillNo("shop-b", tx, { billType: "estimate" });

  assert.match(first, /^KOS-\d{4}-000001$/);
  assert.match(firstEstimate, /^EST-\d{4}-000001$/);
  assert.match(second, /^KOS-\d{4}-000002$/);
  assert.match(secondEstimate, /^EST-\d{4}-000002$/);
  assert.match(third, /^KOS-\d{4}-000003$/);
  assert.match(otherShopFirst, /^KOS-\d{4}-000001$/);
  assert.match(otherShopEstimate, /^EST-\d{4}-000001$/);
  assert.notStrictEqual(second, third, "Bill numbers must increment per shop");
  assert.notStrictEqual(firstEstimate, secondEstimate, "Estimate numbers must increment per shop");

  console.log("Bill counter examples passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
