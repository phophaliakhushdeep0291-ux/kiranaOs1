import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { SHOP_WORKFLOWS } from "@/features/core/settings/shop-workflows";
import type { TranslationKey } from "@/features/core/settings/i18n";
import { englishTranslations } from "@/features/core/settings/translations/english";

/**
 * The workflow table holds dictionary keys now, so a length or substring check on
 * a field is checking the key, not the sentence. Resolve first, then assert —
 * otherwise `namePlaceholder.length > 4` passes on any key ever written.
 */
const say = (key: TranslationKey) => englishTranslations[key];

const dashboardPage = readFileSync(join(process.cwd(), "src/features/core/dashboard/pages/DashboardPage.tsx"), "utf8");
const productForm = readFileSync(join(process.cwd(), "src/features/core/products/pages/components/ProductFormPanel.tsx"), "utf8");

describe("shop-type workflows", () => {
  it("defines four usable daily actions for every registered shop type", () => {
    const businessTypes = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];
    expect(Object.keys(SHOP_WORKFLOWS).sort()).toEqual([...businessTypes].sort());

    for (const businessType of businessTypes) {
      const workflow = SHOP_WORKFLOWS[businessType];
      expect(say(workflow.title).length).toBeGreaterThan(4);
      expect(workflow.actions).toHaveLength(4);
      expect(workflow.actions.every((action) => action.href.startsWith("/"))).toBe(true);
      // Distinct on the WORDS, not the keys: four keys are trivially distinct.
      expect(new Set(workflow.actions.map((action) => say(action.label))).size).toBe(4);
      expect(say(workflow.productEntry.namePlaceholder).length).toBeGreaterThan(4);
      expect(say(workflow.productEntry.identifierLabel).length).toBeGreaterThan(4);
    }
  });

  it("prioritizes the defining workflow for specialized shops", () => {
    expect(SHOP_WORKFLOWS.pharmacy.actions.some((action) => action.href === "/inventory/batches")).toBe(true);
    expect(SHOP_WORKFLOWS.pharmacy.productEntry.recommendBatchTracking).toBe(true);
    expect(SHOP_WORKFLOWS.cosmetics.productEntry.recommendBatchTracking).toBe(true);
    expect(SHOP_WORKFLOWS.restaurant.actions.some((action) => action.href === "/daily-closing")).toBe(true);
    expect(say(SHOP_WORKFLOWS.clothing.productEntry.helper)).toContain("separate SKU");
    expect(say(SHOP_WORKFLOWS.footwear.productEntry.helper)).toContain("one SKU");
    expect(say(SHOP_WORKFLOWS.auto_parts.productEntry.notesLabel)).toContain("Compatibility");
    expect(say(SHOP_WORKFLOWS.electronics.productEntry.helper)).toContain("planned next step");
  });

  it("wires the capability map into dashboard and product entry", () => {
    expect(dashboardPage).toContain('data-testid="shop-workflow-panel"');
    expect(dashboardPage).toContain("getShopWorkflow(businessType)");
    expect(productForm).toContain('data-testid="shop-product-entry-guide"');
    expect(productForm).toContain('data-testid="shop-batch-guidance"');
    expect(productForm).toContain('useFeature("batch_expiry")');
  });
});
