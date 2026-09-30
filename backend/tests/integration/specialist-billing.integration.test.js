import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, createProduct, login, billPayload } from "./factories.js";
import { registerSaleGuard } from "../../src/shared/sale-guards.js";
import { confirmBill, restoreCancelledBill } from "../../src/modules/bills/bills.service.js";
import { confirmBillSchema } from "../../src/modules/bills/bills.schema.js";
import { settingsForBusinessType } from "../../src/verticals/registry.js";

/**
 * A trade's own record of a sale, written by the bill that made it.
 *
 * An electronics shop's IMEI register and a chemist's prescription register
 * used to be a second act after the bill, and the second act is the one a busy
 * counter forgets. These pin the joined-up version against a real database:
 * the record and the bill commit together or not at all, two counters cannot
 * both have the same handset or the same one-time slip — and, the half that is
 * easy to get wrong, neither register is ever a reason to lose a sale that has
 * already happened.
 */

const ctx = await createIntegrationContext();
if (ctx.skip) test("specialist billing requires a database", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));

  /** One shop, one product in stock and — unless it is a medicine — one registered unit of it. */
  async function fixture({ stock = 10, schedule, trade } = {}) {
    const tenant = await createTenant(ctx.db);
    if (trade) {
      await ctx.db.shop.update({ where: { id: tenant.shop.id }, data: { settingsJson: JSON.stringify(settingsForBusinessType(trade)) } });
    }
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const credentials = { token: auth.accessToken, ownerPin: tenant.ownerPin };
    // Activates this token's device once, before any test races two requests on it.
    assertSuccess(await ctx.get("/api/orders", credentials));
    const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: stock, defaultPricePerRateUnit: 50, costPerRateUnit: 30 });
    if (schedule) await ctx.db.product.update({ where: { id: product.id }, data: { drugSchedule: schedule } });
    const unit = schedule ? null : await registerUnit({ tenant, product }, "SERIAL-ONE");
    const payload = (overrides) => {
      const body = billPayload(product, { quantity: 1, ...overrides });
      body.clientBillId = randomUUID();
      if (unit) body.items[0].trackedUnitId = unit.id;
      return body;
    };
    return { tenant, product, unit, credentials, payload };
  }

  const registerUnit = (f, serialNumber, overrides = {}) => ctx.db.productUnit.create({
    data: { shopId: f.tenant.shop.id, productId: f.product.id, productName: f.product.name, serialNumber, warrantyMonths: 12, ...overrides },
  });
  const sale = (f, body = f.payload()) => ctx.post("/api/bills/confirm", body, f.credentials);
  const stock = (f) => ctx.db.product.findUniqueOrThrow({ where: { id: f.product.id } }).then((product) => product.stockBaseQty);
  const unitRow = (f, id = f.unit.id) => ctx.db.productUnit.findUniqueOrThrow({ where: { id } });
  const billCount = (f) => ctx.db.bill.count({ where: { shopId: f.tenant.shop.id } });

  /** The same bill as the sync engine hands it over: a sale that was made before the server heard of it. */
  const replay = (f, body) => confirmBill(f.tenant.shop.id, confirmBillSchema.parse(body), {
    userId: f.tenant.owner.id,
    isOfflineReplay: true,
    allowStockShortfall: true,
    businessDate: new Date().toISOString(),
  });

  /* ── Electronics: the handset a bill line sold ─────────────────────────── */

  test("one sale links serial, stock, receipt and warranty together; a retry is harmless", async () => {
    const f = await fixture();
    const payload = f.payload();
    payload.customerMobile = "+91 98765 43210";
    const bill = assertSuccess(await sale(f, payload), 201);
    const retried = assertSuccess(await sale(f, payload), 201);

    assert.equal(retried.id, bill.id);
    assert.equal(await stock(f), 9);
    const unit = await unitRow(f);
    assert.equal(unit.billId, bill.id);
    assert.equal(unit.status, "sold");
    assert.ok(unit.warrantyUntil, "cover starts with the sale");
    // Stored the way the register is searched — ten digits, however it was typed.
    assert.equal(unit.customerPhone, "9876543210");
    assert.equal(bill.items[0].trackedUnitId, unit.id);
    assert.match(bill.items[0].note, /SERIAL-ONE/, "the receipt line names the handset");

    const listed = assertSuccess(await ctx.get("/api/bills", f.credentials));
    assert.equal(listed.bills[0].items[0].trackedUnitId, unit.id, "the bills list carries the link a return needs");
    assert.equal(await billCount(f), 1);
  });

  test("an estimate reserves its serial because estimates move stock", async () => {
    const f = await fixture();
    assertSuccess(await sale(f, { ...f.payload(), billType: "estimate" }), 201);
    assert.equal((await unitRow(f)).status, "sold");
    assert.equal(await stock(f), 9);
    assertFailure(await sale(f), 409);
  });

  test("a line with no serial is still a sale", async () => {
    // A box that arrived this morning and has not been scanned, a till on an
    // older version, a plan that no longer includes the register: the shop is
    // holding the customer's money either way. The counter asks the cashier;
    // the server does not strand the bill.
    const f = await fixture();
    const body = f.payload();
    delete body.items[0].trackedUnitId;

    const bill = assertSuccess(await sale(f, body), 201);
    assert.equal(bill.items[0].trackedUnitId ?? null, null);
    assert.equal(await stock(f), 9);
    assert.equal((await unitRow(f)).status, "in_stock", "the register is left for the shop to catch up");
  });

  test("a serial that cannot be honoured refuses the whole bill", async () => {
    const f = await fixture();
    const other = await createProduct(ctx.db, f.tenant.shop.id, { stockBaseQty: 5, defaultPricePerRateUnit: 50 });
    const otherUnit = await ctx.db.productUnit.create({
      data: { shopId: f.tenant.shop.id, productId: other.id, productName: other.name, serialNumber: "OTHER-MODEL" },
    });
    const stranger = await createTenant(ctx.db);
    const strangerProduct = await createProduct(ctx.db, stranger.shop.id);
    const strangerUnit = await ctx.db.productUnit.create({
      data: { shopId: stranger.shop.id, productId: strangerProduct.id, productName: strangerProduct.name, serialNumber: "NOT-OURS" },
    });

    for (const [why, id] of [["unknown", "no-such-unit"], ["another shop's", strangerUnit.id], ["another model's", otherUnit.id]]) {
      const body = f.payload();
      body.items[0].trackedUnitId = id;
      const refused = assertFailure(await sale(f, body), 409);
      assert.equal(refused.code, "TRACKED_UNIT_UNKNOWN", `${why} unit`);
    }

    // The same handset twice on one bill.
    const twice = f.payload();
    twice.items.push({ ...twice.items[0] });
    twice.actualAmount = 100; twice.buyerPaidAmount = 100; twice.payments = [{ mode: "cash", amount: 100 }];
    assert.equal(assertFailure(await sale(f, twice), 409).code, "TRACKED_UNIT_UNAVAILABLE");

    // Two pieces against one serial.
    const pair = f.payload({ quantity: 2 });
    assert.equal(assertFailure(await sale(f, pair), 409).code, "TRACKED_UNIT_QUANTITY");

    // One that is away being repaired, named so the counter knows which.
    await ctx.db.productUnit.update({ where: { id: f.unit.id }, data: { status: "rma" } });
    const away = assertFailure(await sale(f), 409);
    assert.equal(away.code, "TRACKED_UNIT_UNAVAILABLE");
    assert.match(away.error, /SERIAL-ONE.*service centre/);

    assert.equal(await stock(f), 10);
    assert.equal(await billCount(f), 0);
  });

  test("two counters racing for one serial produce exactly one sale", async () => {
    const f = await fixture();
    const results = await Promise.all([sale(f), sale(f)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal(await stock(f), 9);
    assert.equal(await billCount(f), 1);
  });

  test("a downstream failure rolls back the serial reservation and all money", async () => {
    registerSaleGuard(async ({ body }) => (body.clientBillId === "rollback-proof"
      ? { onConfirmed: async () => { throw Error("Intentional downstream rollback test"); } }
      : null));
    const f = await fixture();
    const result = await sale(f, { ...f.payload(), clientBillId: "rollback-proof" });

    assert.ok(result.status >= 400, JSON.stringify(result));
    assert.equal((await unitRow(f)).status, "in_stock");
    assert.equal(await billCount(f), 0);
    assert.equal(await ctx.db.payment.count({ where: { shopId: f.tenant.shop.id } }), 0);
  });

  test("cancellation releases the serial, restoration reclaims it, and a return brings back exactly that unit", async () => {
    const f = await fixture();
    const bill = assertSuccess(await sale(f), 201);

    assertSuccess(await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Cancelled at counter" }, f.credentials));
    assert.equal((await unitRow(f)).status, "in_stock");
    assert.equal(await stock(f), 10);

    await restoreCancelledBill(f.tenant.shop.id, bill.id, { reason: "Undo cancellation" });
    assert.equal((await unitRow(f)).status, "sold");
    assert.equal(await stock(f), 9);

    const body = {
      returnOfBillId: bill.id, clientBillId: randomUUID(), reason: "Customer return", refundMode: "cash",
      items: [{ ...f.payload().items[0], originalBillItemId: bill.items[0].id }],
    };
    // Half a handset cannot come back.
    assertFailure(await ctx.post("/api/bills/returns", { ...body, items: [{ ...body.items[0], quantity: 0.5 }] }, f.credentials), 409);
    assert.equal((await unitRow(f)).status, "sold");

    const returned = assertSuccess(await ctx.post("/api/bills/returns", body, f.credentials), 201);
    const unit = await unitRow(f);
    assert.equal(unit.status, "returned");
    assert.equal(unit.condition, "open_box", "a returned handset does not go back on the shelf as new");
    assert.equal(await stock(f), 10);

    assert.equal(assertSuccess(await ctx.post("/api/bills/returns", body, f.credentials), 201).id, returned.id);
    assert.equal(await stock(f), 10);

    // Back on the shelf as open box, it can be sold again — to a new bill.
    const resold = assertSuccess(await sale(f), 201);
    assert.equal((await unitRow(f)).billId, resold.id);
  });

  test("a unit a bill sold is taken back through the bill, never by the register alone", async () => {
    // The register's own take-back moves no stock and refunds nothing. For a
    // unit recorded by hand against a typed bill number that is all there is;
    // for one a bill line sold it would put a handset on the shelf that the
    // stock count never heard about.
    const f = await fixture({ trade: "electronics" });
    assertSuccess(await sale(f), 201);
    const refused = assertFailure(await ctx.post(`/api/product-units/${f.unit.id}/return`, {}, f.credentials), 409);
    assert.equal(refused.code, "UNIT_RETURN_FROM_BILL");
    assert.equal((await unitRow(f)).status, "sold");

    const byHand = await registerUnit(f, "SERIAL-BY-HAND");
    assertSuccess(await ctx.post(`/api/product-units/${byHand.id}/sell`, { billNumber: "KOS-OLD-0007" }, f.credentials));
    assertSuccess(await ctx.post(`/api/product-units/${byHand.id}/return`, {}, f.credentials));
    assert.equal((await unitRow(f, byHand.id)).status, "returned");
  });

  test("a refund or a cancellation does not wait for a register that has moved on", async () => {
    // Sold, came back faulty, went to the service centre — and then the shop
    // decides to refund. The unit is no longer "sold on this bill", which is
    // the register's business; the customer's money is the bill's.
    const f = await fixture();
    const bill = assertSuccess(await sale(f), 201);
    await ctx.db.productUnit.update({ where: { id: f.unit.id }, data: { status: "rma" } });

    assertSuccess(await ctx.post("/api/bills/returns", {
      returnOfBillId: bill.id, clientBillId: randomUUID(), reason: "Faulty", refundMode: "cash",
      items: [{ ...f.payload().items[0], originalBillItemId: bill.items[0].id }],
    }, f.credentials), 201);
    assert.equal(await stock(f), 10);
    assert.equal((await unitRow(f)).status, "rma", "its own history is left as it is");

    // The same for a bill cancelled after its unit was put in the recycle bin.
    const second = await registerUnit(f, "SERIAL-TWO");
    const body = f.payload();
    body.items[0].trackedUnitId = second.id;
    const another = assertSuccess(await sale(f, body), 201);
    await ctx.db.productUnit.update({ where: { id: second.id }, data: { deletedAt: new Date() } });

    assertSuccess(await ctx.post(`/api/bills/${another.id}/cancel`, { reason: "Wrong customer" }, f.credentials));
    assert.equal(await stock(f), 10);
    assert.equal((await unitRow(f, second.id)).status, "sold");
  });

  test("a sale replayed from an offline till is recorded without reserving a serial", async () => {
    const f = await fixture();
    // Sold at another counter in the meantime — live, this serial would refuse the bill.
    await ctx.db.productUnit.update({ where: { id: f.unit.id }, data: { status: "sold", billNumber: "KOS-ELSEWHERE" } });
    assertFailure(await sale(f), 409);

    const bill = await replay(f, f.payload());
    assert.equal(bill.items[0].trackedUnitId ?? null, null, "the line is kept, unlinked");
    assert.equal(await stock(f), 9);
    assert.equal((await unitRow(f)).billNumber, "KOS-ELSEWHERE", "the register still says what it knew");
  });

  test("billing is told which products are sold by serial, oldest stock first", async () => {
    const f = await fixture({ trade: "electronics" });
    const untracked = await createProduct(ctx.db, f.tenant.shop.id, { name: "Charger" });
    await registerUnit(f, "SERIAL-NEWER", { receivedAt: new Date(Date.now() + 60_000) });
    await registerUnit(f, "SERIAL-GONE", { status: "sold" });
    await registerUnit(f, "SERIAL-BINNED", { deletedAt: new Date() });

    const options = assertSuccess(await ctx.get(`/api/product-units/billing-options?productIds=${f.product.id},${untracked.id},,${f.product.id}`, f.credentials));
    assert.equal(options.length, 1, "a product the register never saw gets no control");
    assert.equal(options[0].productId, f.product.id);
    assert.equal(options[0].registered, 3);
    assert.equal(options[0].sellableCount, 2);
    assert.deepEqual(options[0].units.map((unit) => unit.serialNumber), ["SERIAL-ONE", "SERIAL-NEWER"]);

    assert.deepEqual(assertSuccess(await ctx.get("/api/product-units/billing-options", f.credentials)), []);
    const tooMany = Array.from({ length: 101 }, (_, index) => `p${index}`).join(",");
    assertFailure(await ctx.get(`/api/product-units/billing-options?productIds=${tooMany}`, f.credentials), 400);
  });

  test("the register says so when it holds more units than stock does", async () => {
    // How a sale made without its serial is noticed afterwards: one IMEI still
    // "in stock" against a count of none means that handset has left.
    const f = await fixture({ trade: "electronics", stock: 1 });
    const summary = () => ctx.get("/api/product-units/summary", f.credentials).then((response) => assertSuccess(response).shelfMismatches);
    assert.deepEqual(await summary(), []);

    const body = f.payload();
    delete body.items[0].trackedUnitId;
    assertSuccess(await sale(f, body), 201);

    assert.deepEqual(await summary(), [{ productId: f.product.id, productName: f.product.name, registered: 1, stock: 0 }]);

    // Stock ahead of the register is ordinary — a box arrives before it is scanned.
    await ctx.db.product.update({ where: { id: f.product.id }, data: { stockBaseQty: 7 } });
    assert.deepEqual(await summary(), []);
  });

  /* ── Pharmacy: the slip a bill dispenses ───────────────────────────────── */

  async function prescription(f, { refillsAllowed = 0, unit = "piece", qty = 1, scheduleType = "otc", items } = {}) {
    return ctx.db.prescription.create({
      data: {
        shopId: f.tenant.shop.id, registerNumber: "RX-ONE", doctorName: "QA Doctor", patientName: "QA Patient",
        prescribedOn: new Date(), scheduleType, refillsAllowed,
        items: { create: items ?? [{ productId: f.product.id, name: f.product.name, qty, unit }] },
      },
    });
  }
  const slip = (id) => ctx.db.prescription.findUniqueOrThrow({ where: { id } });

  test("a medicine counted in strips bills, dispenses and returns without inventing a pack size", async () => {
    const f = await fixture({ schedule: "otc" });
    await ctx.db.product.update({ where: { id: f.product.id }, data: { baseUnit: "strip", rateUnit: "strip", displayUnit: "strip" } });
    const rx = await prescription(f, { unit: "strip", qty: 2 });
    const body = { ...f.payload({ quantity: 2, enteredUnit: "strip" }), prescriptionId: rx.id };
    const bill = assertSuccess(await sale(f, body), 201);
    assert.equal(bill.items[0].quantityInBaseUnit, 2);
    assert.equal(bill.grandTotal, 100);
    assert.equal(bill.items[0].lineCost, 60);
    assert.equal(await stock(f), 8);
    assert.equal((await slip(rx.id)).billId, bill.id);
    assert.equal((await slip(rx.id)).status, "dispensed");
    assert.equal(assertSuccess(await sale(f, body), 201).id, bill.id);
    assert.equal(await stock(f), 8);
    const returned = assertSuccess(await ctx.post("/api/bills/returns", {
      returnOfBillId: bill.id, clientBillId: randomUUID(), reason: "Wrong medicine", refundMode: "cash",
      items: [{ productId: f.product.id, originalBillItemId: bill.items[0].id, name: f.product.name, quantity: 1, enteredUnit: "strip", ratePerRateUnit: 50 }],
    }, f.credentials), 201);
    assert.equal(returned.grandTotal, -50);
    assert.equal(await stock(f), 9);
  });

  test("an attached OTC prescription is dispensed with its bill, while a retry does not spend a refill", async () => {
    const f = await fixture({ schedule: "otc" });
    const rx = await prescription(f, { refillsAllowed: 1 });
    const body = { ...f.payload(), prescriptionId: rx.id };
    const bill = assertSuccess(await sale(f, body), 201);
    assertSuccess(await sale(f, body), 201);

    let saved = await slip(rx.id);
    assert.equal(saved.status, "dispensed");
    assert.equal(saved.billId, bill.id);
    assert.equal(saved.refillsUsed, 0);

    assertSuccess(await sale(f, { ...f.payload(), prescriptionId: rx.id }), 201);
    saved = await slip(rx.id);
    assert.equal(saved.refillsUsed, 1);

    assertFailure(await sale(f, { ...f.payload(), prescriptionId: rx.id }), 409);
    assert.equal(await stock(f), 8);
  });

  test("two counters cannot consume a one-use prescription twice", async () => {
    const f = await fixture({ schedule: "h" });
    const rx = await prescription(f, { scheduleType: "h" });
    const results = await Promise.all([
      sale(f, { ...f.payload(), prescriptionId: rx.id }),
      sale(f, { ...f.payload(), prescriptionId: rx.id }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal(await stock(f), 9);
  });

  test("a bill hands over what the slip says, and says which medicine when it does not", async () => {
    const f = await fixture({ schedule: "h" });
    const other = await createProduct(ctx.db, f.tenant.shop.id, { name: "Unlisted antibiotic", stockBaseQty: 5, defaultPricePerRateUnit: 50 });
    await ctx.db.product.update({ where: { id: other.id }, data: { drugSchedule: "h" } });
    const rx = await prescription(f, { scheduleType: "h", qty: 2, unit: "strip" });
    const attached = (body) => sale(f, { ...body, prescriptionId: rx.id });

    // In a unit the slip does not give.
    const wrongUnit = assertFailure(await attached(f.payload()), 409);
    assert.equal(wrongUnit.code, "PRESCRIPTION_ITEMS_MISMATCH");
    assert.match(wrongUnit.error, new RegExp(`${f.product.name} is prescribed in strip but billed in piece`));

    // More than the slip allows.
    const tooMany = assertFailure(await attached(f.payload({ quantity: 3, enteredUnit: "strip" })), 409);
    assert.match(tooMany.error, /3 strip on the bill, but prescription RX-ONE allows 2/);

    // A restricted medicine the slip does not mention.
    const unlisted = billPayload(other, { quantity: 1 });
    unlisted.clientBillId = randomUUID();
    assert.match(assertFailure(await attached(unlisted), 409).error, /Unlisted antibiotic is not on prescription RX-ONE/);

    assert.equal(await billCount(f), 0);
    assert.equal((await slip(rx.id)).status, "pending");

    // What the slip says, under the words the till uses for the pack: the entry
    // reads "strip", the pack is labelled "Strip 10s".
    const pack = await ctx.db.productSellingUnit.create({
      data: {
        shopId: f.tenant.shop.id, productId: f.product.id, name: "Strip 10s", unitType: "strip", unitCode: "strip",
        conversionToBase: 1, defaultPrice: 50, isDefault: true,
      },
    });
    const right = f.payload({ quantity: 2 });
    Object.assign(right.items[0], { sellingUnitId: pack.id, sellingUnitCode: pack.unitCode, sellingUnitLabel: pack.name, enteredUnit: pack.name });
    assertSuccess(await attached(right), 201);
    assert.equal((await slip(rx.id)).status, "dispensed");
    assert.equal(await stock(f), 8);
  });

  test("a replayed sale is held to the slip being valid, not to its lines", async () => {
    // Until the line check existed any valid slip authorised the sale. A till
    // still on that version must not find a sale it made parked as a conflict.
    const f = await fixture({ schedule: "h" });
    const rx = await prescription(f, { scheduleType: "h", unit: "strip" });
    assertFailure(await sale(f, { ...f.payload(), prescriptionId: rx.id }), 409);

    const bill = await replay(f, { ...f.payload(), prescriptionId: rx.id });
    assert.equal((await slip(rx.id)).billId, bill.id);

    // Still never without a slip at all: that is the law, not bookkeeping.
    await assert.rejects(replay(f, f.payload()), { code: "PRESCRIPTION_REQUIRED_FOR_SCHEDULE" });

    // And an OTC bill that names a used-up slip is taken as it always was.
    const otc = await createProduct(ctx.db, f.tenant.shop.id, { name: "Paracetamol", stockBaseQty: 5, defaultPricePerRateUnit: 50 });
    const otcBody = billPayload(otc, { quantity: 1 });
    otcBody.clientBillId = randomUUID();
    assertFailure(await sale(f, { ...otcBody, prescriptionId: rx.id }), 409);
    const replayed = await replay(f, { ...otcBody, prescriptionId: rx.id });
    assert.ok(replayed.id);
    assert.equal((await slip(rx.id)).billId, bill.id, "the slip is left untouched");
  });
}
