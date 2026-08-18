// The shop-voice layer, checked against payloads taken verbatim from a real
// accumulated shop (dev.db, 2026-08-18) rather than hand-written fixtures.
//
// That distinction is the whole point: every "insane data" defect this module
// has ever shipped — a ₹0 gap beside a CRITICAL row, a headline larger than
// lifetime sales, a negative amount — passed a clean-fixture suite and only
// appeared against accumulated data.
import { describe, expect, it } from "vitest";
import { assuranceEn } from "@/features/core/settings/translations/assurance";
import { assuranceHi } from "@/features/core/settings/translations/assurance.hi";
import { shopMessage, baseQty, entityName } from "@/features/core/assurance/shop-message";
import type { Finding, TriggeredRule } from "@/features/core/assurance/api";

/** Same substitution `t()` performs, so these assertions read as final text. */
function render(catalogue: Record<string, string>, key: string, vars: Record<string, string | number>) {
  return (catalogue[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
    vars[name] === undefined ? match : String(vars[name])
  );
}

function say(finding: Finding, rule: TriggeredRule, catalogue: Record<string, string>, item: string) {
  const message = shopMessage(finding, rule, item);
  return {
    head: render(catalogue, message.head.key, message.head.vars),
    body: message.body ? render(catalogue, message.body.key, message.body.vars) : null,
    rewritten: message.rewritten,
  };
}

function fixture(
  ruleCode: string,
  title: string,
  discrepancyPaise: number | null,
  details: Record<string, unknown>
): { finding: Finding; rule: TriggeredRule } {
  const rule = {
    ruleCode, ruleVersion: 1, category: "X", severity: "HIGH", scoreContribution: 30,
    active: true, name: `${ruleCode} auditor name`, description: null, remediation: null, details,
  } as unknown as TriggeredRule;
  const finding = {
    findingId: "f1", title, status: "OPEN", sourceEntityType: "PRODUCT", sourceEntityId: "e1",
    riskLevel: "HIGH", riskScore: 60, discrepancyPaise, amountPaise: null, triggeredRules: [rule],
  } as unknown as Finding;
  return { finding, rule };
}

// ── the six rules, with the exact details each returned in dev.db ──
const REAL = {
  cashStale: fixture(
    "CLOSING_CASH_FIGURE_STALE",
    "Daily closing 2026-07-28: Closing cash figure does not match the day's cash payments (+1 more)",
    null, // ← the finding measured nothing; the RULE did
    { snapshotCashPaise: 35000, recomputedCashPaise: 17000, differencePaise: 18000 }
  ),
  cashExpenses: fixture(
    "CLOSING_CASH_EXPENSES_NOT_DEDUCTED",
    "Daily closing 2026-07-03: Closing cash figure does not match the day's cash payments (+4 more)",
    36800,
    { snapshotExpectedCashPaise: 16800, recomputedExpectedCashPaise: -20000, differencePaise: 36800 }
  ),
  decrease: fixture(
    "STOCK_DECREASE_WITHOUT_SOURCE",
    "Product Tata Salt 1kg: Stock decreased without a recognised source transaction (+1 more)",
    4000,
    { offenderCount: 1, baseUnit: "piece", totalUnexplainedBaseQty: 2 }
  ),
  increase: fixture(
    "STOCK_INCREASE_WITHOUT_SOURCE",
    "Product Tata Salt 1kg: Stock decreased without a recognised source transaction (+1 more)",
    4000,
    { offenderCount: 1, baseUnit: "piece" }
  ),
  negative: fixture(
    "STOCK_NEGATIVE_BALANCE",
    "Product OversellTest-1783506700541: Negative stock (+1 more)",
    2000,
    { stockBaseQty: -1, baseUnit: "piece", shortfallBaseQty: 1 }
  ),
  oversold: fixture(
    "STOCK_SALE_EXCEEDED_AVAILABLE",
    "Product OversellTest-1783506700541: Negative stock (+1 more)",
    2000,
    { offenderCount: 1, baseUnit: "piece" }
  ),
};

describe("assurance shop messages", () => {
  it("never headlines a measured gap as zero", () => {
    // The regression that made this layer worth writing. `discrepancyPaise` is
    // null on this finding while the rule holds differencePaise 18000.
    const { head } = say(REAL.cashStale.finding, REAL.cashStale.rule, assuranceEn, "this item");
    expect(head).toBe("Gallā shows ₹180 more than the bills");
    expect(head).not.toContain("₹0");
  });

  it("picks the direction of a cash difference from its sign", () => {
    const short = fixture("CLOSING_CASH_FIGURE_STALE", "Daily closing 2026-07-28: x", null, {
      snapshotCashPaise: 17000, recomputedCashPaise: 35000, differencePaise: -18000,
    });
    const { head } = say(short.finding, short.rule, assuranceEn, "this item");
    expect(head).toBe("Gallā is short by ₹180");
  });

  it("leads every money message with rupees, in both languages", () => {
    const en = say(REAL.cashExpenses.finding, REAL.cashExpenses.rule, assuranceEn, "this item");
    const hi = say(REAL.cashExpenses.finding, REAL.cashExpenses.rule, assuranceHi, "यह सामान");
    expect(en.head).toBe("₹368 of cash is unaccounted for");
    expect(hi.head).toBe("₹368 नकद का हिसाब नहीं मिल रहा");
  });

  it("names the product the owner would recognise", () => {
    const en = say(REAL.decrease.finding, REAL.decrease.rule, assuranceEn, "this item");
    const hi = say(REAL.negative.finding, REAL.negative.rule, assuranceHi, "यह सामान");
    expect(en.head).toBe("2 of Tata Salt 1kg left without a bill");
    expect(hi.head).toBe("OversellTest-1783506700541 का स्टॉक माइनस में है");
  });

  it("rewrites all six rules in both languages, with no placeholder left unfilled", () => {
    for (const [name, { finding, rule }] of Object.entries(REAL)) {
      for (const [lang, catalogue, item] of [
        ["en", assuranceEn, "this item"],
        ["hi", assuranceHi, "यह सामान"],
      ] as const) {
        const said = say(finding, rule, catalogue as Record<string, string>, item);
        expect(said.rewritten, `${name}/${lang} fell back to the auditor wording`).toBe(true);
        expect(said.head, `${name}/${lang} left a {placeholder}`).not.toMatch(/\{\w+\}/);
        expect(said.body, `${name}/${lang} left a {placeholder}`).not.toMatch(/\{\w+\}/);
        expect(said.head.length, `${name}/${lang} headline is empty`).toBeGreaterThan(5);
      }
    }
  });

  it("keeps the auditor wording for a rule that has no shop message yet", () => {
    const other = fixture("BILL_TOTAL_MISMATCH", "Bill B-1: totals disagree", 100, {});
    expect(shopMessage(other.finding, other.rule, "this item").rewritten).toBe(false);
  });

  it("states quantity in the base unit's own family, never raw grams", () => {
    expect(baseQty(2000, "g")).toBe("2 kg");
    expect(baseQty(1500, "ml")).toBe("1.5 L");
    expect(baseQty(2, "piece")).toBe("2");
    expect(baseQty(-3, "piece")).toBe("3");
  });

  it("recovers the entity name from the engine's composed title", () => {
    expect(entityName({ title: "Product Tata Salt 1kg: Negative stock", sourceEntityType: "PRODUCT" } as Finding))
      .toBe("Tata Salt 1kg");
    expect(entityName({ title: "no separator here", sourceEntityType: "PRODUCT" } as Finding)).toBeNull();
  });
});
