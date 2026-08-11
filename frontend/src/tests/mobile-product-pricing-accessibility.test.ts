import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../features/core/pricing/pages/ProductPricingPage.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../features/core/pricing/api.ts", import.meta.url), "utf8");

describe("mobile product pricing accessibility", () => {
  it("keeps permanent-pricing inputs and actions at the 44px touch contract", () => {
    expect(source).toContain('className="h-11 w-full rounded-lg border border-amber-300');
    expect(source).toContain('const inputCls = "h-11 ');
    expect(source).toContain('const addBtn = "inline-flex min-h-11 ');
    expect(source).toContain("grid min-h-11 min-w-11 place-items-center");
    expect(source).toContain("inline-flex min-h-11 items-center");
  });

  it("does not nest a pseudo-button inside the selling-unit selection button", () => {
    expect(source).not.toContain('role="button"');
    expect(source).toContain(">Disable unit</button>");
  });

  it("expires the entered owner PIN after every successful permanent change", () => {
    expect(source.match(/setOwnerPin\(""\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("bypasses browser caches when refetching mutable pricing state", () => {
    expect(apiSource.match(/cache: "no-store"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
