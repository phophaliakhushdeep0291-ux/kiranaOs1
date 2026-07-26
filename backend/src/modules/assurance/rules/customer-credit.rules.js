// B. CUSTOMER AND UDHAR RULES — deterministic checks over Customer / UdharLedger.
//
// Governing invariant (docs/AUDIT_RULE_CATALOG.md section B):
//   outstanding = opening balance
//               + valid credit sales + debit adjustments
//               - valid payments - valid returns - credit adjustments
// In KiranaOS this is Σ(debit) − Σ(payment) over non-reversed UdharLedger rows,
// where the legacy opening balance is itself a `legacy_opening_balance` debit.
import {
  ENTITY_TYPES,
  EVENT_TYPES,
  EVIDENCE_TYPES,
  RULE_CATEGORIES,
  SEVERITY,
} from "../assurance.constants.js";
import {
  defineRule,
  daysBetween,
  money,
  moneyDiffers,
  passed,
  sum,
  triggered,
} from "../rule.interface.js";

const CUSTOMER = [ENTITY_TYPES.CUSTOMER];

// Ledger rows that legitimately move the outstanding balance.
function liveRows(ledger) {
  return (ledger ?? []).filter((row) => !row.reversedAt);
}

function signedAmount(row) {
  return row.type === "payment" ? -money(row.amount) : money(row.amount);
}

export function computeOutstanding(ledger) {
  const rows = liveRows(ledger);
  const raw = rows.reduce((total, row) => total + signedAmount(row), 0);
  return {
    rawBalance: Number(raw.toFixed(2)),
    balance: Number(Math.max(0, raw).toFixed(2)),
    debitSum: Number(sum(rows.filter((r) => r.type === "debit").map((r) => r.amount)).toFixed(2)),
    paymentSum: Number(sum(rows.filter((r) => r.type === "payment").map((r) => r.amount)).toFixed(2)),
    rowCount: rows.length,
  };
}

const MANUAL_MODES = new Set(["credit", "reversal", "legacy_opening_balance", "system_repair", "adjustment", "manual"]);

export const customerCreditRules = [
  defineRule({
    ruleCode: "UDHAR_BALANCE_LEDGER_MISMATCH",
    name: "Customer outstanding does not reconcile with the ledger",
    description: "The customer's stored outstanding balance does not equal the sum of their non-reversed ledger entries.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 36,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_CREATED, EVENT_TYPES.CUSTOMER_CREDIT_ADJUSTED],
    evidenceTypes: [EVIDENCE_TYPES.CUSTOMER_CONFIRMATION, EVIDENCE_TYPES.PAYMENT_RECEIPT],
    remediation: "Recompute the khata from the ledger and post a visible corrective entry. Never overwrite the balance silently.",
    evaluate(ctx) {
      const { customer, ledger } = ctx;
      if (!ledger?.length) return passed; // legacy customers without ledger coverage
      const computed = computeOutstanding(ledger);
      const stored = money(customer.udharAmount);
      if (!moneyDiffers(computed.balance, stored)) return passed;
      return triggered({
        storedOutstanding: stored,
        ledgerOutstanding: computed.balance,
        rawLedgerBalance: computed.rawBalance,
        debitSum: computed.debitSum,
        paymentSum: computed.paymentSum,
        ledgerRowCount: computed.rowCount,
        differenceRupees: Number((stored - computed.balance).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_CREDIT_SALE_WITHOUT_LEDGER",
    name: "Credit sale missing from the customer ledger",
    description: "One or more active bills carry a credit amount for this customer but have no matching udhar ledger debit.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.SALES_INVOICE, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Post the missing udhar debits so the customer's outstanding includes every credit sale.",
    evaluate(ctx) {
      const debitBillIds = new Set(liveRows(ctx.ledger).filter((r) => r.type === "debit" && r.billId).map((r) => r.billId));
      const missing = (ctx.creditBills ?? [])
        .filter((bill) => bill.status !== "cancelled" && money(bill.creditAmount) > 0 && !debitBillIds.has(bill.id))
        .map((bill) => ({ billId: bill.id, billNo: bill.billNo, creditAmount: money(bill.creditAmount) }));
      if (!missing.length) return passed;
      return triggered({
        missingBills: missing.slice(0, 20),
        missingCount: missing.length,
        missingCreditTotal: Number(sum(missing.map((m) => m.creditAmount)).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_LEDGER_ORPHANED_ENTRY",
    name: "Ledger entry without a valid source transaction",
    description: "A ledger row references a bill that does not exist, or is an unexplained manual entry with no recognised mode or note.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_ADJUSTED],
    evidenceTypes: [EVIDENCE_TYPES.STAFF_EXPLANATION, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Identify the source of each entry. Unexplained ledger movements are the clearest sign of khata tampering.",
    evaluate(ctx) {
      const orphans = [];
      for (const row of liveRows(ctx.ledger)) {
        if (row.billId) {
          const bill = ctx.referencedBills?.get(row.billId);
          if (!bill) {
            orphans.push({ ledgerId: row.id, reason: "referenced_bill_missing", billId: row.billId, amount: money(row.amount) });
            continue;
          }
          if (bill.shopId !== ctx.shopId) {
            orphans.push({ ledgerId: row.id, reason: "cross_shop_bill_reference", billId: row.billId, amount: money(row.amount) });
          }
          continue;
        }
        const mode = String(row.mode ?? "").toLowerCase();
        const hasNote = row.note && String(row.note).trim().length > 0;
        const recognised = MANUAL_MODES.has(mode) || ["cash", "upi", "bank"].includes(mode);
        if (!recognised && !hasNote) {
          orphans.push({ ledgerId: row.id, reason: "unexplained_manual_entry", mode: row.mode, amount: money(row.amount) });
        }
      }
      if (!orphans.length) return passed;
      return triggered({ orphanedEntries: orphans.slice(0, 20), orphanCount: orphans.length });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_NEGATIVE_BALANCE",
    name: "Customer ledger balance is negative",
    description: "Payments and credits recorded against this customer exceed what they were ever billed, so the khata is over-collected.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_ADJUSTED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Find the missing credit sale or the double-recorded payment. Refund or carry forward the advance explicitly.",
    evaluate(ctx) {
      const computed = computeOutstanding(ctx.ledger);
      if (computed.rawBalance >= -0.011) return passed;
      return triggered({
        rawLedgerBalance: computed.rawBalance,
        debitSum: computed.debitSum,
        paymentSum: computed.paymentSum,
        overCollectedRupees: Number(Math.abs(computed.rawBalance).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING",
    name: "Payment larger than the outstanding balance at that time",
    description: "A recorded payment exceeded the customer's outstanding balance when it was posted, driving the khata below zero.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_ADJUSTED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.UPI_REFERENCE, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Confirm the collection amount with the customer. An advance should be recorded deliberately, not as an over-payment.",
    evaluate(ctx) {
      const rows = liveRows(ctx.ledger);
      if (!rows.length) return passed;
      let running = 0;
      const offenders = [];
      for (const row of rows) {
        if (row.type === "payment") {
          const amount = money(row.amount);
          if (amount > running + 0.011) {
            offenders.push({
              ledgerId: row.id,
              paymentAmount: amount,
              outstandingBefore: Number(running.toFixed(2)),
              excessRupees: Number((amount - running).toFixed(2)),
              mode: row.mode,
              createdAt: new Date(row.createdAt).toISOString(),
            });
          }
        }
        running += signedAmount(row);
      }
      if (!offenders.length) return passed;
      return triggered({ overPayments: offenders.slice(0, 10), offenderCount: offenders.length });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_REVERSAL_NOT_APPLIED",
    name: "Reversed ledger entry has no counter-entry",
    description: "A ledger row is marked reversed but no reversal row references it, so the reversal never affected the balance.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_ADJUSTED],
    evidenceTypes: [EVIDENCE_TYPES.CUSTOMER_CONFIRMATION, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Post the missing counter-entry so the reversal is visible in the balance as well as on the original row.",
    evaluate(ctx) {
      const all = ctx.ledger ?? [];
      const reversalTargets = new Set(all.map((row) => row.reversalOfLedgerId).filter(Boolean));
      const dangling = all
        .filter((row) => row.reversedAt && !reversalTargets.has(row.id))
        .map((row) => ({
          ledgerId: row.id,
          type: row.type,
          amount: money(row.amount),
          reversedAt: new Date(row.reversedAt).toISOString(),
          reversedReason: row.reversedReason ?? null,
        }));
      if (!dangling.length) return passed;
      return triggered({ danglingReversals: dangling.slice(0, 10), danglingCount: dangling.length });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_CANCELLED_BILL_STILL_COUNTED",
    name: "Cancelled bill still increases customer outstanding",
    description: "A ledger debit belongs to a cancelled bill and was never reversed, so the customer still owes for a sale that no longer exists.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 34,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.SALE_CANCELLED, EVENT_TYPES.CUSTOMER_CREDIT_ADJUSTED],
    evidenceTypes: [EVIDENCE_TYPES.CANCELLATION_REASON, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Reverse the udhar debit for the cancelled bill so the khata no longer shows the cancelled amount.",
    evaluate(ctx) {
      const offenders = [];
      for (const row of liveRows(ctx.ledger)) {
        if (row.type !== "debit" || !row.billId) continue;
        const bill = ctx.referencedBills?.get(row.billId);
        if (bill && bill.status === "cancelled") {
          offenders.push({ ledgerId: row.id, billId: bill.id, billNo: bill.billNo, amount: money(row.amount) });
        }
      }
      if (!offenders.length) return passed;
      return triggered({
        cancelledDebits: offenders.slice(0, 20),
        offenderCount: offenders.length,
        overstatedRupees: Number(sum(offenders.map((o) => o.amount)).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_CREDIT_LIMIT_EXCEEDED",
    name: "Customer outstanding exceeds the configured credit limit",
    description: "The customer's outstanding balance is above the shop's configured udhar credit limit.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Decide whether to extend the limit for this customer or pause further credit until they pay down.",
    evaluate(ctx) {
      const limitPaise = ctx.settings.creditLimitPaise;
      if (!limitPaise || limitPaise <= 0) return passed; // no limit configured
      const computed = computeOutstanding(ctx.ledger);
      const outstandingPaise = Math.round(computed.balance * 100);
      if (outstandingPaise <= limitPaise) return passed;
      return triggered({
        outstandingRupees: computed.balance,
        configuredLimitRupees: limitPaise / 100,
        excessRupees: Number(((outstandingPaise - limitPaise) / 100).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_LARGE_MANUAL_ADJUSTMENT",
    name: "Large manual balance adjustment",
    description: "A large ledger entry was posted manually (not from a bill), above the configured adjustment threshold.",
    category: RULE_CATEGORIES.AUTHORIZATION,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_ADJUSTED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.STAFF_EXPLANATION, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Record who authorized the adjustment and why. Large manual khata movements should always carry owner approval.",
    evaluate(ctx) {
      const threshold = ctx.settings.largeAdjustmentPaise;
      const offenders = liveRows(ctx.ledger)
        .filter((row) => !row.billId && Math.round(money(row.amount) * 100) > threshold)
        .map((row) => ({
          ledgerId: row.id,
          type: row.type,
          amount: money(row.amount),
          mode: row.mode,
          note: row.note ?? null,
          createdAt: new Date(row.createdAt).toISOString(),
        }));
      if (!offenders.length) return passed;
      return triggered({
        thresholdRupees: threshold / 100,
        adjustments: offenders.slice(0, 10),
        adjustmentCount: offenders.length,
      });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_LATE_REVERSAL",
    name: "Ledger entry reversed long after it was posted",
    description: "A ledger entry was reversed more than 30 days after it was created, which can mask an earlier collection or a disputed sale.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 16,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_ADJUSTED],
    evidenceTypes: [EVIDENCE_TYPES.STAFF_EXPLANATION, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Check the reversal reason against the customer's statement for that period.",
    evaluate(ctx) {
      const LATE_DAYS = 30;
      const offenders = (ctx.ledger ?? [])
        .filter((row) => row.reversedAt)
        .map((row) => ({ row, ageDays: daysBetween(row.reversedAt, row.createdAt) }))
        .filter(({ ageDays }) => ageDays !== null && ageDays > LATE_DAYS)
        .map(({ row, ageDays }) => ({
          ledgerId: row.id,
          amount: money(row.amount),
          type: row.type,
          daysUntilReversal: Math.round(ageDays),
          reversedReason: row.reversedReason ?? null,
        }));
      if (!offenders.length) return passed;
      return triggered({ lateReversalDays: LATE_DAYS, lateReversals: offenders.slice(0, 10) });
    },
  }),

  defineRule({
    ruleCode: "CUSTOMER_DUPLICATE_IDENTITY",
    name: "Possible duplicate customer records",
    description: "Another customer record in this shop shares this customer's name or mobile number, so one khata may be split across two records.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.LOW,
    defaultWeight: 12,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Confirm with the customer and merge the khata records manually so the outstanding is not understated on either.",
    evaluate(ctx) {
      const candidates = ctx.similarCustomers ?? [];
      if (!candidates.length) return passed;
      const selfName = normalizeName(ctx.customer.name);
      const selfMobile = normalizeMobile(ctx.customer.mobile);
      const matches = candidates
        .filter((candidate) => {
          const sameName = selfName && normalizeName(candidate.name) === selfName;
          const sameMobile = selfMobile && normalizeMobile(candidate.mobile) === selfMobile;
          return sameName || sameMobile;
        })
        .map((candidate) => ({
          customerId: candidate.id,
          name: candidate.name,
          matchedOn: normalizeMobile(candidate.mobile) === selfMobile && selfMobile ? "mobile" : "name",
          softDeleted: Boolean(candidate.deletedAt),
          outstanding: money(candidate.udharAmount),
        }));
      if (!matches.length) return passed;
      return triggered({ duplicateCandidates: matches.slice(0, 10), candidateCount: matches.length });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_UNUSUAL_CREDIT_GROWTH",
    name: "Unusual rise in customer credit",
    description: "Credit extended to this customer in the last 30 days is far above their own historical 30-day pattern.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 16,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Confirm the customer's repayment capacity before extending more credit.",
    evaluate(ctx) {
      const MIN_WINDOWS = 3;
      const GROWTH_MULTIPLE = 3;
      const debits = liveRows(ctx.ledger).filter((row) => row.type === "debit" && row.billId);
      if (debits.length < 5) return passed;
      const now = latestTimestamp(ctx.ledger);
      if (!now) return passed;
      const windowTotals = [];
      for (let index = 0; index < 6; index += 1) {
        const end = now - index * 30 * 24 * 60 * 60 * 1000;
        const start = end - 30 * 24 * 60 * 60 * 1000;
        const total = sum(
          debits
            .filter((row) => {
              const at = new Date(row.createdAt).getTime();
              return at > start && at <= end;
            })
            .map((row) => row.amount)
        );
        windowTotals.push(Number(total.toFixed(2)));
      }
      const [current, ...history] = windowTotals;
      const priorWindows = history.filter((total) => total > 0);
      if (priorWindows.length < MIN_WINDOWS) {
        return passed; // insufficient history — never guess
      }
      const medianPrior = median(priorWindows);
      if (medianPrior <= 0 || current <= medianPrior * GROWTH_MULTIPLE) return passed;
      return triggered({
        last30DayCredit: current,
        medianPrior30DayCredit: Number(medianPrior.toFixed(2)),
        growthMultiple: Number((current / medianPrior).toFixed(2)),
        alertMultiple: GROWTH_MULTIPLE,
        priorWindowsUsed: priorWindows.length,
      });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_AGEING_BEYOND_LIMIT",
    name: "Outstanding older than the configured ageing limit",
    description: "Part of this customer's outstanding traces back to credit sales older than the shop's ageing limit, using oldest-first payment allocation.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 16,
    version: 1,
    applicableEntityTypes: CUSTOMER,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Send a reminder or agree a repayment plan. Long-aged khata is the most common source of unrecoverable loss.",
    evaluate(ctx) {
      const limitDays = ctx.settings.udharAgeingLimitDays;
      const rows = liveRows(ctx.ledger);
      const computed = computeOutstanding(ctx.ledger);
      if (computed.balance <= 0) return passed;
      // Oldest-first allocation of payments against debits.
      const debits = rows
        .filter((row) => row.type === "debit")
        .map((row) => ({ createdAt: row.createdAt, remaining: money(row.amount), ledgerId: row.id }))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      let paymentPool = computed.paymentSum;
      for (const debit of debits) {
        if (paymentPool <= 0) break;
        const applied = Math.min(paymentPool, debit.remaining);
        debit.remaining = Number((debit.remaining - applied).toFixed(2));
        paymentPool = Number((paymentPool - applied).toFixed(2));
      }
      const latest = latestTimestamp(ctx.ledger);
      const aged = debits
        .filter((debit) => debit.remaining > 0.011)
        .map((debit) => ({ ...debit, ageDays: Math.round(daysBetween(latest, debit.createdAt) ?? 0) }))
        .filter((debit) => debit.ageDays > limitDays);
      if (!aged.length) return passed;
      return triggered({
        ageingLimitDays: limitDays,
        agedOutstandingRupees: Number(sum(aged.map((d) => d.remaining)).toFixed(2)),
        oldestUnpaidDays: Math.max(...aged.map((d) => d.ageDays)),
        agedEntryCount: aged.length,
        totalOutstandingRupees: computed.balance,
      });
    },
  }),
];

function normalizeName(name) {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeMobile(mobile) {
  const digits = String(mobile ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function latestTimestamp(ledger) {
  const times = (ledger ?? []).map((row) => new Date(row.createdAt).getTime()).filter((t) => Number.isFinite(t));
  return times.length ? Math.max(...times) : null;
}
