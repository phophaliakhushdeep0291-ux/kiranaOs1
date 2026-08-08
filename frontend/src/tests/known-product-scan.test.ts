import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  apiRequest: vi.fn(),
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: vi.fn(async (key: string) => mockState.settings.get(key) ?? null),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      mockState.settings.set(key, value);
    }),
  },
}));

vi.mock("@/lib/api/http", () => ({
  apiRequest: mockState.apiRequest,
}));

import { lookupKnownProduct, type KnownProductDetails } from "@/features/core/products/product-knowledge";
import {
  mergeDraftIntoProductForm,
  productToForm,
  readProductDraftEventDetail,
} from "@/features/core/products/pages/product-form-state";

const knownProduct: KnownProductDetails = {
  found: true,
  barcode: "8901234567890",
  name: "Parle-G Original",
  brand: "Parle",
  category: "Biscuits",
  unit: "packet",
  packSizeValue: 800,
  packSizeUnit: "g",
  aliases: ["पारले जी", "Glucose biscuits"],
  description: "Glucose biscuits",
  imageUrl: "https://images.openfoodfacts.org/images/products/890/123/456/7890/front_en.jpg",
  source: "Open Food Facts",
};

beforeEach(() => {
  mockState.settings.clear();
  mockState.apiRequest.mockReset();
});

describe("shared barcode product knowledge", () => {
  it("returns all known identity fields and caches them for every later scan", async () => {
    mockState.apiRequest.mockResolvedValue(knownProduct);

    const first = await lookupKnownProduct(knownProduct.barcode, { online: true, now: 1_000 });
    const second = await lookupKnownProduct(knownProduct.barcode, { online: true, now: 2_000 });

    expect(first).toEqual(knownProduct);
    expect(second).toEqual(knownProduct);
    expect(first?.imageUrl).toContain("images.openfoodfacts.org");
    expect(mockState.apiRequest).toHaveBeenCalledTimes(1);
    expect(mockState.apiRequest).toHaveBeenCalledWith(
      `/products/knowledge/${knownProduct.barcode}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses a previously learned product while the shop is offline", async () => {
    mockState.settings.set(`product-knowledge:v1:${knownProduct.barcode}`, {
      checkedAt: 1_000,
      value: knownProduct,
    });

    await expect(lookupKnownProduct(knownProduct.barcode, { online: false, now: 2_000 }))
      .resolves.toEqual(knownProduct);
    expect(mockState.apiRequest).not.toHaveBeenCalled();
  });

  it("prefills identity and image without inventing shop price, GST or stock", () => {
    const detail = readProductDraftEventDetail({
      merge: false,
      draft: { mode: "create", ...knownProduct },
    });
    expect(detail).not.toBeNull();

    const base = productToForm();
    const form = mergeDraftIntoProductForm(base, detail!.draft);

    expect(form).toMatchObject({
      name: knownProduct.name,
      brand: knownProduct.brand,
      category: knownProduct.category,
      unit: knownProduct.unit,
      packSizeValue: knownProduct.packSizeValue,
      packSizeUnit: knownProduct.packSizeUnit,
      barcode: knownProduct.barcode,
      description: knownProduct.description,
      imageUrl: knownProduct.imageUrl,
      sellingPrice: 0,
      costPrice: 0,
      mrp: 0,
      gstRate: 0,
      stockQuantity: 0,
    });
    expect(form.aliasesText).toContain("पारले जी");
  });

  it("wires both scanner paths into lookup and passes the result to product creation", () => {
    const searchSource = readFileSync("src/features/core/billing/pages/components/BillingSearch.tsx", "utf8");
    const billingSource = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");

    expect(searchSource).toContain("lookupSharedProduct(outcome.code)");
    expect(searchSource).toContain("onCreateProductWithBarcode(code, knownProduct)");
    expect(searchSource).toContain('data-testid="barcode-knowledge-loading"');
    expect(billingSource).toContain("imageUrl: knownProduct.imageUrl ?? undefined");
    expect(billingSource).not.toContain("sellingPrice: knownProduct");
  });
});
