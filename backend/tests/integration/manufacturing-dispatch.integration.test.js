import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, assertSuccess } from "./setup.js";
import { createTenant, createProduct, createCustomer, login } from "./factories.js";
import { settingsForBusinessType } from "../../src/verticals/registry.js";
import { createTradeInvoice } from "../../src/verticals/manufacturing/trade-invoices.service.js";
import { cancelBill, createSaleReturn, confirmBill } from "../../src/modules/bills/bills.service.js";
import { buildTradePdf } from "../../src/verticals/manufacturing/trade-documents.service.js";
import * as production from "../../src/verticals/manufacturing/manufacturing.service.js";
import * as trade from "../../src/verticals/manufacturing/trade-orders.service.js";
import { createTradeOrderSchema } from "../../src/verticals/manufacturing/manufacturing.schemas.js";
import { buildInvoiceTaxSnapshot } from "../../src/modules/compliance/compliance.service.js";
import { round2 } from "../../src/utils/money.js";
const ctx = await createIntegrationContext();
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
let sequence = 8779091200;
if (ctx.skip) test("manufacturing dispatch unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  async function fixture({ gstRate = 0 } = {}) {
    const tenant = await createTenant(ctx.db, { ownerMobile: String(sequence++) });
    const { shop } = tenant;
    await ctx.db.shop.update({ where: { id: shop.id }, data: { settingsJson: JSON.stringify(settingsForBusinessType("manufacturing")) } });
    const raw = await createProduct(ctx.db, shop.id, { stockBaseQty: 100 });
    const finished = await createProduct(ctx.db, shop.id, { stockBaseQty: 0, gstRate });
    await ctx.db.product.update({ where: { id: finished.id }, data: { batchTrackingEnabled: true, packagingMode: "per_pack" } });
    const unit = (name, conversionToBase) => ctx.db.productSellingUnit.create({ data: { shopId: shop.id, productId: finished.id, name, unitType: "pack", unitCode: name, conversionToBase, onHandQty: 0, defaultPrice: 20 } });
    const bag = await unit("bag", 2); const carton = await unit("carton", 5);
    const bom = await production.createBom(shop.id, { finishedProductId: finished.id, name: "Dispatch recipe", outputQuantityBaseQty: 20, items: [{ materialProductId: raw.id, quantityBaseQty: 20, wastagePercent: 0 }] });
    const run = await production.createRun(shop.id, { bomId: bom.id, runNumber: "RUN", plannedOutputBaseQty: 20 });
    await production.completeRun(shop.id, run.id, { actualOutputBaseQty: 20, finishedBatchNumber: "FINISHED", manufacturedOn: day(), expiresOn: day(365), qcStatus: "conditional", consumptions: [{ productId: raw.id, actualBaseQty: 20 }], outputs: [{ sellingUnitId: bag.id, packageCount: 5, quantityBaseQty: 10 }, { sellingUnitId: carton.id, packageCount: 2, quantityBaseQty: 10 }] });
    const lot = await ctx.db.inventoryLot.findFirst({ where: { producedByRunId: run.id } });
    const orderInput = createTradeOrderSchema.parse({ orderNumber: "ORDER", customerName: "QA Buyer", items: [{ productId: finished.id, sellingUnitId: bag.id, quantity: 5, unitPrice: 20 }, { productId: finished.id, sellingUnitId: carton.id, quantity: 2, unitPrice: 40 }] });
    const order = await trade.createTradeOrder(shop.id, orderInput);
    await trade.confirmTradeOrder(shop.id, order.id);
    return { ...tenant, shopId: shop.id, raw, finished, bag, carton, run, lot, order, orderInput };
  }
  async function dispatchedFixture(options) {
    const f = await fixture(options); await production.releaseRun(f.shopId, f.run.id);
    const allocated = await trade.autoAllocateTradeOrder(f.shopId, f.order.id);
    await trade.packTradeOrder(f.shopId, f.order.id, { items: allocated.items.map(row => ({ orderItemId: row.id, packedQuantity: row.quantity })) });
    await trade.dispatchTradeOrder(f.shopId, f.order.id, { dispatchNumber: "DSP-1", dispatchDate: day() });
    return f;
  }
  test("held production cannot allocate; release enables mixed-pack allocation, packing and exactly one dispatch", async () => {
    const f = await fixture();
    await assert.rejects(() => trade.autoAllocateTradeOrder(f.shopId, f.order.id), { code: "TRADE_ALLOCATION_STOCK_SHORT" });
    await production.releaseRun(f.shopId, f.run.id);
    const allocated = await trade.autoAllocateTradeOrder(f.shopId, f.order.id, { locationId: f.run.locationId });
    assert.equal(allocated.status, "allocated");
    assert.equal(allocated.items.flatMap(row => row.allocations).reduce((sum, row) => sum + row.quantityBaseQty, 0), 20);
    const second = await trade.createTradeOrder(f.shopId, { ...f.orderInput, orderNumber: "COMPETING" });
    await trade.confirmTradeOrder(f.shopId, second.id);
    await assert.rejects(() => trade.autoAllocateTradeOrder(f.shopId, second.id), { code: "TRADE_ALLOCATION_STOCK_SHORT" });
    await trade.packTradeOrder(f.shopId, f.order.id, { items: allocated.items.map(item => ({ orderItemId: item.id, packedQuantity: item.quantity })) });
    const payload = { dispatchNumber: "DSP-1", dispatchDate: day() };
    await assert.rejects(() => trade.dispatchTradeOrder(f.shopId, f.order.id, payload, { locationId: "elsewhere" }), { code: "TRADE_ORDER_LOCATION_MISMATCH" });
    const dispatched = await trade.dispatchTradeOrder(f.shopId, f.order.id, payload, { locationId: f.run.locationId });
    assert.equal(dispatched.status, "dispatched");
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.finished.id } })).stockBaseQty, 0);
    for (const unitId of [f.bag.id, f.carton.id]) assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: unitId } })).onHandQty, 0);
    assert.equal((await ctx.db.inventoryLot.findUnique({ where: { id: f.lot.id } })).status, "depleted");
    const ledger = await ctx.db.stockLedger.findMany({ where: { sourceId: f.order.id } });
    assert.equal(ledger.length, 2); assert.equal(ledger.reduce((sum, row) => sum + row.changeBaseQty, 0), -20);
    await assert.rejects(() => trade.dispatchTradeOrder(f.shopId, f.order.id, payload), { code: "TRADE_ORDER_NOT_PACKED" });
    await assert.rejects(() => trade.cancelTradeOrder(f.shopId, f.order.id), { code: "TRADE_ORDER_CANNOT_CANCEL" });
    assert.equal(await ctx.db.tradeDispatch.count({ where: { orderId: f.order.id } }), 1);
    assert.equal((await trade.tradeDocuments(f.shopId, f.order.id)).packingList.items.length, 2);
  });
  test("allocation rejects expired stock, wrong packaging and combined overbooking across order lines", async () => {
    const f = await fixture(); await production.releaseRun(f.shopId, f.run.id);
    const allocations = f.order.items.map(item => ({ orderItemId: item.id, inventoryLotId: f.lot.id, quantityBaseQty: item.quantityBaseQty }));
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { expiresOn: new Date(day(-1)) } });
    await assert.rejects(() => trade.allocateTradeOrder(f.shopId, f.order.id, { allocations }), { code: "TRADE_ALLOCATION_BATCH_INVALID" });
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { expiresOn: new Date(day(365)), availableBaseQty: 15 } });
    await assert.rejects(() => trade.allocateTradeOrder(f.shopId, f.order.id, { allocations }), { code: "TRADE_ALLOCATION_STOCK_SHORT" });
    await assert.rejects(() => trade.autoAllocateTradeOrder(f.shopId, f.order.id), { code: "TRADE_ALLOCATION_STOCK_SHORT" });
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { availableBaseQty: 20, sellingUnitId: f.bag.id } });
    await assert.rejects(() => trade.allocateTradeOrder(f.shopId, f.order.id, { allocations }), { code: "TRADE_ALLOCATION_PACKAGING_MISMATCH" });
    assert.equal((await trade.getTradeOrder(f.shopId, f.order.id)).status, "confirmed");
    assert.equal(await ctx.db.tradeOrderAllocation.count({ where: { shopId: f.shopId } }), 0);
    await assert.rejects(() => trade.createTradeOrder(f.shopId, { ...f.orderInput, orderNumber: "NO-PACK", items: [{ ...f.orderInput.items[0], sellingUnitId: null }] }), { code: "TRADE_ORDER_PACKAGING_REQUIRED" });
  });
  test("expiry after packing and a later pack shortage roll back dispatch and every earlier stock movement", async () => {
    const f = await fixture(); await production.releaseRun(f.shopId, f.run.id);
    const order = await trade.autoAllocateTradeOrder(f.shopId, f.order.id);
    await trade.packTradeOrder(f.shopId, f.order.id, { items: order.items.map(item => ({ orderItemId: item.id, packedQuantity: item.quantity })) });
    const payload = { dispatchNumber: "DSP-1", dispatchDate: day() };
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { expiresOn: new Date(day(-1)) } });
    await assert.rejects(() => trade.dispatchTradeOrder(f.shopId, f.order.id, payload), { code: "TRADE_DISPATCH_BATCH_STOCK_CHANGED" });
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { expiresOn: new Date(day(365)) } });
    await ctx.db.productSellingUnit.update({ where: { id: f.carton.id }, data: { onHandQty: 0 } });
    await assert.rejects(() => trade.dispatchTradeOrder(f.shopId, f.order.id, payload), { code: "TRADE_DISPATCH_PACK_STOCK_SHORT" });
    assert.equal((await trade.getTradeOrder(f.shopId, f.order.id)).status, "packed");
    assert.equal((await ctx.db.inventoryLot.findUnique({ where: { id: f.lot.id } })).availableBaseQty, 20);
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.finished.id } })).stockBaseQty, 20);
    assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: f.bag.id } })).onHandQty, 5);
    assert.equal(await ctx.db.stockLedger.count({ where: { sourceId: f.order.id } }), 0);
    assert.equal(await ctx.db.tradeDispatch.count({ where: { orderId: f.order.id } }), 0);
  });

  test("HTTP invoice and full return reconcile two packs from one batch without repeating stock or money", async () => {
    const f = await dispatchedFixture();
    const auth = await login(ctx, f.ownerMobile, f.ownerPassword);
    const options = { token: auth.accessToken, ownerPin: f.ownerPin, headers: { "x-location-id": f.run.locationId } };
    const url = `/api/manufacturing/trade-orders/${f.order.id}`;
    await assert.rejects(() => buildTradePdf(f.shopId, f.order.id, "tax-invoice"), { code: "TRADE_ORDER_INVOICE_REQUIRED" });
    assert.equal((await ctx.post(`${url}/invoice`, { billId: "unrelated-bill" }, options)).ok, false);
    assert.equal((await ctx.post(`${url}/invoice`, { paymentMode: "bank" }, { ...options, ownerPin: undefined })).status, 403);
    const invoiced = assertSuccess(await ctx.post(`${url}/invoice`, { paymentMode: "bank" }, options), 201);
    assert.equal(invoiced.status, "invoiced");
    const bill = await ctx.db.bill.findUnique({ where: { id: invoiced.billId }, include: { items: true, payments: true } });
    assert.equal(bill.grandTotal, 180); assert.equal(bill.payments[0].amount, 180);
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.finished.id } })).stockBaseQty, 0);
    for (const unit of [f.bag, f.carton]) assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: unit.id } })).onHandQty, 0);
    assert.equal((await ctx.db.inventoryLot.findUnique({ where: { id: f.lot.id } })).availableBaseQty, 0);
    assert.equal(await ctx.db.stockLedger.count({ where: { billId: bill.id } }), 2);
    assert.equal(await ctx.db.stockLedger.count({ where: { billId: bill.id, action: "sale" } }), 0);
    assert.equal(await ctx.db.billItemLotAllocation.count({ where: { billItem: { billId: bill.id } } }), 2);
    assert.equal((await buildTradePdf(f.shopId, f.order.id, "tax-invoice")).subarray(0, 5).toString(), "%PDF-");
    const repeated = assertSuccess(await ctx.post(`${url}/invoice`, { paymentMode: "bank" }, options), 201);
    assert.equal(repeated.billId, bill.id);
    await assert.rejects(() => cancelBill(f.shopId, bill.id, { reason: "Wrong route" }), { code: "TRADE_INVOICE_USE_ORDER_RETURN" });
    await assert.rejects(() => createSaleReturn(f.shopId, { returnOfBillId: bill.id, items: [{ originalBillItemId: bill.items[0].id, quantity: 1 }] }), { code: "TRADE_INVOICE_USE_ORDER_RETURN" });
    const returned = assertSuccess(await ctx.post(`${url}/return`, { reason: "Buyer returned all packs", refundMode: "bank" }, options), 201);
    assert.equal(returned.order.status, "returned"); assert.equal(returned.creditNote.grandTotal, -180);
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.finished.id } })).stockBaseQty, 20);
    assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: f.bag.id } })).onHandQty, 5);
    assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: f.carton.id } })).onHandQty, 2);
    assert.equal((await ctx.db.inventoryLot.findUnique({ where: { id: f.lot.id } })).availableBaseQty, 20);
    const again = assertSuccess(await ctx.post(`${url}/return`, { reason: "Retry after lost response", refundMode: "bank" }, options), 201);
    assert.equal(again.creditNote.id, returned.creditNote.id);
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 2);
    assert.equal((await ctx.db.payment.aggregate({ where: { shopId: f.shopId }, _sum: { amount: true } }))._sum.amount, 0);
    const saleEntries = await ctx.db.financialLedger.findMany({ where: { shopId: f.shopId, entryType: "sale" } });
    assert.ok(saleEntries.length >= 2);
    assert.equal(saleEntries.reduce((sum, row) => sum + row.amountPaise, 0n), 0n);
  });

  test("unpaid invoice requires a buyer account and its return reverses credit without inventing a cash refund", async () => {
    const f = await dispatchedFixture(); const actor = { ownerPinVerified: true, locationId: f.run.locationId };
    await assert.rejects(() => createTradeInvoice(f.shopId, f.order.id, { paymentMode: "credit" }, actor), { code: "TRADE_INVOICE_CUSTOMER_REQUIRED" });
    const customer = await createCustomer(ctx.db, f.shopId);
    const order = await createTradeInvoice(f.shopId, f.order.id, { paymentMode: "credit", customerId: customer.id }, actor);
    assert.equal((await ctx.db.bill.findUnique({ where: { id: order.billId } })).creditAmount, 180);
    const returned = await trade.returnTradeOrder(f.shopId, f.order.id, { refundMode: "bank", reason: "Order returned unpaid" }, actor);
    assert.equal(returned.creditNote.refundMode, "udhar"); assert.equal(returned.creditNote.creditAmount, -180);
    assert.equal(await ctx.db.payment.count({ where: { shopId: f.shopId } }), 0);
    assert.equal((await ctx.db.customer.findUnique({ where: { id: customer.id } })).udharAmount, 0);
  });

  test("changed packaging and broken return trace roll back all invoice and return effects", async () => {
    const f = await dispatchedFixture(); const actor = { ownerPinVerified: true, locationId: f.run.locationId };
    await assert.rejects(() => createTradeInvoice(f.shopId, f.order.id, { paymentMode: "bank" }, { ...actor, locationId: "other" }), { code: "TRADE_ORDER_LOCATION_MISMATCH" });
    await ctx.db.productSellingUnit.update({ where: { id: f.carton.id }, data: { conversionToBase: 6 } });
    await assert.rejects(() => createTradeInvoice(f.shopId, f.order.id, { paymentMode: "bank" }, actor), { code: "TRADE_INVOICE_DISPATCH_MISMATCH" });
    assert.equal((await trade.getTradeOrder(f.shopId, f.order.id)).status, "dispatched");
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 0);
    assert.equal(await ctx.db.financialLedger.count({ where: { shopId: f.shopId } }), 0);
    await ctx.db.productSellingUnit.update({ where: { id: f.carton.id }, data: { conversionToBase: 5 } });
    const order = await createTradeInvoice(f.shopId, f.order.id, { paymentMode: "bank" }, actor);
    const allocations = await ctx.db.billItemLotAllocation.findMany({ where: { billItem: { billId: order.billId } } });
    await ctx.db.billItemLotAllocation.delete({ where: { id: allocations.at(-1).id } });
    await assert.rejects(() => trade.returnTradeOrder(f.shopId, f.order.id, { reason: "Buyer returned order", refundMode: "bank" }, actor), { code: "TRADE_INVOICE_DISPATCH_MISMATCH" });
    assert.equal((await trade.getTradeOrder(f.shopId, f.order.id)).status, "invoiced");
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 1);
    assert.equal((await ctx.db.inventoryLot.findUnique({ where: { id: f.lot.id } })).availableBaseQty, 0);
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.finished.id } })).stockBaseQty, 0);
  });

  test("GST invoices preserve saved totals and identity, and reverse GST with the credit note", async () => {
    const f = await dispatchedFixture({ gstRate: 5 }); const actor = { ownerPinVerified: true, locationId: f.run.locationId };
    await assert.rejects(() => createTradeInvoice(f.shopId, f.order.id, { paymentMode: "bank", billType: "gst_invoice" }, actor), { code: "SELLER_GSTIN_REQUIRED" });
    assert.equal((await trade.getTradeOrder(f.shopId, f.order.id)).status, "dispatched");
    await ctx.db.shop.update({ where: { id: f.shopId }, data: { gstNumber: "27AAPFU0939F1ZV" } });
    const order = await createTradeInvoice(f.shopId, f.order.id, { paymentMode: "bank", billType: "gst_invoice" }, actor);
    const bill = await ctx.db.bill.findUnique({ where: { id: order.billId } });
    assert.equal(bill.grandTotal, 189); assert.equal(bill.gst, 9); assert.equal(bill.sellerGstin, "27AAPFU0939F1ZV");
    const returned = await trade.returnTradeOrder(f.shopId, f.order.id, { reason: "All goods returned", refundMode: "bank" }, actor);
    assert.equal(returned.creditNote.gst, -9); assert.equal(returned.creditNote.grandTotal, -189);
    const tax = await ctx.db.financialLedger.findMany({ where: { shopId: f.shopId, entryType: "gst_output" } });
    assert.equal(tax.reduce((sum, row) => sum + row.amountPaise, 0n), 0n);
    assert.equal((await ctx.db.inventoryLot.findUnique({ where: { id: f.lot.id } })).availableBaseQty, 20);
  });

  test("an untracked product is refused when the order is created, not after it is confirmed", async () => {
    const f = await fixture();
    // The raw material has no batch tracking. Accepting it left an order that
    // confirmed, then reported "insufficient batches" with the shelf full.
    await assert.rejects(() => trade.createTradeOrder(f.shopId, { ...f.orderInput, orderNumber: "UNTRACKED", items: [{ productId: f.raw.id, quantity: 5, unitPrice: 10, lineDiscount: 0 }] }), { code: "TRADE_ORDER_BATCH_TRACKING_REQUIRED" });
    assert.equal(await ctx.db.tradeOrder.count({ where: { shopId: f.shopId, orderNumber: "UNTRACKED" } }), 0);
  });

  test("tax invoice names the place of supply and splits GST by it; documents name each pack", async () => {
    // Text runs are uncompressed; only PDF string escapes need undoing.
    const pdfText = async (shopId, orderId, kind) => (await buildTradePdf(shopId, orderId, kind)).toString("latin1").replace(/\\([()\\])/g, "$1");
    const local = await dispatchedFixture({ gstRate: 5 }); const actor = { ownerPinVerified: true, locationId: local.run.locationId };
    await ctx.db.shop.update({ where: { id: local.shopId }, data: { gstNumber: "27AAPFU0939F1ZV" } });
    const packing = await pdfText(local.shopId, local.order.id, "packing-list");
    assert.match(packing, /\(bag\)/); assert.match(packing, /\(carton\)/);
    await createTradeInvoice(local.shopId, local.order.id, { paymentMode: "bank", billType: "gst_invoice" }, actor);
    const intrastate = await pdfText(local.shopId, local.order.id, "tax-invoice");
    assert.match(intrastate, /Place of supply: 27 - Maharashtra/);
    assert.match(intrastate, /CGST: INR 4\.50/); assert.match(intrastate, /SGST: INR 4\.50/);
    assert.doesNotMatch(intrastate, /IGST: INR/);

    const remote = await dispatchedFixture({ gstRate: 5 }); const remoteActor = { ownerPinVerified: true, locationId: remote.run.locationId };
    await ctx.db.shop.update({ where: { id: remote.shopId }, data: { gstNumber: "27AAPFU0939F1ZV" } });
    const buyer = await createCustomer(ctx.db, remote.shopId, { gstNumber: "29AABCS1429B1ZQ", stateCode: "29", address: "12 APMC Yard, Bengaluru" });
    await createTradeInvoice(remote.shopId, remote.order.id, { paymentMode: "credit", billType: "gst_invoice", customerId: buyer.id }, remoteActor);
    const interstate = await pdfText(remote.shopId, remote.order.id, "tax-invoice");
    assert.match(interstate, /Place of supply: 29 - Karnataka/);
    assert.match(interstate, /IGST: INR 9\.00/);
    assert.doesNotMatch(interstate, /CGST: INR/);
    // The buyer chosen at invoicing now supplies the packing list's ship-to.
    assert.match(await pdfText(remote.shopId, remote.order.id, "packing-list"), /12 APMC Yard, Bengaluru/);
  });

  test("counter payloads cannot skip stock and export accounting cannot silently book foreign prices as INR", async () => {
    const f = await dispatchedFixture(); const actor = { ownerPinVerified: true };
    await assert.rejects(() => confirmBill(f.shopId, {
      billType: "normal_sale", discount: 0, gstMode: "none", reason: "QA forged fulfilment", payments: [{ mode: "bank", amount: 20 }],
      fulfilment: {}, skipStock: true, dispatchedOrderId: f.order.id,
      items: [{ productId: f.finished.id, sellingUnitId: f.bag.id, quantity: 1, enteredUnit: "bag", ratePerRateUnit: 20, gstRate: 0 }],
    }, actor), /Insufficient stock/);
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 0);
    // An export must carry the facts its invoice is built from before anything is
    // booked: without them the foreign price would land in the books as INR.
    await ctx.db.tradeOrder.update({ where: { id: f.order.id }, data: { orderType: "export", currencyCode: "USD", exchangeRate: 90 } });
    await assert.rejects(() => createTradeInvoice(f.shopId, f.order.id, { paymentMode: "bank" }, actor), { code: "TRADE_EXPORT_DESTINATION_REQUIRED" });
    await ctx.db.tradeOrder.update({ where: { id: f.order.id }, data: { countryOfDestination: "Kenya", exchangeRate: 0 } });
    await assert.rejects(() => createTradeInvoice(f.shopId, f.order.id, { paymentMode: "bank" }, actor), { code: "TRADE_EXPORT_EXCHANGE_RATE_REQUIRED" });
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 0);
    // A domestic order can never carry a foreign price either.
    await ctx.db.tradeOrder.update({ where: { id: f.order.id }, data: { orderType: "domestic", exchangeRate: 90 } });
    await assert.rejects(() => createTradeInvoice(f.shopId, f.order.id, { paymentMode: "bank" }, actor), { code: "TRADE_ORDER_CURRENCY_INVALID" });
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 0);
  });

  test("an export under LUT books INR at the exchange rate and charges no IGST", async () => {
    const f = await dispatchedFixture({ gstRate: 18 });
    // An export invoice is a tax invoice, so the seller must be GST registered.
    await ctx.db.shop.update({ where: { id: f.shopId }, data: { gstNumber: "27AAPFU0939F1ZV" } });
    await ctx.db.tradeOrder.update({ where: { id: f.order.id }, data: {
      orderType: "export", currencyCode: "USD", exchangeRate: 90, countryOfDestination: "Kenya",
      countryOfOrigin: "India", iec: "0388011156", lutBondReference: "AD2909230012345",
      incoterm: "FOB", portOfLoading: "INNSA1", portOfDischarge: "KEMBA",
    } });
    const invoiced = await createTradeInvoice(f.shopId, f.order.id, { paymentMode: "bank" }, { ownerPinVerified: true });
    assert.equal(invoiced.status, "invoiced");
    const bill = await ctx.db.bill.findFirst({ where: { id: invoiced.billId }, include: { items: true } });
    // 5 bags at $20 and 2 cartons at $40 is $180; at 90 that is Rs 16,200.
    assert.equal(bill.grandTotal, 16200, "the books are INR, converted at the order's rate");
    assert.equal(bill.gst, 0, "an LUT export is zero-rated without payment of IGST");
    assert.equal(bill.billType, "gst_invoice", "an export is always invoiced as a tax invoice");
    assert.equal(bill.buyerStateCode, "96", "an export leaves India, so place of supply is Other Country");
    assert.deepEqual(bill.items.map(row => row.ratePerRateUnit).sort((a, b) => a - b), [1800, 3600]);
    assert.equal(bill.items.every(row => Number(row.gstRate) === 0), true);
    // The order keeps its own currency; only the accounting record is converted.
    assert.equal(invoiced.currencyCode, "USD");
    assert.equal(invoiced.items.reduce((sum, row) => sum + Number(row.lineTotal), 0), 180);
    const pdf = await buildTradePdf(f.shopId, f.order.id, "commercial-invoice");
    const text = pdf.toString("latin1");
    assert.match(text, /EXPORT INVOICE/);
    assert.match(text, /without payment of IGST/);
  });

  test("an export without an LUT charges IGST, never a CGST and SGST split", async () => {
    const f = await dispatchedFixture({ gstRate: 18 });
    await ctx.db.shop.update({ where: { id: f.shopId }, data: { gstNumber: "27AAPFU0939F1ZV" } });
    await ctx.db.tradeOrder.update({ where: { id: f.order.id }, data: {
      orderType: "export", currencyCode: "USD", exchangeRate: 90, countryOfDestination: "Kenya", iec: "0388011156",
    } });
    const invoiced = await createTradeInvoice(f.shopId, f.order.id, { paymentMode: "bank" }, { ownerPinVerified: true });
    const bill = await ctx.db.bill.findFirst({ where: { id: invoiced.billId }, include: { items: true } });
    assert.equal(bill.gst, 2916, "18% of Rs 16,200 is charged and reclaimed later");
    assert.equal(bill.grandTotal, 19116);
    const snapshot = buildInvoiceTaxSnapshot(bill, bill.sellerStateCode || "");
    assert.equal(snapshot.lines.every(line => line.tax.supplyType === "interstate"), true);
    assert.equal(snapshot.lines.every(line => line.tax.cgst === 0 && line.tax.sgst === 0), true);
    assert.equal(round2(snapshot.lines.reduce((sum, line) => sum + line.tax.igst, 0)), 2916);
    const text = (await buildTradePdf(f.shopId, f.order.id, "commercial-invoice")).toString("latin1");
    assert.match(text, /on payment of IGST/);
    assert.match(text, /Kenya/);
  });
}
