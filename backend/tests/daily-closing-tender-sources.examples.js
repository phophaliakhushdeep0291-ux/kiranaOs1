import assert from "node:assert/strict";
import db from "../src/db.js";
import { rentalTendersForDay } from "../src/modules/reports/rental-tenders.js";
import { furnitureTendersForDay } from "../src/modules/reports/furniture-tenders.js";

const start = new Date("2026-10-01T18:30:00.000Z");
const end = new Date("2026-10-02T18:29:59.999Z");
const previousDay = new Date(start.getTime() - 1);
const nextDay = new Date(end.getTime() + 1);
const zero = { cash: 0, upi: 0, bank: 0, other: 0 };
const shops = [];
let readSources = [];
db.$use(async (params, next) => {
  const rows = await next(params);
  if (["RentalBooking", "FurnitureOrder"].includes(params.model) && params.action === "findMany") {
    readSources.push(...rows.map((row) => row.id));
  }
  return rows;
});

try {
  for (const name of ["Tender locations", "Other tenant"]) {
    shops.push(await db.shop.create({ data: { name, ownerName: "Owner", city: "Test", address: "Test" } }));
  }
  const [shop, foreignShop] = shops;
  const primary = await db.storeLocation.create({ data: { shopId: shop.id, code: "MAIN", name: "Main", isPrimary: true } });
  const branch = await db.storeLocation.create({ data: { shopId: shop.id, code: "BRANCH", name: "Branch" } });
  const foreignLocation = await db.storeLocation.create({ data: { shopId: foreignShop.id, code: "MAIN", name: "Foreign", isPrimary: true } });

  for (const { kind, model, sourceType, tenders } of [
    { kind: "rental", model: "rentalBooking", sourceType: "rental", tenders: rentalTendersForDay },
    { kind: "furniture", model: "furnitureOrder", sourceType: "furniture_order", tenders: furnitureTendersForDay },
  ]) {
    const createSource = async (label, extra = {}, client = db) => client[model].create({
      data: {
        shopId: shop.id, locationId: primary.id, customerName: "Test",
        ...(kind === "rental"
          ? { bookingNumber: label, customerPhone: "", fromDate: previousDay, toDate: previousDay }
          : { orderNumber: label, quotedOn: previousDay }),
        ...extra,
      },
    });
    const main = await createSource("main");
    const other = await createSource("branch", { locationId: branch.id });
    const legacy = await createSource("legacy", { locationId: null });
    const deleted = await createSource("deleted", { deletedAt: previousDay });
    const cancelled = await createSource("cancelled", { status: "cancelled" });
    // Deliberately use this tenant's location on another tenant's source to
    // prove that the source lookup checks shopId as well as locationId.
    const foreign = await createSource("foreign", { shopId: foreignShop.id });
    const history = await createSource("old-only");
    const noTender = await createSource("non-tender-only");
    const missing = { id: `missing-${kind}` };
    let sequence = 0;
    const post = (source, amountPaise, mode = "cash", extra = {}, client = db) => client.financialLedger.create({
      data: {
        shopId: shop.id, sourceType, sourceId: source.id, entryType: `${kind}_${mode}`,
        direction: amountPaise < 0n ? "out" : "in", amountPaise,
        businessDate: start, idempotencyKey: `${kind}-${sequence++}`, ...extra,
      },
    });
    await post(main, 10001n);
    await post(main, -1000n); // Refund/application keeps its negative sign.
    await post(main, 201n, "upi");
    await post(main, 301n, "bank");
    await post(main, 401n, "other");
    await post(other, 2002n);
    await post(legacy, 3003n);
    await post(deleted, 404n, "cash", { businessDate: end });
    await post(cancelled, 505n);
    await post(foreign, 606n);
    await post(missing, 707n);
    await post(history, 90000n, "cash", { businessDate: previousDay });
    await post(main, 80000n, "cash", { businessDate: nextDay });
    await post(noTender, 70000n, "receivable");
    await post(main, 60000n, "cash", { sourceType: "unrelated" });
    await post(main, 50000n, "cash", { shopId: foreignShop.id });

    // The report must not hydrate orders/bookings with no tender on this day.
    // Count returned rows rather than prescribe a particular query spelling.
    for (let i = 0; i < 40; i++) await createSource(`history-${i}`);
    readSources = [];
    const primaryExpected = { cash: kind === "rental" ? 99.1 : 129.13, upi: 2.01, bank: 3.01, other: 4.01 };
    assert.deepEqual(await tenders(db, shop.id, { start, end, locationId: primary.id }), primaryExpected);
    assert.deepEqual(new Set(readSources), new Set([
      main.id, deleted.id, cancelled.id, ...(kind === "furniture" ? [legacy.id] : []),
    ]), `${kind}: only sources with tender activity that day should be read`);
    assert.deepEqual(await tenders(db, shop.id, { start, end, locationId: branch.id }), { ...zero, cash: 20.02 });
    assert.deepEqual(await tenders(db, shop.id, { start, end, locationId: foreignLocation.id }), zero);
    assert.deepEqual(await tenders(db, shop.id, { start, end, locationId: "missing-location" }), zero);
    readSources = [];
    assert.deepEqual(await tenders(db, shop.id, { start, end }), {
      cash: 162.28, upi: 2.01, bank: 3.01, other: 4.01,
    }, "unscoped totals retain legacy and orphan events, but exclude other tenants");
    assert.equal(readSources.length, 0, "unscoped totals do not need source lookups");
    assert.deepEqual(await tenders(db, shop.id, {
      start: new Date("2027-01-01"), end: new Date("2027-01-02"), locationId: primary.id,
    }), zero);
    assert.equal(readSources.length, 0, "a day without tenders does not need source lookups");

    // Source subtotals must stay BigInt until they have been combined. Turning
    // each source into Number first loses paise when large entries cancel.
    // Also prove all reads use the supplied transaction and see pending writes.
    const rollback = new Error("rollback tender fixture");
    await assert.rejects(db.$transaction(async (tx) => {
      const pending = await createSource("pending", {}, tx);
      await post(main, 9007199254740992n, "cash", {}, tx);
      await post(deleted, -9007199254740992n, "cash", {}, tx);
      await post(pending, 1n, "cash", {}, tx);
      assert.deepEqual(await tenders(tx, shop.id, { start, end, locationId: primary.id }), {
        ...primaryExpected, cash: kind === "rental" ? 99.11 : 129.14,
      });
      throw rollback;
    }), (error) => error === rollback);
    assert.deepEqual(await tenders(db, shop.id, { start, end, locationId: primary.id }), primaryExpected);
  }
  console.log("Daily closing tender sources: date bounds, locations, tenants, signed paise, and bounded reads passed.");
} finally {
  const shopId = { in: shops.map((shop) => shop.id) };
  await db.financialLedger.deleteMany({ where: { shopId } });
  await db.rentalBooking.deleteMany({ where: { shopId } });
  await db.furnitureOrder.deleteMany({ where: { shopId } });
  await db.storeLocation.deleteMany({ where: { shopId } });
  await db.shop.deleteMany({ where: { id: shopId } });
  await db.$disconnect();
}
