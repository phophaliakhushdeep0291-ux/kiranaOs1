import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { SHOP_WORKFLOWS } from "@/features/core/settings/shop-workflows";

const dashboardPage = readFileSync(join(process.cwd(), "src/features/core/dashboard/pages/DashboardPage.tsx"), "utf8");
const productForm = readFileSync(join(process.cwd(), "src/features/core/products/pages/components/ProductFormPanel.tsx"), "utf8");

describe("shop-type workflows", () => {
  it("defines four usable daily actions for every registered shop type", () => {
    const businessTypes = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];
    expect(Object.keys(SHOP_WORKFLOWS).sort()).toEqual([...businessTypes].sort());

    for (const businessType of businessTypes) {
      const workflow = SHOP_WORKFLOWS[businessType];
      expect(workflow.title.length).toBeGreaterThan(4);
      expect(workflow.actions).toHaveLength(4);
      expect(workflow.actions.every((action) => action.href.startsWith("/"))).toBe(true);
      expect(new Set(workflow.actions.map((action) => action.label)).size).toBe(4);
      expect(workflow.productEntry.namePlaceholder.length).toBeGreaterThan(4);
      expect(workflow.productEntry.identifierLabel.length).toBeGreaterThan(4);
    }
  });

  it("prioritizes the defining workflow for specialized shops", () => {
    expect(SHOP_WORKFLOWS.pharmacy.actions.some((action) => action.href === "/inventory/batches")).toBe(true);
    expect(SHOP_WORKFLOWS.pharmacy.productEntry.recommendBatchTracking).toBe(true);
    expect(SHOP_WORKFLOWS.cosmetics.productEntry.recommendBatchTracking).toBe(true);
    expect(SHOP_WORKFLOWS.restaurant.actions.some((action) => action.href === "/daily-closing")).toBe(true);
    expect(SHOP_WORKFLOWS.clothing.productEntry.helper).toContain("separate SKU");
    expect(SHOP_WORKFLOWS.footwear.productEntry.helper).toContain("one SKU");
    expect(SHOP_WORKFLOWS.auto_parts.productEntry.notesLabel).toContain("Compatibility");
    expect(SHOP_WORKFLOWS.electronics.productEntry.helper).toContain("planned next step");
  });

  it("wires the capability map into dashboard and product entry", () => {
    expect(dashboardPage).toContain('data-testid="shop-workflow-panel"');
    expect(dashboardPage).toContain("getShopWorkflow(businessType)");
    expect(productForm).toContain('data-testid="shop-product-entry-guide"');
    expect(productForm).toContain('data-testid="shop-batch-guidance"');
    expect(productForm).toContain('useFeature("batch_expiry")');
  });
});
