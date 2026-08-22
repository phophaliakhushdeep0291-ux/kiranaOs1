import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/core/customers/pages/CustomersPage.tsx", "utf8");

describe("phone-first customer form", () => {
  it("surfaces an exact mobile duplicate before save and routes to the existing profile", () => {
    expect(source).toContain("findDuplicateCustomerWarnings");
    expect(source).toContain('data-customer-duplicate-warning="mobile"');
    expect(source).toContain("openExistingDuplicate(exactMobileDuplicate.customerId)");
    expect(source).toContain("disabled={saving || Boolean(exactMobileDuplicate)}");
  });

  it("uses a mobile task surface with phone-native input and reachable actions", () => {
    expect(source).toContain('data-customer-form-dialog="true"');
    expect(source).toContain("max-h-[92vh]");
    expect(source).toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
    expect(source).toContain('inputMode="numeric"');
    expect(source).toContain('autoComplete="tel"');
    expect(source).toContain('data-customer-save="true"');
    expect(source).toContain("h-12 rounded-[12px]");
  });

  it("keeps the primary customer search at the minimum touch-target height", () => {
    expect(source).toMatch(/aria-label=\{t\("customers\.searchShort"\)\}[\s\S]{0,250}className="h-11/);
  });
});
