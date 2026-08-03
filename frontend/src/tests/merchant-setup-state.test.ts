import { describe, expect, it } from "vitest";
import {
  buildMerchantSetupProgress,
  createMerchantSetupState,
  normaliseMerchantSetupState,
  type MerchantSetupFacts,
} from "@/features/core/settings/merchant-setup-state";

const EMPTY_FACTS: MerchantSetupFacts = {
  storeProfileReady: false,
  productCount: 0,
  customerCount: 0,
  supplierCount: 0,
  billCount: 0,
};

describe("merchant setup readiness", () => {
  it("does not mark confirmable production settings ready from defaults alone", () => {
    const progress = buildMerchantSetupProgress(
      { ...EMPTY_FACTS, storeProfileReady: true, productCount: 10 },
      createMerchantSetupState(),
    );

    expect(progress.requiredComplete).toBe(false);
    expect(progress.steps.find((step) => step.id === "taxes")?.complete).toBe(false);
    expect(progress.steps.find((step) => step.id === "billing")?.complete).toBe(false);
    expect(progress.steps.find((step) => step.id === "printer")?.complete).toBe(false);
    expect(progress.nextStep?.id).toBe("taxes");
  });

  it("marks the shop ready to bill after required facts and owner confirmations", () => {
    const state = normaliseMerchantSetupState({
      confirmed: { taxes: true, billing: true, printer: true },
      skipped: {},
    });

    const progress = buildMerchantSetupProgress(
      { ...EMPTY_FACTS, storeProfileReady: true, productCount: 125 },
      state,
    );

    expect(progress.requiredComplete).toBe(true);
    expect(progress.nextStep?.id).toBe("customers");
  });

  it("lets optional customer and supplier setup be skipped without pretending data exists", () => {
    const state = normaliseMerchantSetupState({
      confirmed: { taxes: true, billing: true, printer: true },
      skipped: { customers: true, suppliers: true },
    });

    const progress = buildMerchantSetupProgress(
      { ...EMPTY_FACTS, storeProfileReady: true, productCount: 1 },
      state,
    );

    const customers = progress.steps.find((step) => step.id === "customers");
    const suppliers = progress.steps.find((step) => step.id === "suppliers");
    expect(customers?.complete).toBe(true);
    expect(customers?.skipped).toBe(true);
    expect(suppliers?.complete).toBe(true);
    expect(suppliers?.skipped).toBe(true);
    expect(progress.nextStep?.id).toBe("first-bill");
  });

  it("uses real counts to complete data-backed setup steps", () => {
    const state = normaliseMerchantSetupState({
      confirmed: { taxes: true, billing: true, printer: true },
      skipped: {},
    });

    const progress = buildMerchantSetupProgress(
      {
        storeProfileReady: true,
        productCount: 3,
        customerCount: 2,
        supplierCount: 1,
        billCount: 1,
      },
      state,
    );

    expect(progress.completedCount).toBe(progress.totalCount);
    expect(progress.percent).toBe(100);
    expect(progress.nextStep).toBeUndefined();
  });
});
