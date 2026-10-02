import db from "../../db.js";
import { serializableTransaction } from "../../lib/transactions.js";
import { createAuditLog } from "../audit/audit.service.js";
import { DEFAULT_GRACE_DAYS } from "./planConfig.js";
import {
  FREE_ACCESS_FROM,
  FREE_ACCESS_UNTIL,
  freeWindowCredit,
  isFreeWindowCreditEligible,
} from "./freeAccess.js";

/**
 * Give back the paid time the free window gave away.
 *
 * A shop that was paying when the promotion began kept paying while everyone
 * else had the product for nothing, and its period ran down all the same. This
 * hands those days back, added after the window shuts so they are days the shop
 * can actually use. `freeAccess.js` works out how many.
 *
 * It is a one-off correction, run deliberately from
 * scripts/credit-free-window-overlap.js rather than on a request path, because
 * it moves what a shop has paid for and every move is worth reading afterwards.
 * The audit entry is both the receipt and the guard: a shop that has one is never
 * credited twice, however many times this runs.
 */

/** The audit action that records a credit, and marks the shop as already paid. */
export const FREE_WINDOW_CREDIT_ACTION = "SUBSCRIPTION_FREE_WINDOW_CREDITED";

// Time-based states deny access by the clock, and the clock is exactly what is
// being corrected, so a credited shop leaves them. "payment_failed" and
// "cancelled" are left alone: one is a payment to sort out, the other a shop's
// own decision, and neither is this correction's business. Cancelled access runs
// to currentPeriodEnd anyway, so the credit still reaches it.
const STATES_THE_CREDIT_REOPENS = new Set(["expired", "grace"]);

function addDays(date, days) {
  const moved = new Date(date);
  moved.setDate(moved.getDate() + days);
  return moved;
}

function later(a, b) {
  if (!a) return b;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * Report, and optionally apply, what every paying shop is owed.
 *
 * With `apply` false nothing is written — the same arithmetic, reported. Pass a
 * `shopId` to look at one shop.
 */
export async function creditFreeWindowOverlap({ apply = false, shopId = null, client = db } = {}) {
  const subscriptions = await client.subscription.findMany({
    where: shopId ? { shopId } : {},
    orderBy: { shopId: "asc" },
  });

  // One read rather than one per shop: the audit index is (shopId, action, createdAt).
  const alreadyCredited = new Set(
    (await client.auditLog.findMany({
      where: { action: FREE_WINDOW_CREDIT_ACTION, ...(shopId ? { shopId } : {}) },
      select: { shopId: true },
    })).map((row) => row.shopId),
  );

  const report = {
    window: { from: FREE_ACCESS_FROM.toISOString(), until: FREE_ACCESS_UNTIL.toISOString() },
    applied: apply,
    credited: [],
    alreadyCredited: 0,
    notEligible: 0,
    nothingOwed: 0,
  };

  for (const subscription of subscriptions) {
    if (alreadyCredited.has(subscription.shopId)) {
      report.alreadyCredited += 1;
      continue;
    }
    if (!isFreeWindowCreditEligible(subscription)) {
      report.notEligible += 1;
      continue;
    }
    const credit = freeWindowCredit(subscription);
    if (!credit) {
      report.nothingOwed += 1;
      continue;
    }

    const entry = {
      shopId: subscription.shopId,
      planCode: subscription.planCode,
      status: subscription.status,
      days: credit.days,
      from: credit.previousPeriodEnd.toISOString(),
      to: credit.periodEnd.toISOString(),
    };

    if (apply) {
      await serializableTransaction(async (tx) => {
        // Re-read inside the transaction: two runs at once must still credit once.
        const fresh = await tx.subscription.findUnique({ where: { shopId: subscription.shopId } });
        if (!fresh) return;
        const receipt = await tx.auditLog.findFirst({
          where: { shopId: subscription.shopId, action: FREE_WINDOW_CREDIT_ACTION },
          select: { id: true },
        });
        if (receipt) return;

        const recredit = freeWindowCredit(fresh);
        if (!recredit || !isFreeWindowCreditEligible(fresh)) return;

        const status = STATES_THE_CREDIT_REOPENS.has(fresh.status) ? "active" : fresh.status;
        const updated = await tx.subscription.update({
          where: { shopId: fresh.shopId },
          data: {
            status,
            currentPeriodEnd: recredit.periodEnd,
            graceEndsAt: later(fresh.graceEndsAt, addDays(recredit.periodEnd, DEFAULT_GRACE_DAYS)),
          },
        });

        // The receipt IS the guard against crediting twice, so a credit that cannot be
        // recorded must not stand: throwing rolls the extension back with it.
        const receiptWritten = await createAuditLog({
          shopId: fresh.shopId,
          action: FREE_WINDOW_CREDIT_ACTION,
          entityType: "subscription",
          entityId: fresh.id,
          before: { status: fresh.status, currentPeriodEnd: fresh.currentPeriodEnd, graceEndsAt: fresh.graceEndsAt },
          after: { status: updated.status, currentPeriodEnd: updated.currentPeriodEnd, graceEndsAt: updated.graceEndsAt },
          metadata: {
            reason: "paid time that the free launch window gave away",
            creditedDays: recredit.days,
            freeWindowFrom: FREE_ACCESS_FROM.toISOString(),
            freeWindowUntil: FREE_ACCESS_UNTIL.toISOString(),
          },
          client: tx,
        });
        if (!receiptWritten) {
          throw new Error(`Credit for ${fresh.shopId} was rolled back: its audit record could not be stored`);
        }
      });
    }

    report.credited.push(entry);
  }

  report.creditedDays = report.credited.reduce((total, entry) => total + entry.days, 0);
  return report;
}
