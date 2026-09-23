import { createHash } from "node:crypto";
import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { serializableTransaction } from "../../../lib/transactions.js";
import { confirmBill } from "../../../modules/bills/bills.service.js";
import { confirmBillSchema } from "../../../modules/bills/bills.schema.js";
import { dispatchIntegrationDeliveries } from "../../../modules/integrations/integrations.service.js";
import { resolveOperationalLocation } from "../../../modules/stores/location-context.service.js";
import { baseQtyToRateQty } from "../../../utils/units.js";
import { multiplyMoney, round2, toPaise } from "../../../utils/money.js";
import { requireFurnitureAccounting } from "./order-finance.js";
import { createOrderInvoiceSchema } from "./orders.schema.js";
import { getOrder, requiredOrderAudit, serializeOrder, setOrderStatusInTransaction } from "./orders.service.js";

const include = { items: { orderBy: { id: "asc" } }, payments: { orderBy: { id: "asc" } } };
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nameKey = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const phoneKey = (value) => String(value ?? "").replace(/\D/g, "").slice(-10);
const fail = (message, code = "ORDER_INVOICE_REVIEW") => { throw new AppError(message, 409, code); };

function requireOpen(order) {
  if (order.status !== "ready" || order.billId) fail("Only a ready order without a bill can be invoiced here.");
}

function checkLocation(order, location) {
  if (order.locationId ? order.locationId !== location.id : !location.isPrimary) {
    throw new AppError("Switch to this order's branch before creating its invoice.", 403, "ORDER_INVOICE_LOCATION");
  }
}

function matchesCustomer(order, customer) {
  return nameKey(order.customerName) === nameKey(customer.name)
    && (!phoneKey(order.customerPhone) || phoneKey(order.customerPhone) === phoneKey(customer.mobile));
}

// The agreed order prices are per base unit. Invoice them through the same
// selected pack/rate conversion as ordinary billing, retaining exact paise.
async function invoiceLines(client, order) {
  const products = await client.product.findMany({ where: { shopId: order.shopId, deletedAt: null,
    id: { in: order.items.map((row) => row.productId).filter(Boolean) } },
    include: { sellingUnits: { where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { id: "asc" }] } },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines = order.items.map((row) => {
    const product = row.productId ? byId.get(row.productId) : null;
    if (row.productId && !product) fail("An ordered product is no longer available. Review the order first.");
    const unit = product?.sellingUnits[0];
    const quantity = unit ? Number(row.qty) / Number(unit.conversionToBase) : Number(row.qty);
    const rateQuantity = product && !unit ? baseQtyToRateQty(quantity, product.rateUnit, product.baseUnit) : quantity;
    const rate = round2(Number(row.amount) / rateQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || toPaise(multiplyMoney(rate, rateQuantity)) !== toPaise(row.amount)) {
      fail("The catalogue packaging cannot represent this order's price exactly. Review its quantities and rates.");
    }
    return { lineId: row.id, amount: Number(row.amount), name: row.name,
      productId: row.productId || undefined, sellingUnitId: unit?.id,
      quantity, enteredUnit: unit?.unitCode ?? product?.baseUnit ?? "piece",
      ratePerRateUnit: rate, gstRate: Number(product?.gstRate ?? 0), hsn: product?.hsn || undefined,
      note: [row.variant, row.notes].filter(Boolean).join("; ") || undefined,
    };
  });
  for (const [lineId, name, amount] of [["delivery", "Delivery", order.deliveryCharge], ["installation", "Installation", order.installCharge]]) {
    if (amount > 0) lines.push({ lineId, name, amount: Number(amount), quantity: 1, enteredUnit: "piece", ratePerRateUnit: Number(amount), gstRate: 0 });
  }
  return lines;
}

function previewToken(order, lines) {
  return hash({ order, lines });
}

export async function previewOrderInvoice(shopId, id, actor = {}) {
  const order = await db.furnitureOrder.findFirst({ where: { shopId, id, deletedAt: null }, include });
  if (!order) throw new AppError("Order not found", 404);
  requireOpen(order);
  const location = await resolveOperationalLocation(shopId, actor.locationId ?? order.locationId);
  checkLocation(order, location);
  await requireFurnitureAccounting(db, order);
  const lines = await invoiceLines(db, order);
  const customers = order.customerId ? [] : (await db.customer.findMany({ where: { shopId, deletedAt: null }, select: { id: true, name: true, mobile: true } }))
    .filter((customer) => matchesCustomer(order, customer));
  return { order: serializeOrder(order), lines, customers, previewToken: previewToken(order, lines) };
}

function requestSignature(input) {
  return hash({ taxMode: input.taxMode, customerId: input.customerId ?? null, reason: input.reason,
    taxes: [...input.taxes].sort((a, b) => a.lineId.localeCompare(b.lineId)) });
}

export async function createOrderInvoice(shopId, id, rawInput, actor = {}) {
  const input = createOrderInvoiceSchema.parse(rawInput);
  if (!actor.ownerPinVerified) throw new AppError("Owner PIN required to confirm the invoice and delivery.", 403, "OWNER_PIN_REQUIRED");
  // Resolve/create the primary location before entering the serializable sale.
  const location = await resolveOperationalLocation(shopId, actor.locationId);
  const signature = requestSignature(input);
  const result = await serializableTransaction(async (tx) => {
    const order = await tx.furnitureOrder.findFirst({ where: { shopId, id, deletedAt: null }, include });
    if (!order) throw new AppError("Order not found", 404);
    checkLocation(order, location);
    if (order.billId) {
      const audit = await tx.auditLog.findFirst({ where: { shopId, entityId: id, action: "FURNITURE_ORDER_INVOICED" } });
      if (!audit || JSON.parse(audit.metadataJson ?? "{}").requestSignature !== signature) {
        fail("This order already has an invoice with different details. Refresh the order.", "ORDER_INVOICE_REPLAY_MISMATCH");
      }
      return { deliveries: [] };
    }
    requireOpen(order);
    await requireFurnitureAccounting(tx, order);
    const lines = await invoiceLines(tx, order);
    if (input.previewToken !== previewToken(order, lines)) fail("The order, receipts or catalogue changed. Reload the invoice review.", "ORDER_INVOICE_CHANGED");
    const taxes = new Map(input.taxes.map((tax) => [tax.lineId, tax]));
    if (taxes.size !== lines.length || input.taxes.length !== lines.length || lines.some((line) => !taxes.has(line.lineId))) {
      fail("Review the tax treatment for every invoice line.");
    }
    for (const line of lines) {
      if (line.productId && line.hsn && taxes.get(line.lineId).hsn !== line.hsn) fail("Edit the product's HSN in the catalogue before changing it on this invoice.");
    }
    const customerId = order.customerId || input.customerId || undefined;
    if (order.customerId && input.customerId && order.customerId !== input.customerId) fail("Use the customer already selected for this order.");
    if (customerId) {
      const customer = await tx.customer.findFirst({ where: { id: customerId, shopId, deletedAt: null } });
      if (!customer || (!order.customerId && !matchesCustomer(order, customer))) fail("Select this order's matching customer account before invoicing on credit.");
    }
    const paid = serializeOrder(order).paidTotal;
    const due = round2(order.grandTotal - paid);
    if (due < 0) fail("Reconcile the order's overpayment before invoicing.");
    if (due > 0 && !customerId) fail("Choose the matching customer account for the remaining credit, or record the balance payment first.");
    const byTender = new Map();
    for (const payment of order.payments) {
      const mode = payment.mode === "card" ? "bank" : payment.mode;
      byTender.set(mode, round2((byTender.get(mode) ?? 0) + Number(payment.amount)));
    }
    const payments = [...byTender].filter(([, amount]) => amount !== 0).map(([mode, amount]) => {
      if (amount < 0 || !["cash", "upi", "bank"].includes(mode)) fail("Correct any Other payment to its actual cash, UPI or bank method before invoicing.");
      return { mode, amount };
    });
    const body = confirmBillSchema.parse({
      billType: input.taxMode === "inclusive" ? "gst_invoice" : "normal_sale", gstMode: input.taxMode,
      locationId: location.id, customerId, customerName: order.customerName,
      items: lines.map((line) => ({ ...line, gstRate: input.taxMode === "none" ? 0 : taxes.get(line.lineId).gstRate,
        hsn: taxes.get(line.lineId).hsn ?? line.hsn })),
      discount: Number(order.discount), payments, creditAmount: due, reason: input.reason,
      clientBillId: `furniture-invoice:${id}`, idempotencyKey: `furniture-invoice:${id}`,
    });
    // Claim the order row even for a cash-only sale. Receipt/correction writers
    // use serializable transactions too, so a race retries against fresh data.
    await tx.furnitureOrder.update({ where: { id }, data: { updatedAt: new Date(), ...(customerId ? { customerId } : {}) } });
    const confirmed = await confirmBill(shopId, body, { ...actor, locationId: location.id, allowStockShortfall: false }, null, { tx });
    const updated = await setOrderStatusInTransaction(tx, shopId, id, "delivered", { billId: confirmed.bill.id, ...actor });
    await requiredOrderAudit(tx, updated, "FURNITURE_ORDER_INVOICED", actor, {
      requestSignature: signature, billId: confirmed.bill.id, taxMode: input.taxMode, reason: input.reason, previousCustomerId: order.customerId,
    });
    return { deliveries: confirmed.deliveries };
  }, { timeout: 15000 });
  await dispatchIntegrationDeliveries(result.deliveries);
  return getOrder(shopId, id);
}
