import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductCard } from "@/features/core/billing/pages/components/BillingSearch";
import type { Translate } from "@/features/core/settings/i18n";
import type { Product } from "@/types/api";

const render = (fields: Partial<Product>) => renderToStaticMarkup(<ProductCard
  product={{ id: "dish", name: "Dal Fry", defaultPricePerRateUnit: 180, ...fields } as Product}
  onAdd={() => undefined} t={((key: string) => key) as Translate} />);

describe("restaurant billing stock badges", () => {
  it("does not label untracked dishes as empty or low, including old negative counts", () => {
    for (const stockBaseQty of [-12, 0, 2]) {
      const html = render({ stockBaseQty, stockTrackingEnabled: false });
      expect(html).toContain("Dal Fry");
      expect(html).not.toContain("billing.search.stockOut");
      expect(html).not.toContain("billing.search.stockLow");
    }
  });
  it("retains stock warnings for bottled goods and ingredients", () => {
    expect(render({ stockBaseQty: 0, stockTrackingEnabled: true })).toContain("billing.search.stockOut");
    expect(render({ stockBaseQty: 2, stockTrackingEnabled: true })).toContain("billing.search.stockLow");
  });
});
