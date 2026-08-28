import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProductCard } from "@/features/core/billing/pages/components/BillingSearch";
import { getShopBillingProfile } from "@/features/core/settings/shop-billing";
import type { Translate } from "@/features/core/settings/i18n";
import type { Product } from "@/types/api";

const t = ((key: string) => key) as Translate;
const dish = { id: "dish", name: "Dal Fry", defaultPricePerRateUnit: 140, stockBaseQty: 0 } as Product;

describe("billing product card presentation", () => {
  it("renders a restaurant dish without a misleading retail out badge", () => {
    const html = renderToStaticMarkup(<ProductCard product={dish} onAdd={() => {}} showInventoryBadges={getShopBillingProfile("restaurant").showInventoryBadges !== false} t={t} />);
    expect(html).toContain("Dal Fry");
    expect(html).toContain("140.00");
    expect(html).not.toContain("billing.search.stockOut");
    expect(html).not.toContain("billing.search.stockLow");
    expect(html).not.toContain("disabled");
  });

  it("still shows out and low badges for a retail counter", () => {
    for (const [stockBaseQty, label] of [[0, "stockOut"], [2, "stockLow"]] as const) {
      const html = renderToStaticMarkup(<ProductCard product={{ ...dish, stockBaseQty }} onAdd={() => {}} showInventoryBadges={getShopBillingProfile("kirana").showInventoryBadges !== false} t={t} />);
      expect(html).toContain(`billing.search.${label}`);
    }
  });

  it("wires the active business profile into every grid card", () => {
    const source = readFileSync("src/features/core/billing/pages/components/BillingSearch.tsx", "utf8");
    expect(source).toContain("getShopBillingProfile(businessType).showInventoryBadges !== false");
    expect(source).toContain("showInventoryBadges={showInventoryBadges}");
  });
});
