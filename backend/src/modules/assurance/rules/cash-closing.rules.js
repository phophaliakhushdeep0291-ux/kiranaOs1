// F. CASH, UPI AND DAILY-CLOSING RULES.
//
// A DailyClosingSnapshot is a derived report. These rules recompute the day's
// figures from canonical Bill/Payment/UdharLedger/Expense rows and compare.
// Known product semantics the rules encode (verified against
// modules/reports/reports.service.js#getDailyClosing):
//   * cashReceived  = bill cash payments + cash udhar recovery
//   * expectedCash  = cashReceived (cash EXPENSES are not subtracted)
//   * sales returns are stored as negative bills with negative payment rows,
//     so refunds net out of the cash figure automatically
// There is no recorded physical cash count anywhere in KiranaOS, so a true
// "counted vs expected" variance cannot be computed yet (documented).
import {
  ENTITY_TYPES,
  EVENT_TYPES,
  EVIDENCE_TYPES,
  RULE_CATEGORIES,
  SEVERITY,
} from "../assurance.constants.js";
import { defineRule, money, passed, sum, triggered } from "../rule.interface.js";

const CLOSING = [ENTITY_TYPES.DAILY_CLOSING];

function toPaise(rupees) {
  return Math.round(money(rupees) * 100);
}

function activeSaleBills(ctx) {
  return (ctx.bills ?? []).filter((bill) => bill.status === "active");
}

function paymentsForActiveBills(ctx) {
  const activeIds = new Set(activeSaleBills(ctx).map((bill) => bill.id));
  return (ctx.payments ?? []).filter((payment) => activeIds.has(payment.billId) && payment.status !== "failed");
}

function paymentSumByMode(payments, mode) {
  return sum(payments.filter((payment) => String(payment.mode).toLowerCase() === mode).map((payment) => payment.amount));
}

function udharRecoveryByMode(ctx, mode) {
  return sum(
    (ctx.udharPayments ?? [])
      .filter((row) => !row.reversedAt && String(row.mode).toLowerCase() === mode)
      .map((row) => row.amount)
  );
}

export const cashClosingRules = [
  defineRule({
    ruleCode: "CLOSING_CASH_FIGURE_STALE",
    name: "Closing cash figure does not match the day's cash payments",
    description: "The locked or generated closing snapshot's cash figure does not equal cash bill payments plus cash udhar recovery recomputed from canonical rows.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.OWNER_APPROVAL],
    remediation: "Refresh the day's closing snapshot. If it is locked, re-open, refresh and re-lock it.",
    evaluate(ctx) {
      const recomputedPaise = toPaise(paymentSumByMode(paymentsForActiveBills(ctx), "cash") + udharRecoveryByMode(ctx, "cash"));
      const snapshotPaise = Number(ctx.snapshot.cashReceivedPaise ?? 0);
      const differencePaise = snapshotPaise - recomputedPaise;
      if (Math.abs(differencePaise) <= 1) return passed;
      return triggered({
        snapshotCashPaise: snapshotPaise,
        recomputedCashPaise: recomputedPaise,
        differencePaise,
        differenceRupees: Number((differencePaise / 100).toFixed(2)),
        billCashRupees: Number(paymentSumByMode(paymentsForActiveBills(ctx), "cash").toFixed(2)),
        udharCashRecoveryRupees: Number(udharRecoveryByMode(ctx, "cash").toFixed(2)),
        snapshotLocked: Boolean(ctx.snapshot.lockedAt),
      });
    },
  }),

  defineRule({
    ruleCode: "CLOSING_UPI_FIGURE_STALE",
    name: "Closing UPI figure does not match the day's UPI payments",
    description: "The closing snapshot's UPI figure does not equal UPI bill payments plus UPI udhar recovery recomputed from canonical rows.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    evidenceTypes: [EVIDENCE_TYPES.UPI_REFERENCE, EVIDENCE_TYPES.BANK_TRANSACTION],
    remediation: "Refresh the closing snapshot and reconcile UPI collections against the payment app statement.",
    evaluate(ctx) {
      const recomputedPaise = toPaise(paymentSumByMode(paymentsForActiveBills(ctx), "upi") + udharRecoveryByMode(ctx, "upi"));
      const snapshotPaise = Number(ctx.snapshot.upiReceivedPaise ?? 0);
      const differencePaise = snapshotPaise - recomputedPaise;
      if (Math.abs(differencePaise) <= 1) return passed;
      return triggered({
        snapshotUpiPaise: snapshotPaise,
        recomputedUpiPaise: recomputedPaise,
        differencePaise,
        differenceRupees: Number((differencePaise / 100).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "CLOSING_SALES_FIGURE_STALE",
    name: "Closing sales total does not match the day's active bills",
    description: "The closing snapshot's total sales figure does not equal the sum of the day's active bills.",
    category: RULE_CATEGORIES.RECONCILIATION,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    evidenceTypes: [EVIDENCE_TYPES.SALES_INVOICE, EVIDENCE_TYPES.OWNER_APPROVAL],
    remediation: "Refresh the closing snapshot. A stale sales figure usually means bills arrived after the snapshot was generated.",
    evaluate(ctx) {
      const recomputedPaise = toPaise(sum(activeSaleBills(ctx).map((bill) => bill.grandTotal)));
      const snapshotPaise = Number(ctx.snapshot.totalSalesPaise ?? 0);
      const differencePaise = snapshotPaise - recomputedPaise;
      if (Math.abs(differencePaise) <= 1) return passed;
      return triggered({
        snapshotSalesPaise: snapshotPaise,
        recomputedSalesPaise: recomputedPaise,
        differencePaise,
        differenceRupees: Number((differencePaise / 100).toFixed(2)),
        activeBillCount: activeSaleBills(ctx).length,
        snapshotBillCount: Number(ctx.snapshot.totalBills ?? 0),
      });
    },
  }),

  defineRule({
    ruleCode: "CLOSING_UDHAR_RECOVERY_STALE",
    name: "Closing udhar recovery figure does not match the ledger",
    description: "The closing snapshot's old-udhar-recovered figure does not match non-reversed customer payments for the day.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 22,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Refresh the closing snapshot so khata collections are counted in the day's cash position.",
    evaluate(ctx) {
      const recomputedPaise = toPaise(
        sum(
          (ctx.udharPayments ?? [])
            .filter((row) => !row.reversedAt && ["cash", "upi", "bank"].includes(String(row.mode).toLowerCase()))
            .map((row) => row.amount)
        )
      );
      const snapshotPaise = Number(ctx.snapshot.oldUdharRecoveredPaise ?? 0);
      const differencePaise = snapshotPaise - recomputedPaise;
      if (Math.abs(differencePaise) <= 1) return passed;
      return triggered({
        snapshotUdharRecoveredPaise: snapshotPaise,
        recomputedUdharRecoveredPaise: recomputedPaise,
        differencePaise,
        differenceRupees: Number((differencePaise / 100).toFixed(2)),
        ledgerPaymentCount: (ctx.udharPayments ?? []).filter((row) => !row.reversedAt).length,
      });
    },
  }),

  defineRule({
    ruleCode: "CLOSING_CASH_EXPENSES_NOT_DEDUCTED",
    name: "Expected cash does not account for cash expenses",
    description: "Cash expenses were recorded for this day but the expected-cash figure equals cash received, so the cash the drawer should actually hold is overstated.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 20,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    evidenceTypes: [EVIDENCE_TYPES.EXPENSE_RECEIPT, EVIDENCE_TYPES.OWNER_APPROVAL],
    remediation: "When counting the drawer, subtract cash expenses manually. This is a known reporting gap, not necessarily an error in the data.",
    evaluate(ctx) {
      const cashExpensePaise = toPaise(
        sum((ctx.expenses ?? []).filter((expense) => String(expense.paymentMode).toLowerCase() === "cash").map((expense) => expense.amount))
      );
      if (cashExpensePaise <= 0) return passed;
      // Materiality gate: only report when the omission is worth a shopkeeper's attention.
      if (cashExpensePaise < ctx.settings.closingDifferenceAlertPaise) return passed;
      const expectedCashPaise = Number(ctx.snapshot.expectedCashPaise ?? 0);
      const cashReceivedPaise = Number(ctx.snapshot.cashReceivedPaise ?? 0);
      // Only report when expectedCash was NOT reduced by the expenses.
      if (Math.abs(expectedCashPaise - cashReceivedPaise) > 1) return passed;
      return triggered({
        expectedCashPaise,
        cashReceivedPaise,
        cashExpensesPaise: cashExpensePaise,
        cashExpensesRupees: Number((cashExpensePaise / 100).toFixed(2)),
        drawerShouldHoldPaise: cashReceivedPaise - cashExpensePaise,
        materialityThresholdRupees: ctx.settings.closingDifferenceAlertPaise / 100,
        expenseCount: (ctx.expenses ?? []).filter((e) => String(e.paymentMode).toLowerCase() === "cash").length,
      });
    },
  }),

  defineRule({
    ruleCode: "CLOSING_REFUND_NOT_IN_CASH",
    name: "Cash refund missing from the day's cash movements",
    description: "A sales return was refunded in cash but no matching negative cash payment row exists, so the refund never reduced the cash figure.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.SALE_RETURNED, EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Confirm the refund was actually paid out and record it, otherwise the drawer will not tally.",
    evaluate(ctx) {
      const returns = activeSaleBills(ctx).filter((bill) => bill.billType === "sales_return");
      if (!returns.length) return passed;
      const paymentsByBill = new Map();
      for (const payment of ctx.payments ?? []) {
        const list = paymentsByBill.get(payment.billId) ?? [];
        list.push(payment);
        paymentsByBill.set(payment.billId, list);
      }
      const offenders = returns
        .filter((bill) => {
          // A cash-like refund stores a negative payment row. Missing negative
          // rows while paidAmount is negative means the tender never moved.
          if (money(bill.paidAmount) >= 0) return false;
          const rows = paymentsByBill.get(bill.id) ?? [];
          return !rows.some((row) => money(row.amount) < 0);
        })
        .map((bill) => ({ billId: bill.id, billNo: bill.billNo, refundRupees: Math.abs(money(bill.paidAmount)) }));
      if (!offenders.length) return passed;
      return triggered({ refundsMissingPaymentRow: offenders.slice(0, 20), offenderCount: offenders.length });
    },
  }),

  defineRule({
    ruleCode: "CLOSING_CHANGED_AFTER_LOCK",
    name: "Closing snapshot regenerated after it was locked",
    description: "The closing snapshot's figures were regenerated after the lock timestamp, so the locked numbers are not the ones on record.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.DAILY_CLOSING_COMPLETED, EVENT_TYPES.RECORD_EDITED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.CORRECTION_REASON],
    remediation: "Record why the locked day was regenerated. Locked closings should change only with owner approval.",
    evaluate(ctx) {
      const { snapshot } = ctx;
      if (!snapshot.lockedAt) return passed;
      const lockedAt = new Date(snapshot.lockedAt).getTime();
      const generatedAt = new Date(snapshot.generatedAt).getTime();
      if (generatedAt <= lockedAt + 1000) return passed;
      return triggered({
        lockedAt: new Date(lockedAt).toISOString(),
        regeneratedAt: new Date(generatedAt).toISOString(),
        minutesAfterLock: Math.round((generatedAt - lockedAt) / 60000),
        source: snapshot.source,
      });
    },
  }),

  defineRule({
    ruleCode: "CLOSING_LATE_TRANSACTION_AFTER_LOCK",
    name: "Transactions changed after the day was locked",
    description: "Bills belonging to this locked day were created or modified after the lock, typically a late offline sync.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.OFFLINE_EVENT_SYNCED, EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    evidenceTypes: [EVIDENCE_TYPES.DEVICE_TIMESTAMP_METADATA, EVIDENCE_TYPES.OWNER_APPROVAL],
    remediation: "Re-open, refresh and re-lock the day so the locked figures include the late transactions.",
    evaluate(ctx) {
      const late = ctx.lateSyncEvents ?? [];
      if (!late.length) return passed;
      return triggered({
        lockedAt: ctx.snapshot.lockedAt ? new Date(ctx.snapshot.lockedAt).toISOString() : null,
        lateBills: late.slice(0, 20).map((bill) => ({
          billId: bill.id,
          billNo: bill.billNo,
          status: bill.status,
          updatedAt: new Date(bill.updatedAt).toISOString(),
        })),
        lateBillCount: late.length,
      });
    },
  }),

  defineRule({
    ruleCode: "CLOSING_LARGE_DIFFERENCE",
    name: "Large unexplained difference in the day's closing",
    description: "The gap between the snapshot's figures and the recomputed figures is above the configured materiality threshold.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 34,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Investigate the day end-to-end before locking. Large gaps are where cash leakage hides.",
    evaluate(ctx) {
      const threshold = ctx.settings.closingDifferenceAlertPaise;
      const recomputedSalesPaise = toPaise(sum(activeSaleBills(ctx).map((bill) => bill.grandTotal)));
      const recomputedCashPaise = toPaise(paymentSumByMode(paymentsForActiveBills(ctx), "cash") + udharRecoveryByMode(ctx, "cash"));
      const salesDelta = Number(ctx.snapshot.totalSalesPaise ?? 0) - recomputedSalesPaise;
      const cashDelta = Number(ctx.snapshot.cashReceivedPaise ?? 0) - recomputedCashPaise;
      const worst = Math.max(Math.abs(salesDelta), Math.abs(cashDelta));
      if (worst < threshold) return passed;
      return triggered({
        materialityThresholdPaise: threshold,
        salesDifferencePaise: salesDelta,
        cashDifferencePaise: cashDelta,
        worstDifferenceRupees: Number((worst / 100).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "CLOSING_UPI_REFERENCE_REUSED",
    name: "Same UPI reference used on more than one bill",
    description: "Two or more payments in this day share a provider reference, so one transfer may have been counted against several bills.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.PAYMENT_RECEIVED, EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    evidenceTypes: [EVIDENCE_TYPES.UPI_REFERENCE, EVIDENCE_TYPES.BANK_TRANSACTION],
    remediation: "Match each reference against the payment app statement. Only one bill may claim a given transfer.",
    evaluate(ctx) {
      const byReference = new Map();
      for (const payment of ctx.payments ?? []) {
        const reference = typeof payment.providerReference === "string" ? payment.providerReference.trim() : "";
        if (reference.length < 6) continue;
        const list = byReference.get(reference) ?? [];
        list.push(payment);
        byReference.set(reference, list);
      }
      const reused = [...byReference.entries()]
        .filter(([, payments]) => new Set(payments.map((p) => p.billId)).size > 1)
        .map(([reference, payments]) => ({
          providerReference: maskReference(reference),
          billIds: [...new Set(payments.map((p) => p.billId))],
          paymentCount: payments.length,
          totalRupees: Number(sum(payments.map((p) => p.amount)).toFixed(2)),
        }));
      if (!reused.length) return passed;
      return triggered({ reusedReferences: reused.slice(0, 10), reusedCount: reused.length });
    },
  }),

  defineRule({
    ruleCode: "CLOSING_SPLIT_PAYMENT_MISMATCH",
    name: "Split payment components do not equal the bill's paid amount",
    description: "For one or more bills in this day, the payment rows do not add up to the bill's recorded paid amount.",
    category: RULE_CATEGORIES.RECONCILIATION,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 1,
    applicableEntityTypes: CLOSING,
    applicableEventTypes: [EVENT_TYPES.PAYMENT_RECEIVED, EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.SALES_INVOICE],
    remediation: "Reconcile each flagged bill's tender split. Do not edit the bill; record a corrective entry.",
    evaluate(ctx) {
      const paymentsByBill = new Map();
      for (const payment of ctx.payments ?? []) {
        if (payment.status === "failed") continue;
        paymentsByBill.set(payment.billId, (paymentsByBill.get(payment.billId) ?? 0) + money(payment.amount));
      }
      const offenders = [];
      for (const bill of activeSaleBills(ctx)) {
        const declared = money(bill.paidAmount);
        const actual = paymentsByBill.get(bill.id) ?? 0;
        if (Math.abs(declared - actual) <= 0.011) continue;
        offenders.push({
          billId: bill.id,
          billNo: bill.billNo,
          declaredPaidRupees: declared,
          paymentRowSumRupees: Number(actual.toFixed(2)),
          differenceRupees: Number((declared - actual).toFixed(2)),
        });
      }
      if (!offenders.length) return passed;
      return triggered({ mismatchedBills: offenders.slice(0, 20), mismatchCount: offenders.length });
    },
  }),
];

// Provider references can be quasi-identifying; findings keep only a masked form.
function maskReference(reference) {
  if (reference.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, reference.length - 4))}${reference.slice(-4)}`;
}
