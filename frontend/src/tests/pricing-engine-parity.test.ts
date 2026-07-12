import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluatePricing } from "@/features/pricing/engine/engine";
import type { PricingContext, PricingRule } from "@/features/pricing/engine/types";

// Reads the SAME canonical fixtures the backend runs
// (backend/tests/pricing-engine.examples.js). Frontend + backend engines are
// faithful ports; this proves they agree. If one changes, this fails.
const fixturesPath = fileURLToPath(new URL("../../../backend/tests/fixtures/pricing-parity.json", import.meta.url));
const fixtures: Array<{
  name: string;
  context: PricingContext;
  rules: PricingRule[];
  expected: { recommendedUnitPrice: number; appliedRuleType: string; requiresApproval: boolean };
}> = JSON.parse(readFileSync(fixturesPath, "utf8"));

describe("pricing engine — FE/BE parity on shared fixtures", () => {
  for (const f of fixtures) {
    it(f.name, () => {
      const r = evaluatePricing(f.context, f.rules);
      expect(r.recommendedUnitPrice).toBe(f.expected.recommendedUnitPrice);
      expect(r.appliedRuleType).toBe(f.expected.appliedRuleType);
      expect(r.requiresApproval).toBe(f.expected.requiresApproval);
      expect(r.calculationVersion).toBe("pricing-v1");
    });
  }
});
