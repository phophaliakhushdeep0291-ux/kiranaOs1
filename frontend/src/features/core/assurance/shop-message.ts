// Turns a finding into the sentence a shopkeeper reads.
//
// Everything here is built from numbers the rule ALREADY returned in
// `triggeredRules[].details`, so this is deterministic, works offline and costs
// nothing. The AI "explain" endpoint stays what it is — the fallback for
// "explain more", not the thing standing between the owner and their own money.
//
// Coverage is deliberately partial. A rule with no case below falls back to the
// engine's auditor-voice name, which is what every rule shows today, so this
// table can grow one rule at a time and a gap never renders as a blank.
import type { TranslationKey, TranslationVars } from "../settings/i18n";
import type { Finding, TriggeredRule } from "./api";
import { inrFromPaise } from "./ui";

export type ShopMessage = {
  /** Headline in the owner's words. */
  head: { key: TranslationKey; vars: TranslationVars };
  /** One line of "here is the arithmetic", still in plain words. */
  body: { key: TranslationKey; vars: TranslationVars } | null;
  /** What to do about it. Falls back to the rule's own remediation text. */
  doKey: TranslationKey | null;
  /** True when this rule has a shop-voice message; false = auditor fallback. */
  rewritten: boolean;
};

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Base-unit quantity, in the unit the owner would say.
 *
 * Deliberately NOT stock-display.ts: that formatter is selling-unit aware and
 * needs the product record, which a finding does not carry. Converting within
 * the base-unit family (1000 g = 1 kg) is arithmetic that cannot be wrong — it
 * just says "2 kg" where the shelf label might say "4 packets". The 1000×
 * errors that formatter exists to prevent come from ignoring PACK SIZE, which
 * is not a conversion this does.
 */
export function baseQty(value: unknown, baseUnit: unknown): string {
  const qty = Math.abs(num(value));
  const unit = String(baseUnit ?? "").toLowerCase();
  if (unit === "g" && qty >= 1000) return `${trim(qty / 1000)} kg`;
  if (unit === "ml" && qty >= 1000) return `${trim(qty / 1000)} L`;
  if (!unit || unit === "piece" || unit === "pc") return trim(qty);
  return `${trim(qty)} ${unit}`;
}

function trim(value: number): string {
  return String(Number(value.toFixed(3)));
}

/**
 * The entity's own name, for messages that read badly without it.
 *
 * Findings store one composed title, `"<label>: <rule name>"` (see
 * evaluation.service.js#findingTitle), and the label is the only place the
 * product name survives. Splitting on the first ": " recovers it; a name that
 * itself contains ": " yields a shortened name, never a wrong one. When there
 * is nothing to recover the caller gets null and picks a generic noun.
 */
export function entityName(finding: Pick<Finding, "title" | "sourceEntityType">): string | null {
  const separator = finding.title.indexOf(": ");
  if (separator <= 0) return null;
  const label = finding.title.slice(0, separator);
  const stripped = label.replace(/^(Product|Bill|Expense|Purchase|Customer|Daily closing|Sync event)\s*/i, "").trim();
  return stripped.length ? stripped : null;
}

/**
 * @param itemLabel translated stand-in ("this item") for when the product name
 *   could not be recovered from the stored title.
 */
export function shopMessage(finding: Finding, rule: TriggeredRule | undefined, itemLabel: string): ShopMessage {
  const auditorFallback: ShopMessage = {
    head: { key: "assurance.rule.generic.body", vars: {} },
    body: null,
    doKey: null,
    rewritten: false,
  };
  if (!rule) return auditorFallback;

  const d = rule.details ?? {};
  // The rule's own `differencePaise` comes first, and the finding's rolled-up
  // discrepancy is only the fallback. A finding can carry `discrepancyPaise:
  // null` while the rule that triggered it measured a real gap — that is how a
  // CRITICAL row ends up headlined "short by ₹0.00", which is the single
  // fastest way to make an owner stop trusting the whole screen.
  const gapPaise = d.differencePaise ?? finding.discrepancyPaise ?? null;
  const gap = gapPaise === null ? null : inrFromPaise(Math.abs(num(gapPaise)));
  const name = entityName(finding);
  const count = num(d.offenderCount);
  /** Two keys rather than a "(s)" suffix — see translations/assurance.ts. */
  const plural = (key: string) => (count === 1 ? `${key}1` : key) as TranslationKey;

  switch (rule.ruleCode) {
    case "CLOSING_CASH_FIGURE_STALE": {
      // difference = what the closing says − what the bills produce. Negative
      // means the day recorded LESS cash than it took, which is the direction
      // that costs money, so it gets the sharper headline.
      if (gap === null) return auditorFallback;
      const short = num(d.differencePaise) < 0;
      return {
        head: {
          key: short
            ? "assurance.rule.CLOSING_CASH_FIGURE_STALE.head"
            : "assurance.rule.CLOSING_CASH_FIGURE_STALE.over",
          vars: { amount: gap },
        },
        body: {
          key: "assurance.rule.CLOSING_CASH_FIGURE_STALE.body",
          vars: { expected: inrFromPaise(num(d.recomputedCashPaise)), recorded: inrFromPaise(num(d.snapshotCashPaise)) },
        },
        doKey: "assurance.rule.CLOSING_CASH_FIGURE_STALE.do",
        rewritten: true,
      };
    }

    case "CLOSING_CASH_EXPENSES_NOT_DEDUCTED":
      if (gap === null) return auditorFallback;
      return {
        head: { key: "assurance.rule.CLOSING_CASH_EXPENSES_NOT_DEDUCTED.head", vars: { amount: gap } },
        body: {
          key: "assurance.rule.CLOSING_CASH_EXPENSES_NOT_DEDUCTED.body",
          vars: {
            expected: inrFromPaise(num(d.recomputedExpectedCashPaise)),
            recorded: inrFromPaise(num(d.snapshotExpectedCashPaise)),
          },
        },
        doKey: "assurance.rule.CLOSING_CASH_EXPENSES_NOT_DEDUCTED.do",
        rewritten: true,
      };

    case "CLOSING_UPI_FIGURE_STALE":
      if (gap === null) return auditorFallback;
      return {
        head: { key: "assurance.rule.CLOSING_UPI_FIGURE_STALE.head", vars: { amount: gap } },
        body: {
          key: "assurance.rule.CLOSING_UPI_FIGURE_STALE.body",
          vars: { expected: inrFromPaise(num(d.recomputedUpiPaise)), recorded: inrFromPaise(num(d.snapshotUpiPaise)) },
        },
        doKey: "assurance.rule.CLOSING_UPI_FIGURE_STALE.do",
        rewritten: true,
      };

    case "STOCK_NEGATIVE_BALANCE":
      return {
        head: { key: "assurance.rule.STOCK_NEGATIVE_BALANCE.head", vars: { name: name ?? itemLabel } },
        body: {
          key: "assurance.rule.STOCK_NEGATIVE_BALANCE.body",
          vars: { qty: baseQty(d.shortfallBaseQty, d.baseUnit) },
        },
        doKey: "assurance.rule.STOCK_NEGATIVE_BALANCE.do",
        rewritten: true,
      };

    case "STOCK_DECREASE_WITHOUT_SOURCE":
      return {
        head: {
          key: "assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.head",
          vars: { qty: baseQty(d.totalUnexplainedBaseQty, d.baseUnit), name: name ?? itemLabel },
        },
        body: { key: plural("assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.body"), vars: { count } },
        doKey: "assurance.rule.STOCK_DECREASE_WITHOUT_SOURCE.do",
        rewritten: true,
      };

    case "STOCK_INCREASE_WITHOUT_SOURCE":
      return {
        head: { key: "assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.head", vars: { name: name ?? itemLabel } },
        body: { key: plural("assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.body"), vars: { count } },
        doKey: "assurance.rule.STOCK_INCREASE_WITHOUT_SOURCE.do",
        rewritten: true,
      };

    case "STOCK_SALE_EXCEEDED_AVAILABLE":
      return {
        head: { key: "assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.head", vars: { name: name ?? itemLabel } },
        body: { key: plural("assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.body"), vars: { count } },
        doKey: "assurance.rule.STOCK_SALE_EXCEEDED_AVAILABLE.do",
        rewritten: true,
      };

    default:
      return auditorFallback;
  }
}
