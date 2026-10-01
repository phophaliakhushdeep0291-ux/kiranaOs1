import { describe, expect, it } from "vitest";
import {
  buildMerchantSetupProgress,
  createMerchantSetupState,
  normaliseMerchantSetupState,
  type MerchantSetupFacts,
} from "@/features/core/settings/merchant-setup-state";
import { type Translate } from "@/features/core/settings/i18n";
import { englishTranslations } from "@/features/core/settings/translations/english";
import { KIRANA_STARTER_CATALOG_COUNT } from "@/features/core/products/starter-catalog/kirana-catalog-summary.generated";

/**
 * The real English catalogue rather than a key-echoing stub, so a key this module asks
 * for that does not exist fails here as well as in the completeness test — and the
 * assertions below keep reading as the sentences a shopkeeper sees.
 */
const t: Translate = (key, vars) =>
  Object.entries(vars ?? {}).reduce<string>(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    englishTranslations[key],
  );

const EMPTY_FACTS: MerchantSetupFacts = {
  storeProfileReady: false,
  productCount: 0,
  productsInStockCount: 0,
  customerCount: 0,
  supplierCount: 0,
  billCount: 0,
};

describe("a catalogue with nothing on the shelf is not a ready shop", () => {
  const productsStep = (facts: MerchantSetupFacts) =>
    buildMerchantSetupProgress(facts, createMerchantSetupState(), t).steps.find((step) => step.id === "products");

  it("stays Needed when every product is out of stock", () => {
    // What loading the 560-item starter catalogue leaves behind: it ships with
    // Opening Stock 0 on every row, so the shop has a full price list and an
    // empty shelf. Calling that Ready sent a shopkeeper to the counter to find
    // out.
    const step = productsStep({ ...EMPTY_FACTS, productCount: 560, productsInStockCount: 0 });
    expect(step?.complete).toBe(false);
    expect(step?.detail).toContain("560");
    expect(step?.detail).toMatch(/stock/i);
  });

  it("is Ready once anything is actually sellable", () => {
    const step = productsStep({ ...EMPTY_FACTS, productCount: 560, productsInStockCount: 12 });
    expect(step?.complete).toBe(true);
  });

  it("still tells a brand-new shop it has no products at all", () => {
    const step = productsStep(EMPTY_FACTS);
    expect(step?.complete).toBe(false);
    expect(step?.detail).not.toContain("0 products");
  });
});

describe("merchant setup readiness", () => {
  it("does not mark confirmable production settings ready from defaults alone", () => {
    const progress = buildMerchantSetupProgress(
      { ...EMPTY_FACTS, storeProfileReady: true, productCount: 10 },
      createMerchantSetupState(),
      t,
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
      { ...EMPTY_FACTS, storeProfileReady: true, productCount: 125, productsInStockCount: 125 },
      state,
      t,
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
      { ...EMPTY_FACTS, storeProfileReady: true, productCount: 1, productsInStockCount: 1 },
      state,
      t,
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
        productsInStockCount: 3,
        customerCount: 2,
        supplierCount: 1,
        billCount: 1,
      },
      state,
      t,
    );

    expect(progress.completedCount).toBe(progress.totalCount);
    expect(progress.percent).toBe(100);
    expect(progress.nextStep).toBeUndefined();
  });
});

describe("built-in starter catalog offer", () => {
  const quickActionFor = (facts: Partial<MerchantSetupFacts>) =>
    buildMerchantSetupProgress({ ...EMPTY_FACTS, ...facts }, createMerchantSetupState(), t)
      .steps.find((step) => step.id === "products")?.quickAction;

  it("offers the catalog to a kirana shop with no products", () => {
    const action = quickActionFor({ businessTypeKey: "kirana" });
    expect(action?.id).toBe("load-starter-catalog");
    // The number comes from the generated summary, so the label cannot promise 560 items
    // while the CSV ships a different count.
    expect(action?.label).toBe(`Load ${KIRANA_STARTER_CATALOG_COUNT} common starter items`);
  });

  it("offers each trade its own smaller starter catalog", () => {
    expect(quickActionFor({ businessTypeKey: "pharmacy" })?.label).toBe("Load 10 common starter items");
    expect(quickActionFor({ businessTypeKey: "clothing" })?.label).toBe("Load 11 common starter items");
  });

  it("does not offer it before the shop has chosen a trade", () => {
    // The device store defaults to "kirana" when nothing is saved; an absent key must not
    // be read as a decision to sell groceries.
    expect(quickActionFor({})).toBeUndefined();
  });

  it("withdraws the offer once the shop has products of its own", () => {
    expect(quickActionFor({ businessTypeKey: "kirana", productCount: 1 })).toBeUndefined();
  });
});
