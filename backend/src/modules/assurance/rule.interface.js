// Rule interface + helpers for the deterministic rule engine.
//
// A rule is a plain object with an `evaluate(context)` function. Rules must be:
//   * deterministic — same context in, same verdict out, no clock/random reads
//     beyond what the context provides;
//   * arithmetic-authoritative — the LLM never decides whether numbers match;
//   * side-effect free — a rule may not write anything, anywhere.
//
// `evaluate` returns either a falsy value (not triggered) or
// `{ triggered: true, details: { … } }` where details records the exact numbers
// compared so the finding is explainable without re-running the rule.
export function defineRule(definition) {
  const required = ["ruleCode", "name", "description", "category", "severity", "defaultWeight", "version", "applicableEntityTypes", "evaluate"];
  for (const key of required) {
    if (definition[key] === undefined || definition[key] === null) {
      throw new Error(`Audit rule is missing "${key}": ${definition.ruleCode ?? "unknown"}`);
    }
  }
  if (typeof definition.evaluate !== "function") {
    throw new Error(`Audit rule ${definition.ruleCode} has a non-function evaluate`);
  }
  return Object.freeze({
    ruleId: `${definition.ruleCode}@${definition.version}`,
    applicableEventTypes: [],
    effectiveFrom: "2026-07-26",
    enabled: true,
    evidenceTypes: [],
    remediation: "Review the source transaction and attach supporting evidence.",
    ...definition,
  });
}

/** Shorthand for a triggered verdict. */
export function triggered(details = {}) {
  return { triggered: true, details };
}

/** Explicit "nothing wrong here". */
export const passed = null;

// ── deterministic comparison helpers ─────────────────────────
// Money lives as Float rupees plus BigInt paise shadows in KiranaOS. Rules
// normalize every value to integer paise before arithmetic or comparison. This
// removes Float noise without hiding a real one-paisa discrepancy.

export function money(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toPaiseInt(value) {
  return Math.round(money(value) * 100);
}

export function fromPaiseInt(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed / 100 : 0;
}

export function moneyDiffers(left, right) {
  return toPaiseInt(left) !== toPaiseInt(right);
}

export function moneyGreaterThan(left, right) {
  return toPaiseInt(left) > toPaiseInt(right);
}

export function moneyLessThan(left, right) {
  return toPaiseInt(left) < toPaiseInt(right);
}

export function quantityDiffers(left, right, epsilon = 0.0001) {
  return Math.abs(Number(left ?? 0) - Number(right ?? 0)) > epsilon;
}

export function sum(values) {
  return fromPaiseInt(values.reduce((total, value) => total + toPaiseInt(value), 0));
}

export function percentOf(part, whole) {
  const base = money(whole);
  if (base <= 0) return 0;
  return (100 * money(part)) / base;
}

export function isoOrNull(date) {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function daysBetween(later, earlier) {
  if (!later || !earlier) return null;
  return (new Date(later).getTime() - new Date(earlier).getTime()) / (24 * 60 * 60 * 1000);
}
