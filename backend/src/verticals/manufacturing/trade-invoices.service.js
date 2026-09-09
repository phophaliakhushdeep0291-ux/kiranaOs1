import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { confirmBill } from "../../modules/bills/bills.service.js";
import { calculateInvoiceGst } from "../../utils/gst.js";
import { round2 } from "../../utils/money.js";
import { baseQtyToRateQty } from "../../utils/units.js";
import { createTradeInvoiceSchema } from "./manufacturing.schemas.js";

const include = { items: { include: { allocations: true } }, dispatch: true };
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;
function fail(message, code = "TRADE_INVOICE_DISPATCH_MISMATCH") { throw new AppError(message, 409, code); }
function checkLocation(order, actor) {
  if (actor.locationId && order.locationId !== actor.locationId) throw new AppError("Switch to this order's location before invoicing or returning it", 403, "TRADE_ORDER_LOCATION_MISMATCH");
}

export async function createTradeInvoice(shopId, id, rawInput, actor = {}) {
  const input = createTradeInvoiceSchema.parse(rawInput);
  const order = await db.tradeOrder.findFirst({ where: { id, shopId }, include });
  if (!order) throw new AppError("Trade order not found", 404, "TRADE_ORDER_NOT_FOUND");
  checkLocation(order, actor);
  if (order.billId && ["invoiced", "returned"].includes(order.status)) return order;
  if (order.status !== "dispatched" || !order.dispatch) fail("Dispatch this order before creating its invoice", "TRADE_ORDER_NOT_DISPATCHED");
  if (order.orderType !== "domestic" || order.currencyCode !== "INR" || order.exchangeRate !== 1) {
    fail("Export invoice accounting is not available yet. Keep this order dispatched until its currency and tax treatment can be recorded.", "TRADE_EXPORT_INVOICE_UNAVAILABLE");
  }
  const customerId = order.customerId || input.customerId || undefined;
  if (order.customerId && input.customerId && order.customerId !== input.customerId) fail("Use the buyer already selected for this order", "TRADE_INVOICE_CUSTOMER_MISMATCH");
  if (input.paymentMode === "credit" && !customerId) throw new AppError("Select a customer account for an unpaid invoice", 422, "TRADE_INVOICE_CUSTOMER_REQUIRED");
  const products = await db.product.findMany({ where: { shopId, id: { in: order.items.map(row => row.productId) }, deletedAt: null }, include: { sellingUnits: true } });
  const gstMode = input.billType === "gst_invoice" ? "exclusive" : "none";
  const gst = calculateInvoiceGst(order.items.map(row => ({ lineTotal: row.lineTotal, gstRate: row.gstRate })), 0, gstMode).gst;
  const total = round2(order.items.reduce((sum, row) => sum + Number(row.lineTotal), 0) + gst);
  const body = {
    billType: input.billType, gstMode, locationId: order.locationId,
    customerId, customerName: order.customerName, discount: 0,
    reason: `Wholesale invoice for ${order.orderNumber}`,
    clientBillId: `trade-invoice:${order.id}`, idempotencyKey: `trade-invoice:${order.id}`,
    creditAmount: input.paymentMode === "credit" ? total : 0,
    payments: input.paymentMode === "credit" ? [] : [{ mode: input.paymentMode, amount: total }],
    items: order.items.map(row => {
      const product = products.find(candidate => candidate.id === row.productId);
      const unit = product?.sellingUnits.find(candidate => candidate.id === row.sellingUnitId && candidate.isActive);
      if (!product || (row.sellingUnitId && !unit)) fail("An ordered product or pack is unavailable; review its catalogue entry");
      // Non-pack trade quantities are base units. Convert the stored price to
      // the catalogue rate unit so billing cannot multiply it a second time.
      const rate = unit ? row.unitPrice : round2(row.unitPrice / baseQtyToRateQty(1, product.rateUnit, product.baseUnit));
      return { productId: row.productId, sellingUnitId: row.sellingUnitId || undefined, name: row.description, enteredUnit: unit?.unitCode || product.baseUnit, quantity: row.quantity, ratePerRateUnit: rate, lineDiscount: row.lineDiscount, gstRate: row.gstRate };
    }),
  };
  const fulfilment = {
    async prepare(tx) {
      const claimed = await tx.tradeOrder.updateMany({ where: { id, shopId, status: "dispatched", billId: null }, data: { status: "invoicing" } });
      if (claimed.count !== 1) fail("This order changed. Refresh its invoice status", "TRADE_ORDER_NOT_DISPATCHED");
      const ledger = await tx.stockLedger.findMany({ where: { shopId, sourceType: "trade_order", sourceId: id, action: "trade_dispatch" } });
      if (ledger.length !== order.items.length || ledger.some(row => row.billId)) fail("The dispatch stock record cannot be reconciled");
      const unused = [...ledger];
      for (const item of order.items) {
        const index = unused.findIndex(row => row.productId === item.productId && row.locationId === order.locationId && row.sellingUnitId === item.sellingUnitId && same(-row.changeBaseQty, item.quantityBaseQty) && (!item.sellingUnitId || same(row.sellingUnitQty, item.quantity)));
        if (index < 0 || !same(item.allocations.reduce((sum, row) => sum + row.quantityBaseQty, 0), item.quantityBaseQty)) fail("The dispatch stock record cannot be reconciled");
        unused.splice(index, 1);
      }
      const lots = await tx.inventoryLot.findMany({ where: { shopId, locationId: order.locationId, id: { in: order.items.flatMap(row => row.allocations.map(a => a.inventoryLotId)) } } });
      const batchCeilings = new Map();
      for (const item of order.items) for (const allocation of item.allocations) {
        const lot = lots.find(row => row.id === allocation.inventoryLotId && row.productId === item.productId);
        if (!lot) fail("A dispatched batch is missing from the stock record");
        if (lot.mrp > 0) batchCeilings.set(item.productId, Math.min(batchCeilings.get(item.productId) || Infinity, lot.mrp));
      }
      return { batchCeilings, buyerGstin: order.customerGstin, buyerStateCode: order.customerGstin?.slice(0, 2), buyerAddress: order.billingAddress };
    },
    async recordBill(tx, bill) {
      if (!same(bill.grandTotal, total)) fail("The invoice no longer matches the order value");
      const unused = [...bill.items];
      for (const item of order.items) {
        const index = unused.findIndex(row => row.productId === item.productId && row.sellingUnitId === item.sellingUnitId && same(row.quantity, item.quantity) && same(row.quantityInBaseUnit, item.quantityBaseQty) && same(row.lineTotal, item.lineTotal));
        if (index < 0) fail("Product packaging changed since dispatch; review the order before invoicing");
        const [line] = unused.splice(index, 1);
        await tx.billItemLotAllocation.createMany({ data: item.allocations.map(row => ({ billItemId: line.id, inventoryLotId: row.inventoryLotId, quantityBaseQty: row.quantityBaseQty })) });
      }
      await tx.stockLedger.updateMany({ where: { shopId, sourceType: "trade_order", sourceId: id, action: "trade_dispatch", billId: null }, data: { billId: bill.id } });
      await tx.tradeOrder.update({ where: { id }, data: { billId: bill.id, customerId: customerId || null, status: "invoiced" } });
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
