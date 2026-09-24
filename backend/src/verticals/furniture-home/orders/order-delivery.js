import { AppError } from "../../../middleware/error.js";
import { toPaise } from "../../../utils/money.js";
import { resolveOperationalLocation } from "../../../modules/stores/location-context.service.js";
import { formatDateInTimeZone } from "../../../utils/dates.js";

const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const reject = (message) => { throw new AppError(message, 409, "ORDER_BILL_MISMATCH"); };
const aggregate = (rows, key, amount) => {
  const result = new Map();
  for (const row of rows) result.set(key(row), (result.get(key(row)) ?? 0) + amount(row));
  return new Map([...result].filter(([, amount]) => Math.abs(amount) > 0.000001));
};
const sameQuantities = (a, b) => a.size === b.size && [...a].every(([key, qty]) => Math.abs(qty - (b.get(key) ?? 0)) < 0.000001);

// Linking a bill never creates a second receipt or moves stock a second time.
// It proves that the matching sale already did both before releasing the hold.
export async function requireDeliveryBill(tx, order, { billId, billNumber } = {}) {
  if (!billId && !billNumber && !order.billId) {
    throw new AppError("Link the matching sale bill before marking this order delivered.", 409, "ORDER_BILL_REQUIRED");
  }
  const bill = await tx.bill.findFirst({
    where: { shopId: order.shopId, deletedAt: null, ...(billId || order.billId ? { id: billId || order.billId } : { billNo: billNumber }) },
    include: { items: true, payments: true },
  });
  if (!bill) throw new AppError("That bill is not in your shop", 404, "ORDER_BILL_MISSING");
  const location = await resolveOperationalLocation(order.shopId, order.locationId, tx);
  if (bill.locationId !== location.id && !(location.isPrimary && !bill.locationId)) reject("The bill must be from the same branch as this order.");
  if (order.payments.some((payment) => formatDateInTimeZone(payment.paidOn) > formatDateInTimeZone(bill.businessDate))) {
    reject("The bill date cannot precede the order's latest receipt or adjustment.");
  }
  if ((order.billId && bill.id !== order.billId) || (billNumber && bill.billNo !== billNumber)) reject("The bill reference does not match this order's linked bill.");
  if (bill.status !== "active" || !["normal_sale", "gst_invoice"].includes(bill.billType) || bill.returnOfBillId) {
    reject("Use an active sale bill. A cancelled bill, estimate or return cannot confirm delivery.");
  }
  if (await tx.bill.findFirst({ where: { shopId: order.shopId, returnOfBillId: bill.id, status: "active", deletedAt: null } })) {
    reject("This bill has returned goods. Reconcile the delivery before completing the order.");
  }
  if (await tx.furnitureOrder.findFirst({ where: { shopId: order.shopId, billId: bill.id, id: { not: order.id } } })) {
    reject("This bill is already linked to another order.");
  }
  if (order.customerId ? order.customerId !== bill.customerId : normalized(order.customerName) !== normalized(bill.customerName)) {
    reject("The bill must belong to the customer on this order.");
  }
  if (toPaise(bill.grandTotal) !== toPaise(order.grandTotal)) reject("The bill total must match the order, including delivery and installation charges.");

  const expected = aggregate(order.items, (item) => item.productId ? `product:${item.productId}` : `custom:${normalized(item.name)}`, (item) => Number(item.qty));
  // Delivery/installation may be invoiced as service lines. Catalogue goods
  // and made-to-order pieces must match; extra catalogue goods are never ignored.
  const actual = aggregate(bill.items.filter((item) => item.productId || expected.has(`custom:${normalized(item.name)}`)),
    (item) => item.productId ? `product:${item.productId}` : `custom:${normalized(item.name)}`,
    (item) => Number(item.productId ? item.quantityInBaseUnit : item.quantity));
  if (!sameQuantities(expected, actual)) reject("The bill's goods and quantities must match this order.");

  const expectedStock = aggregate(order.items.filter((item) => item.productId), (item) => item.productId, (item) => Number(item.qty));
  const movements = await tx.stockLedger.findMany({ where: { shopId: order.shopId, billId: bill.id, action: "sale" } });
  const moved = aggregate(movements, (row) => row.productId, (row) => -Number(row.changeBaseQty));
  if (!sameQuantities(expectedStock, moved)) reject("This bill does not have the matching stock deduction. Reconcile the sale before delivery.");

  const tender = (mode) => mode === "card" ? "bank" : mode;
  const recorded = aggregate(order.payments, (p) => tender(p.mode), (p) => toPaise(p.amount));
  const invoiced = aggregate(bill.payments.filter((p) => p.mode !== "credit" && p.status !== "failed"), (p) => tender(p.mode), (p) => toPaise(p.amount));
  if (!sameQuantities(recorded, invoiced)) reject("Reconcile the order's received payments with the bill's payment methods and amounts before linking. Do not collect the same money again.");
  return bill;
}
