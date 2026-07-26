// E. EXPENSE RULES.
//
// Expense records carry no attachment and no actor userId (`recordedBy` is a
// free-text name), so receipt-presence and staff-permission checks work off
// thresholds and the evidence engine rather than off a stored document. See
// docs/AUDIT_LIMITATIONS.md.
import {
  ENTITY_TYPES,
  EVENT_TYPES,
  EVIDENCE_TYPES,
  RULE_CATEGORIES,
  SEVERITY,
} from "../assurance.constants.js";
import { BASELINE_METRICS } from "../baseline.service.js";
import { defineRule, money, passed, percentOf, triggered } from "../rule.interface.js";

const EXPENSE = [ENTITY_TYPES.EXPENSE];

// Conservative keyword → category hints. Only obvious mismatches are flagged,
// and always at LOW severity: a kirana owner's own category names win.
const CATEGORY_KEYWORDS = Object.freeze({
  rent: ["rent", "kiraya", "lease"],
  salary: ["salary", "wages", "tankha", "staff pay", "bonus"],
  electricity: ["electricity", "power bill", "bijli", "light bill"],
  transport: ["transport", "freight", "diesel", "petrol", "auto", "tempo", "delivery charge"],
  packaging: ["packaging", "carry bag", "polythene", "carton"],
  maintenance: ["repair", "maintenance", "service charge", "plumber", "electrician"],
  telephone: ["mobile recharge", "phone bill", "internet", "broadband"],
});

export const expenseRules = [
  defineRule({
    ruleCode: "EXPENSE_DUPLICATE",
    name: "Duplicate expense entry",
    description: "Another expense with the same amount and category was recorded within a day of this one.",
    category: RULE_CATEGORIES.EXPENSE,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.EXPENSE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.EXPENSE_RECEIPT, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Check the receipts. If the same spend was entered twice, soft-delete the duplicate through the expenses screen.",
    evaluate(ctx) {
      const duplicates = ctx.duplicates ?? [];
      if (!duplicates.length) return passed;
      return triggered({
        amountRupees: money(ctx.expense.amount),
        category: ctx.expense.category,
        duplicateExpenseIds: duplicates.map((d) => d.id),
        duplicateCount: duplicates.length,
        windowHours: 24,
      });
    },
  }),

  defineRule({
    ruleCode: "EXPENSE_MISSING_RECEIPT",
    name: "Expense above threshold has no receipt reference",
    description: "A material expense has neither a payee nor any note that points to a bill or receipt, so the spend has no document trail.",
    category: RULE_CATEGORIES.EXPENSE,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 22,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.EXPENSE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.EXPENSE_RECEIPT, EVIDENCE_TYPES.PAYMENT_RECEIPT],
    remediation: "Attach the receipt to this finding. Expenses without receipts cannot be verified or claimed against tax.",
    evaluate(ctx) {
      const threshold = ctx.settings.expenseReceiptRequiredAbovePaise;
      const amountPaise = Math.round(money(ctx.expense.amount) * 100);
      if (amountPaise <= threshold) return passed;
      const hasVendor = ctx.expense.vendor && String(ctx.expense.vendor).trim();
      const hasNotes = ctx.expense.notes && String(ctx.expense.notes).trim();
      if (hasVendor || hasNotes) return passed;
      return triggered({
        amountRupees: money(ctx.expense.amount),
        thresholdRupees: threshold / 100,
        category: ctx.expense.category,
        paymentMode: ctx.expense.paymentMode,
        hasVendor: false,
        hasNotes: false,
      });
    },
  }),

  defineRule({
    ruleCode: "EXPENSE_UNUSUALLY_HIGH_FOR_CATEGORY",
    name: "Expense far above the usual amount for its category",
    description: "This expense is well outside the shop's own historical range for this category.",
    category: RULE_CATEGORIES.EXPENSE,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 20,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.EXPENSE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.EXPENSE_RECEIPT, EVIDENCE_TYPES.OWNER_APPROVAL],
    remediation: "Confirm the amount against the receipt. Annual or quarterly payments in a monthly category often look like outliers.",
    evaluate(ctx) {
      const baseline = ctx.baselines.get(BASELINE_METRICS.EXPENSE_AMOUNT, `category:${ctx.expense.category || "general"}`);
      if (!baseline.usable || !baseline.upperFence || baseline.upperFence <= 0) {
        return passed; // never guess without a usable baseline
      }
      const amount = money(ctx.expense.amount);
      if (amount <= baseline.upperFence) return passed;
      return triggered({
        amountRupees: amount,
        category: ctx.expense.category,
        medianRupees: baseline.median,
        upperFenceRupees: Number(baseline.upperFence.toFixed(2)),
        sampleCount: baseline.sampleCount,
        excessPercent: Number(percentOf(amount - baseline.median, baseline.median).toFixed(1)),
        statistic: "median + 3×IQR",
      });
    },
  }),

  defineRule({
    ruleCode: "EXPENSE_REPEATED_ROUNDED_CASH",
    name: "Repeated round-number cash expenses",
    description: "Several cash expenses in this category are exact round numbers, which is a common pattern for estimated rather than receipted spend.",
    category: RULE_CATEGORIES.EXPENSE,
    severity: SEVERITY.LOW,
    defaultWeight: 12,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.EXPENSE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.EXPENSE_RECEIPT, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Record actual receipt amounts rather than round estimates so cash reconciles.",
    evaluate(ctx) {
      const ROUND_TO = 500;
      const MIN_COUNT = 3;
      const amount = money(ctx.expense.amount);
      if (amount <= 0 || amount % ROUND_TO !== 0 || String(ctx.expense.paymentMode).toLowerCase() !== "cash") return passed;
      const windowStart = new Date(ctx.expense.spentAt).getTime() - 30 * 24 * 60 * 60 * 1000;
      const peers = (ctx.recentExpenses ?? []).filter((row) => {
        if (String(row.paymentMode).toLowerCase() !== "cash") return false;
        if ((row.category || "general") !== (ctx.expense.category || "general")) return false;
        if (new Date(row.spentAt).getTime() < windowStart) return false;
        const value = money(row.amount);
        return value > 0 && value % ROUND_TO === 0;
      });
      const totalCount = peers.length + 1; // include this expense
      if (totalCount < MIN_COUNT) return passed;
      return triggered({
        roundedToRupees: ROUND_TO,
        roundedCashExpensesLast30Days: totalCount,
        minimumCount: MIN_COUNT,
        category: ctx.expense.category,
        totalRoundedRupees: Number((peers.reduce((sum, row) => sum + money(row.amount), 0) + amount).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "EXPENSE_UNATTRIBUTED",
    name: "Material expense with no recorded author",
    description: "A material expense carries no `recordedBy` value, so it cannot be attributed to anyone.",
    category: RULE_CATEGORIES.AUTHORIZATION,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.EXPENSE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.STAFF_EXPLANATION, EVIDENCE_TYPES.OWNER_APPROVAL],
    remediation: "Record who entered each expense. Note that expenses store a name, not a user id, so attribution is advisory only.",
    evaluate(ctx) {
      const amountPaise = Math.round(money(ctx.expense.amount) * 100);
      if (amountPaise <= ctx.settings.expenseReceiptRequiredAbovePaise) return passed;
      const recordedBy = ctx.expense.recordedBy && String(ctx.expense.recordedBy).trim();
      if (recordedBy) return passed;
      return triggered({
        amountRupees: money(ctx.expense.amount),
        thresholdRupees: ctx.settings.expenseReceiptRequiredAbovePaise / 100,
        recordedBy: null,
        // Expense has no userId column, so role-based permission checks are not
        // possible for expenses yet.
        userIdAttributionAvailable: false,
      });
    },
  }),

  defineRule({
    ruleCode: "EXPENSE_BACKDATED",
    name: "Expense dated well before it was entered",
    description: "The expense's spend date is more than two days before the date it was actually recorded.",
    category: RULE_CATEGORIES.EXPENSE,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.EXPENSE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.EXPENSE_RECEIPT, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Back-dated expenses shift profit between periods. Confirm the real spend date against the receipt.",
    evaluate(ctx) {
      const BACKDATE_DAYS = 2;
      const spentAt = new Date(ctx.expense.spentAt).getTime();
      const createdAt = new Date(ctx.expense.createdAt).getTime();
      const days = (createdAt - spentAt) / (24 * 60 * 60 * 1000);
      if (days <= BACKDATE_DAYS) return passed;
      return triggered({
        spentAt: new Date(spentAt).toISOString(),
        recordedAt: new Date(createdAt).toISOString(),
        backdatedByDays: Math.round(days),
        allowedDays: BACKDATE_DAYS,
        amountRupees: money(ctx.expense.amount),
      });
    },
  }),

  defineRule({
    ruleCode: "EXPENSE_ADDED_AFTER_CLOSING_LOCK",
    name: "Expense for a locked day added after the closing lock",
    description: "The expense is dated inside a business day whose closing is locked, but it was recorded after the lock.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.HIGH,
    defaultWeight: 24,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.EXPENSE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.EXPENSE_RECEIPT],
    remediation: "Re-open, refresh and re-lock that day's closing so the cash position includes this expense.",
    evaluate(ctx) {
      const snapshot = ctx.closingSnapshot;
      if (!snapshot?.lockedAt) return passed;
      const lockedAt = new Date(snapshot.lockedAt).getTime();
      const recordedAt = new Date(ctx.expense.createdAt).getTime();
      if (recordedAt <= lockedAt) return passed;
      return triggered({
        closingSnapshotId: snapshot.id,
        closingLockedAt: new Date(lockedAt).toISOString(),
        expenseRecordedAt: new Date(recordedAt).toISOString(),
        amountRupees: money(ctx.expense.amount),
        paymentMode: ctx.expense.paymentMode,
      });
    },
  }),

  defineRule({
    ruleCode: "EXPENSE_EDITED_WITHOUT_REASON",
    name: "Expense edited without any note",
    description: "The expense was modified after creation and carries no note explaining the change.",
    category: RULE_CATEGORIES.EXPENSE,
    severity: SEVERITY.LOW,
    defaultWeight: 12,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.RECORD_EDITED],
    evidenceTypes: [EVIDENCE_TYPES.CORRECTION_REASON, EVIDENCE_TYPES.EXPENSE_RECEIPT],
    remediation: "Add a note whenever an expense amount or category changes so the edit is self-explaining.",
    evaluate(ctx) {
      const created = new Date(ctx.expense.createdAt).getTime();
      const updated = new Date(ctx.expense.updatedAt).getTime();
      if (updated - created <= 60 * 1000) return passed; // same-session save
      const hasNotes = ctx.expense.notes && String(ctx.expense.notes).trim();
      if (hasNotes) return passed;
      return triggered({
        createdAt: new Date(created).toISOString(),
        updatedAt: new Date(updated).toISOString(),
        minutesAfterCreation: Math.round((updated - created) / 60000),
        notes: null,
      });
    },
  }),

  defineRule({
    ruleCode: "EXPENSE_CATEGORY_INCONSISTENT",
    name: "Expense title suggests a different category",
    description: "The expense title contains a keyword that maps to a different category than the one selected.",
    category: RULE_CATEGORIES.EXPENSE,
    severity: SEVERITY.LOW,
    defaultWeight: 8,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.EXPENSE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Re-categorise if it was a mis-tap. Category accuracy drives the expense breakdown reports.",
    evaluate(ctx) {
      const title = String(ctx.expense.title ?? "").toLowerCase();
      const category = String(ctx.expense.category ?? "general").toLowerCase();
      if (!title) return passed;
      for (const [suggested, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (suggested === category) return passed; // already correct
        if (keywords.some((keyword) => title.includes(keyword))) {
          // Only flag when the selected category has no keyword support itself.
          const selectedKeywords = CATEGORY_KEYWORDS[category] ?? [];
          if (selectedKeywords.some((keyword) => title.includes(keyword))) return passed;
          return triggered({
            title: ctx.expense.title,
            selectedCategory: ctx.expense.category,
            suggestedCategory: suggested,
            matchedKeyword: keywords.find((keyword) => title.includes(keyword)),
          });
        }
      }
      return passed;
    },
  }),

  defineRule({
    ruleCode: "EXPENSE_UNUSUAL_FREQUENCY",
    name: "Unusual number of expenses this week",
    description: "The number of expenses recorded in the last seven days is far above the shop's own weekly pattern.",
    category: RULE_CATEGORIES.EXPENSE,
    severity: SEVERITY.LOW,
    defaultWeight: 12,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.EXPENSE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "A burst of expense entries can be catch-up data entry or leakage; check the receipts for the week.",
    evaluate(ctx) {
      const MIN_WEEKS = 4;
      const ALERT_MULTIPLE = 3;
      const rows = ctx.recentExpenses ?? [];
      if (rows.length < 10) return passed;
      const anchor = new Date(ctx.expense.spentAt).getTime();
      const weekly = [];
      for (let index = 0; index < 12; index += 1) {
        const end = anchor - index * 7 * 24 * 60 * 60 * 1000;
        const start = end - 7 * 24 * 60 * 60 * 1000;
        weekly.push(rows.filter((row) => {
          const at = new Date(row.spentAt).getTime();
          return at > start && at <= end;
        }).length);
      }
      const [current, ...history] = weekly;
      const nonEmpty = history.filter((count) => count > 0);
      if (nonEmpty.length < MIN_WEEKS) return passed;
      const sorted = [...nonEmpty].sort((a, b) => a - b);
      const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      if (median <= 0 || current <= median * ALERT_MULTIPLE) return passed;
      return triggered({
        expensesLast7Days: current,
        medianWeeklyExpenses: median,
        alertMultiple: ALERT_MULTIPLE,
        weeksOfHistory: nonEmpty.length,
      });
    },
  }),

  defineRule({
    ruleCode: "EXPENSE_MISSING_PAYEE",
    name: "Material expense without a payee",
    description: "An expense above the receipt threshold records no vendor or payee.",
    category: RULE_CATEGORIES.EXPENSE,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: EXPENSE,
    applicableEventTypes: [EVENT_TYPES.EXPENSE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.EXPENSE_RECEIPT, EVIDENCE_TYPES.PAYMENT_RECEIPT],
    remediation: "Record who was paid. Payee-less spend above the threshold is the weakest link in expense control.",
    evaluate(ctx) {
      const threshold = ctx.settings.expenseReceiptRequiredAbovePaise;
      const amountPaise = Math.round(money(ctx.expense.amount) * 100);
      if (amountPaise <= threshold) return passed;
      const vendor = ctx.expense.vendor && String(ctx.expense.vendor).trim();
      if (vendor) return passed;
      return triggered({
        amountRupees: money(ctx.expense.amount),
        thresholdRupees: threshold / 100,
        vendor: null,
        paymentMode: ctx.expense.paymentMode,
      });
    },
  }),
];
