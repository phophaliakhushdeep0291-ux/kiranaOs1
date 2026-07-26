// Versioned rule registry.
//
// The code registry is the catalog: it owns each rule's version, weight and
// severity. The AuditRule table only holds per-shop overrides (enabled flag,
// weight override, thresholds). RULESET_VERSION is a content hash over every
// `ruleCode@version` pair, so any rule change produces a new ruleset version
// and findings stay traceable to the exact logic that raised them.
import crypto from "node:crypto";
import { billingRules } from "./billing.rules.js";
import { customerCreditRules } from "./customer-credit.rules.js";
import { inventoryRules } from "./inventory.rules.js";
import { purchaseRules } from "./purchase.rules.js";
import { expenseRules } from "./expense.rules.js";
import { cashClosingRules } from "./cash-closing.rules.js";
import { syncIntegrityRules } from "./sync-integrity.rules.js";

export const ALL_RULES = Object.freeze([
  ...billingRules,
  ...customerCreditRules,
  ...inventoryRules,
  ...purchaseRules,
  ...expenseRules,
  ...cashClosingRules,
  ...syncIntegrityRules,
]);

const duplicates = ALL_RULES.map((rule) => rule.ruleCode).filter((code, index, all) => all.indexOf(code) !== index);
if (duplicates.length) {
  throw new Error(`Duplicate audit rule codes registered: ${[...new Set(duplicates)].join(", ")}`);
}

export const RULES_BY_CODE = Object.freeze(
  Object.fromEntries(ALL_RULES.map((rule) => [rule.ruleCode, rule]))
);

export const RULESET_VERSION = `ruleset-${crypto
  .createHash("sha256")
  .update(ALL_RULES.map((rule) => `${rule.ruleCode}@${rule.version}`).sort().join(","))
  .digest("hex")
  .slice(0, 12)}`;

const RULES_BY_ENTITY_TYPE = new Map();
for (const rule of ALL_RULES) {
  for (const entityType of rule.applicableEntityTypes) {
    const list = RULES_BY_ENTITY_TYPE.get(entityType) ?? [];
    list.push(rule);
    RULES_BY_ENTITY_TYPE.set(entityType, list);
  }
}

export function rulesForEntityType(entityType) {
  return RULES_BY_ENTITY_TYPE.get(entityType) ?? [];
}

export function ruleCatalog() {
  return ALL_RULES.map((rule) => ({
    ruleId: rule.ruleId,
    ruleCode: rule.ruleCode,
    name: rule.name,
    description: rule.description,
    category: rule.category,
    severity: rule.severity,
    defaultWeight: rule.defaultWeight,
    version: rule.version,
    effectiveFrom: rule.effectiveFrom,
    enabledByDefault: rule.enabled,
    applicableEntityTypes: rule.applicableEntityTypes,
    applicableEventTypes: rule.applicableEventTypes,
    evidenceTypes: rule.evidenceTypes,
    remediation: rule.remediation,
  }));
}
