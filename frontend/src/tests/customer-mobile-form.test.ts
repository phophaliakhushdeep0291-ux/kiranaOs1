import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/core/customers/pages/CustomersPage.tsx", "utf8");
const syncBanner = readFileSync("src/features/core/sync/SyncAlertBanner.tsx", "utf8");
const tradeFocus = readFileSync("src/components/shared/TradeFocusStrip.tsx", "utf8");
const detailSource = readFileSync("src/features/core/customers/pages/CustomerDetailPage.tsx", "utf8");

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
    expect(source).toContain('window.matchMedia("(min-width: 1024px)")');
    expect(source).toContain("{showChart ? (");
  });

  it("keeps the primary customer search at the minimum touch-target height", () => {
    expect(source).toMatch(/aria-label=\{t\("customers\.searchShort"\)\}[\s\S]{0,250}className="h-11/);
    expect(source).toContain('aria-label={t("customers.detail.editCustomer")}');
    expect(source).toContain('className="grid h-11 w-11 place-items-center');
    expect(source).toContain('className="inline-flex min-h-11 shrink-0 items-center');
    expect(syncBanner).not.toContain('className="inline-flex h-9');
    expect(syncBanner.match(/className="inline-flex h-11/g)).toHaveLength(2);
    expect(tradeFocus).not.toContain("mouse:min-h-9");
  });

  it("keeps collection shortcuts and the full account flow phone-sized", () => {
    expect(source).toContain('className="min-h-11 rounded-[8px] border border-[var(--brand)]');
    expect(source).toContain('className={cn("inline-flex min-h-11 items-center');
    expect(source).toContain('aria-label={t("customers.ledger.actions")}');
    expect(detailSource).toContain('className="max-h-[92vh] max-w-md gap-0');
    expect(detailSource).toContain('className="grid grid-cols-2 gap-2 sm:flex');
    expect(detailSource).toContain('t("customers.account.receipt")');
  });
});
