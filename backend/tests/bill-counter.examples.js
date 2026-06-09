import assert from "assert";
import { readFileSync } from "fs";
import { generateBillNo } from "../src/utils/billNumber.js";

function createMockTx() {
  const counters = new Map();
  return {
    counters,
    billCounter: {
      async upsert({ where, create, update, select }) {
        assert.deepStrictEqual(select, { lastNumber: true });
        const shopId = where.shopId;
        if (!counters.has(shopId)) {
          counters.set(shopId, create.lastNumber);
        } else {
          const increment = update.lastNumber.increment;
          counters.set(shopId, counters.get(shopId) + increment);
        }
        return { lastNumber: counters.get(shopId) };
      },
    },
  };
}

async function run() {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert(schema.includes("model BillCounter"), "Prisma schema must include BillCounter model");
  assert(schema.includes("shopId     String   @unique"), "BillCounter.shopId must be unique");
  assert(schema.includes("lastNumber Int"), "BillCounter must track lastNumber");
  assert(schema.includes("billCounter      BillCounter?"), "Shop must expose optional billCounter relation");

  const billNumberSource = readFileSync("src/utils/billNumber.js", "utf8");
  assert(billNumberSource.includes("billCounter.upsert"), "generateBillNo must use BillCounter upsert");
  assert(!billNumberSource.includes("bill.findFirst"), "generateBillNo must not query last bill");
  assert(!billNumberSource.includes("orderBy"), "generateBillNo must not order bills to find last bill");
  assert(billNumberSource.includes("padStart(6"), "Bill numbers must use 6-digit padding");

  const tx = createMockTx();
  const first = await generateBillNo("shop-a", tx);
  const second = await generateBillNo("shop-a", tx);
  const third = await generateBillNo("shop-a", tx);
  const otherShopFirst = await generateBillNo("shop-b", tx);

  assert.match(first, /^KOS-\d{4}-000001$/);
  assert.match(second, /^KOS-\d{4}-000002$/);
  assert.match(third, /^KOS-\d{4}-000003$/);
  assert.match(otherShopFirst, /^KOS-\d{4}-000001$/);
  assert.notStrictEqual(second, third, "Bill numbers must increment per shop");

  console.log("Bill counter examples passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
