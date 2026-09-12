import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { confirmBill } from "../../modules/bills/bills.service.js";
import { calculateInvoiceGst, GST_EXPORT_STATE_CODE } from "../../utils/gst.js";
import { multiplyMoney, round2, subtractMoney } from "../../utils/money.js";
import { baseQtyToRateQty } from "../../utils/units.js";
import { createTradeInvoiceSchema } from "./manufacturing.schemas.js";

const include = { items: { include: { allocations: true } }, dispatches: { orderBy: { dispatchDate: "asc" } } };
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;
function fail(message, code = "TRADE_INVOICE_DISPATCH_MISMATCH") { throw new AppError(message, 409, code); }
/**
 * An export is zero-rated either way. The LUT/Bond is the instrument that decides
 * which way: hold one and no IGST is charged at all; hold none and IGST is
 * charged on the invoice and reclaimed as a refund afterwards.
 */
export function exportTaxTreatment(order) {
  const underLut = Boolean(order.lutBondReference);
  return {
    underLut,
    declaration: underLut
      ? `Supply meant for export under LUT/Bond without payment of IGST. LUT/Bond ${order.lutBondReference}`
      : "Supply meant for export on payment of IGST",
  };
}

function checkLocation(order, actor) {
  if (actor.locationId && order.locationId !== actor.locationId) throw new AppError("Switch to this order's location before invoicing or returning it", 403, "TRADE_ORDER_LOCATION_MISMATCH");
}

export async function createTradeInvoice(shopId, id, rawInput, actor = {}) {
  const input = createTradeInvoiceSchema.parse(rawInput);
  const order = await db.tradeOrder.findFirst({ where: { id, shopId }, include });
  if (!order) throw new AppError("Trade order not found", 404, "TRADE_ORDER_NOT_FOUND");
  checkLocation(order, actor);
  if (order.billId && ["invoiced", "returned"].includes(order.status)) return order;
  // An order shipped in parts is billed per consignment, oldest first, so goods
  // that left the building last month are not billed on this month's invoice.
  const dispatch = order.dispatches.find((row) => !row.billId);
  if (!dispatch) {
    if (order.dispatches.length > 0) return order;
    fail("Dispatch this order before creating its invoice", "TRADE_ORDER_NOT_DISPATCHED");
  }
  if (!["dispatched", "partially_dispatched"].includes(order.status)) fail("Dispatch this order before creating its invoice", "TRADE_ORDER_NOT_DISPATCHED");
  // Only what this consignment actually carried is billable.
  const shippedBase = new Map(order.items.map((item) => [item.id, round2(item.allocations.filter((row) => row.dispatchId === dispatch.id).reduce((sum, row) => sum + Number(row.quantityBaseQty), 0))]));
  const billable = order.items.filter((item) => shippedBase.get(item.id) > 0.001);
  if (billable.length === 0) fail("This consignment shipped nothing to invoice", "TRADE_INVOICE_NOTHING_SHIPPED");
  const isExport = order.orderType === "export";
  const treatment = isExport ? exportTaxTreatment(order) : null;
  const fx = Number(order.exchangeRate);
  if (isExport) {
    // The books stay in INR — GST is filed in INR and Bill carries no currency
    // column. The foreign figures remain on the order and on the commercial
    // invoice, which is where a buyer and a customs officer look for them.
    if (!(fx > 0)) fail("Record a positive exchange rate before invoicing this export", "TRADE_EXPORT_EXCHANGE_RATE_REQUIRED");
    if (!order.countryOfDestination) fail("Record the country of destination before invoicing this export", "TRADE_EXPORT_DESTINATION_REQUIRED");
  } else if (order.currencyCode !== "INR" || fx !== 1) {
    fail("A domestic order must be priced in INR at an exchange rate of 1", "TRADE_ORDER_CURRENCY_INVALID");
  }
  const customerId = order.customerId || input.customerId || undefined;
  if (order.customerId && input.customerId && order.customerId !== input.customerId) fail("Use the buyer already selected for this order", "TRADE_INVOICE_CUSTOMER_MISMATCH");
  if (input.paymentMode === "credit" && !customerId) throw new AppError("Select a customer account for an unpaid invoice", 422, "TRADE_INVOICE_CUSTOMER_REQUIRED");
  const products = await db.product.findMany({ where: { shopId, id: { in: order.items.map(row => row.productId) }, deletedAt: null }, include: { sellingUnits: true } });
  // An export is always invoiced as a tax invoice: the zero-rating declaration is
  // part of the document, not an optional extra.
  const billType = isExport ? "gst_invoice" : input.billType;
  const gstMode = billType === "gst_invoice" ? "exclusive" : "none";
  // Price every line the way confirmBill will, in INR. Converting the order's own
  // line total instead and comparing the two drifts by paise per line, and the
  // dispatch reconciliation below compares them for equality. At fx = 1 this is
  // arithmetically identical to what a domestic order produced before.
  const priced = billable.map((row) => {
    const product = products.find(candidate => candidate.id === row.productId);
    const unit = product?.sellingUnits.find(candidate => candidate.id === row.sellingUnitId && candidate.isActive);
    if (!product || (row.sellingUnitId && !unit)) fail("An ordered product or pack is unavailable; review its catalogue entry");
    // Non-pack trade quantities are base units. Convert the stored price to the
    // catalogue rate unit so billing cannot multiply it a second time.
    const rate = round2(Number(row.unitPrice) * fx / (unit ? 1 : baseQtyToRateQty(1, product.rateUnit, product.baseUnit)));
    // This consignment's share of the line, in the line's own selling unit.
    const shippedQty = round2(shippedBase.get(row.id) / (Number(row.quantityBaseQty) / Number(row.quantity)));
    const qtyInRateUnit = unit ? shippedQty : baseQtyToRateQty(shippedBase.get(row.id), product.rateUnit, product.baseUnit);
    const gross = multiplyMoney(rate, qtyInRateUnit);
    // A line discount belongs to the whole line, so each consignment carries the
    // share matching the quantity it ships.
    const lineDiscount = Math.min(round2(Math.max(0, Number(row.lineDiscount) * fx) * shippedBase.get(row.id) / Number(row.quantityBaseQty)), gross);
    const lineTotal = subtractMoney(gross, lineDiscount);
    // The invoice has to be the order the buyer agreed to. A domestic line priced
    // here must land on the order's own line total to the paise, as it always had
    // to; an export line can drift only by the rounding of its converted unit rate.
    // More than that means the catalogue's units or packs changed under the order.
    // A consignment carrying part of a line is measured against that part: the
    // rest of the line is still owed and will be billed when it ships.
    const shippedShare = shippedBase.get(row.id) / Number(row.quantityBaseQty);
    const expected = Number(row.lineTotal) * fx * shippedShare;
    const tolerance = (isExport ? 0.005 * (qtyInRateUnit + 1) + 0.01 : 0.001) + (shippedShare < 1 ? 0.01 : 0);
    if (Math.abs(lineTotal - expected) > tolerance) {
      fail("The invoice no longer matches the order value; review the order's prices and packaging before invoicing", "TRADE_INVOICE_ORDER_VALUE_MISMATCH");
    }
    return {
      row, product, unit, rate, lineDiscount, shippedQty, lineTotal,
      // Zero-rated under an LUT; otherwise IGST at the item's own rate.
      gstRate: treatment?.underLut ? 0 : Number(row.gstRate),
    };
  });
  const gst = calculateInvoiceGst(priced.map(line => ({ lineTotal: line.lineTotal, gstRate: line.gstRate })), 0, gstMode).gst;
  const total = round2(priced.reduce((sum, line) => sum + line.lineTotal, 0) + gst);
  const body = {
    billType, gstMode, locationId: order.locationId,
    customerId, customerName: order.customerName, discount: 0,
    reason: `${isExport ? "Export" : "Wholesale"} invoice for ${order.orderNumber}`,
    // Keyed on the consignment, not the order: an order shipped in two parts
    // needs two invoices, and an order-keyed idempotency guard silently returned
    // the first bill for the second shipment, leaving those goods unbilled.
    clientBillId: `trade-invoice:${dispatch.id}`, idempotencyKey: `trade-invoice:${dispatch.id}`,
    creditAmount: input.paymentMode === "credit" ? total : 0,
    payments: input.paymentMode === "credit" ? [] : [{ mode: input.paymentMode, amount: total }],
    items: priced.map(({ row, product, unit, rate, lineDiscount, gstRate, shippedQty }) => ({
      productId: row.productId, sellingUnitId: row.sellingUnitId || undefined, name: row.description,
      enteredUnit: unit?.unitCode || product.baseUnit, quantity: shippedQty,
      ratePerRateUnit: rate, lineDiscount, gstRate,
    })),
  };
  const fulfilment = {
    async prepare(tx) {
      // Serialise on the order, as before: two invoices for the same order must
      // not interleave even when they are for different consignments.
      const claimed = await tx.tradeOrder.updateMany({ where: { id, shopId, status: { in: ["dispatched", "partially_dispatched"] } }, data: { status: "invoicing" } });
      if (claimed.count !== 1) fail("This order changed. Refresh its invoice status", "TRADE_ORDER_NOT_DISPATCHED");
      const stillOpen = await tx.tradeDispatch.count({ where: { id: dispatch.id, shopId, billId: null } });
      if (stillOpen !== 1) fail("This consignment is already invoiced", "TRADE_ORDER_NOT_DISPATCHED");
      // Scoped to this consignment's own stock rows, so a second shipment cannot
      // be billed twice and the first cannot be billed on the second's invoice.
      const ledger = await tx.stockLedger.findMany({ where: { shopId, sourceType: "trade_dispatch", sourceId: dispatch.id, action: "trade_dispatch" } });
      if (ledger.length !== billable.length || ledger.some(row => row.billId)) fail("The dispatch stock record cannot be reconciled");
      const unused = [...ledger];
      for (const item of billable) {
        const shipped = shippedBase.get(item.id);
        const shippedQty = round2(shipped / (Number(item.quantityBaseQty) / Number(item.quantity)));
        const index = unused.findIndex(row => row.productId === item.productId && row.locationId === order.locationId && row.sellingUnitId === item.sellingUnitId && same(-row.changeBaseQty, shipped) && (!item.sellingUnitId || same(row.sellingUnitQty, shippedQty)));
        if (index < 0) fail("The dispatch stock record cannot be reconciled");
        unused.splice(index, 1);
      }
      const consignmentAllocations = (item) => item.allocations.filter(row => row.dispatchId === dispatch.id);
      const lots = await tx.inventoryLot.findMany({ where: { shopId, locationId: order.locationId, id: { in: billable.flatMap(row => consignmentAllocations(row).map(a => a.inventoryLotId)) } } });
      const batchCeilings = new Map();
      for (const item of billable) for (const allocation of consignmentAllocations(item)) {
        const lot = lots.find(row => row.id === allocation.inventoryLotId && row.productId === item.productId);
        if (!lot) fail("A dispatched batch is missing from the stock record");
        if (lot.mrp > 0) batchCeilings.set(item.productId, Math.min(batchCeilings.get(item.productId) || Infinity, lot.mrp));
      }
      return {
        batchCeilings,
        buyerGstin: isExport ? null : order.customerGstin,
        // Every export is an inter-State supply. The shared tax breakdown has to see
        // a state that is not the seller's, or it splits the tax into CGST + SGST as
        // though the goods never left India.
        buyerStateCode: isExport ? GST_EXPORT_STATE_CODE : order.customerGstin?.slice(0, 2),
        buyerAddress: order.billingAddress,
      };
    },
    async recordBill(tx, bill) {
      if (!same(bill.grandTotal, total)) fail("The invoice no longer matches the order value");
      const unused = [...bill.items];
      for (const { row: item, lineTotal, shippedQty } of priced) {
        const index = unused.findIndex(row => row.productId === item.productId && row.sellingUnitId === item.sellingUnitId && same(row.quantity, shippedQty) && same(row.quantityInBaseUnit, shippedBase.get(item.id)) && same(row.lineTotal, lineTotal));
        if (index < 0) fail("Product packaging changed since dispatch; review the order before invoicing");
        const [line] = unused.splice(index, 1);
        await tx.billItemLotAllocation.createMany({ data: item.allocations.filter(row => row.dispatchId === dispatch.id).map(row => ({ billItemId: line.id, inventoryLotId: row.inventoryLotId, quantityBaseQty: row.quantityBaseQty })) });
      }
      await tx.stockLedger.updateMany({ where: { shopId, sourceType: "trade_dispatch", sourceId: dispatch.id, action: "trade_dispatch", billId: null }, data: { billId: bill.id } });
      await tx.tradeDispatch.update({ where: { id: dispatch.id }, data: { billId: bill.id } });
      // The order is only finished when nothing is owed and every consignment has
      // been billed; until then it stays open for the next one.
      const openConsignments = await tx.tradeDispatch.count({ where: { shopId, orderId: id, billId: null } });
      const outstanding = order.items.reduce((sum, item) => sum + Math.max(0, round2(Number(item.quantityBaseQty) - round2(item.allocations.filter(row => row.dispatchId).reduce((total, row) => total + Number(row.quantityBaseQty), 0)))), 0);
      const status = outstanding > 0.001 || openConsignments > 0 ? "partially_dispatched" : "invoiced";
      await tx.tradeOrder.update({ where: { id }, data: { billId: bill.id, customerId: customerId || null, status } });
    },
  };
  const bill = await confirmBill(shopId, body, actor, fulfilment);
  const updated = await db.tradeOrder.findFirst({ where: { id, shopId }, include });
  if (updated.billId !== bill.id) fail("This invoice identity is already in use; review the order", "TRADE_INVOICE_IDENTITY_CONFLICT");
  return updated;
}

export function tradeReturnFulfilment(shopId, order, actor) {
  checkLocation(order, actor);
  return {
    async prepare(tx, original) {
      if (original?.id !== order.billId) fail("The return does not match the dispatched invoice");
      const claimed = await tx.tradeOrder.updateMany({ where: { id: order.id, shopId, billId: original.id, status: "invoiced" }, data: { status: "returning" } });
      if (claimed.count !== 1) fail("This order changed. Refresh its return status", "TRADE_ORDER_NOT_RETURNABLE");
      if (await tx.bill.count({ where: { shopId, returnOfBillId: original.id, status: "active" } })) fail("This invoice already has a return; review its credit notes", "TRADE_INVOICE_HAS_RETURNS");
    },
    async restoreLots(tx, original, returnBill) {
      const allocations = await tx.billItemLotAllocation.findMany({ where: { billItem: { billId: original.id }, quantityBaseQty: { gt: 0 } }, include: { inventoryLot: true } });
      for (const line of returnBill.items) {
        const sources = allocations.filter(row => row.billItemId === line.originalBillItemId);
        if (!same(sources.reduce((sum, row) => sum + row.quantityBaseQty, 0), Math.abs(line.quantityInBaseUnit))) fail("The invoice's batch trace does not cover this return");
        for (const source of sources) {
          const status = ["quarantined", "recalled"].includes(source.inventoryLot.status) ? source.inventoryLot.status : "active";
          await tx.inventoryLot.update({ where: { id: source.inventoryLotId }, data: { availableBaseQty: { increment: source.quantityBaseQty }, status } });
          await tx.billItemLotAllocation.create({ data: { billItemId: line.id, inventoryLotId: source.inventoryLotId, quantityBaseQty: -source.quantityBaseQty } });
        }
      }
      await tx.tradeOrder.update({ where: { id: order.id }, data: { status: "returned" } });
    },
  };
}
