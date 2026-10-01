import { resolveOperationalLocation } from "../../../modules/stores/location-context.service.js";
import { AppError } from "../../../middleware/error.js";
import { serializableTransaction } from "../../../lib/transactions.js";
import { toPaise } from "../../../utils/money.js";
import { journalBatchSourceId } from "../../../modules/finance/general-ledger.service.js";
import { furnitureTender, postFurnitureReceipt, unreconciledFurnitureReceipts } from "./order-finance.js";
import { reconcileOrderHistorySchema } from "./orders.schema.js";
import { getOrder, requiredOrderAudit } from "./orders.service.js";

/**
 * Give a legacy furniture receipt the financial history it never had.
 *
 * An order taken before receipts reached the journal holds money the ledger has
 * no record of — SO-000001 is the standing example: ₹120 received, no linked
 * bill, catalogue stock untouched. `requireFurnitureAccounting` refuses to
 * invoice, refund or correct such an order, which is right (the alternative is
 * reversing cash the accounts never saw arrive) but leaves it frozen with no way
 * out. This is the way out.
 *
 * Three things make it a reconciliation rather than a rubber stamp:
 *
 *   RESTATED   The owner sends back the amount and tender of every receipt being
 *              opened. A confirmation that carries no numbers is not evidence
 *              that anybody looked; this one disagrees out loud when the figures
 *              do not match what the order holds.
 *   DATED BACK The rows are posted on the receipt's OWN `paidOn`, not today.
 *              Today's date would move historical cash into tonight's drawer and
 *              make a closing that was already counted disagree with the till.
 *   REFUSABLE  `postFinancialLedgerRows` asserts the period is open, so a receipt
 *              inside a closed accounting period is refused rather than quietly
 *              rewriting a period somebody has signed off.
 *
 * It does NOT invent anything. Every figure posted comes off the receipt that is
 * already on the order; the owner's restatement only decides whether that
 * receipt is trusted enough to open. Money that was never recorded at all is not
 * this workflow's business — there is nothing here to reconcile it against.
 */
export async function reconcileOrderHistory(shopId, id, rawInput, actor = {}) {
  const input = reconcileOrderHistorySchema.parse(rawInput);
  if (!actor.ownerPinVerified) {
    throw new AppError("Owner PIN required to open an order's historical receipts.", 403, "OWNER_PIN_REQUIRED");
  }

  await serializableTransaction(async (tx) => {
    const order = await tx.furnitureOrder.findFirst({
      where: { shopId, id, deletedAt: null },
      include: { items: { orderBy: { id: "asc" } }, payments: { orderBy: { id: "asc" } } },
    });
    if (!order) throw new AppError("Order not found", 404);

    const location = await resolveOperationalLocation(shopId, actor.locationId, tx);
    if (order.locationId ? order.locationId !== location.id : !location.isPrimary) {
      throw new AppError("Switch to this order's branch before reconciling receipts.", 403, "ORDER_HISTORY_LOCATION");
    }
    const pending = await unreconciledFurnitureReceipts(tx, order);
    const confirmed = new Map(input.receipts.map((receipt) => [receipt.paymentId, receipt]));
    const pendingIds = new Set((pending.length ? pending : order.payments).map((payment) => payment.id));

    // Every unbacked receipt has to be accounted for in one request. Opening a
    // subset would leave the order still frozen while reporting success, and the
    // owner would have signed off on a figure that is not the order's total.
    const missing = pending.filter((payment) => !confirmed.has(payment.id));
    if (missing.length > 0) {
      throw new AppError(
        `Confirm every historical receipt on this order — ${missing.length} still unconfirmed.`,
        409,
        "ORDER_HISTORY_INCOMPLETE",
      );
    }
    const unknown = input.receipts.filter((receipt) => !pendingIds.has(receipt.paymentId));
    if (unknown.length > 0) {
      throw new AppError("This order's receipts changed. Reload before confirming.", 409, "ORDER_HISTORY_CHANGED");
    }

    if (confirmed.size !== input.receipts.length) throw new AppError("Confirm each receipt once.", 409, "ORDER_HISTORY_CHANGED");
    for (const payment of (pending.length ? pending : order.payments.filter((payment) => confirmed.has(payment.id)))) {
      const receipt = confirmed.get(payment.id);
      // The restatement is the whole point of the workflow, so it is compared in
      // paise rather than relying on floating-point equality.
      if (toPaise(receipt.amount) !== toPaise(payment.amount) || receipt.mode !== payment.mode) {
        throw new AppError(
          `Receipt ${payment.id} is recorded as ₹${payment.amount} by ${payment.mode}. Review the original receipt before proceeding.`,
          409,
          "ORDER_HISTORY_MISMATCH",
        );
      }
    }

    if (pending.length === 0) return;
    // Claim the same order row as invoice/receipt writers. A concurrent repair
    // retries its serializable snapshot before attempting duplicate journal keys.
    await tx.furnitureOrder.update({ where: { id }, data: { updatedAt: new Date() } });
    const existing = await tx.financialLedger.count({ where: {
      shopId, sourceType: "furniture_order", sourceId: id,
      OR: pending.map((payment) => ({ idempotencyKey: { startsWith: `furniture:${id}:receipt:${payment.id}:` } })),
    } });
    const journalIds = pending.map((payment) => journalBatchSourceId(
      [furnitureTender(payment.mode), "furniture_advance"].map((entryType) => ({
        sourceId: id, idempotencyKey: `furniture:${id}:receipt:${payment.id}:${entryType}`,
      })),
    ));
    const existingJournal = await tx.journalEntry.count({ where: { shopId, sourceType: "furniture_order", sourceId: { in: journalIds } } });
    if (existing || existingJournal) throw new AppError("These receipts have partial or conflicting accounting history. Review the journal before reconciling.", 409, "ORDER_HISTORY_PARTIAL");
    if (order.billId) throw new AppError("Review the linked invoice before opening historical receipts.", 409, "ORDER_HISTORY_INVOICE_REVIEW");
    for (const payment of pending) {
      await postFurnitureReceipt(tx, order, { ...payment, kind: "opening_history" });
    }

    await requiredOrderAudit(tx, order, "FURNITURE_ORDER_HISTORY_RECONCILED", actor, {
      reason: input.reason,
      receipts: pending.map((payment) => ({
        paymentId: payment.id, amount: payment.amount, mode: payment.mode, paidOn: payment.paidOn,
      })),
    });
  });

  return getOrder(shopId, id);
}
