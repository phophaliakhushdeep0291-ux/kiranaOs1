import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { productUpdateNeedsOwnerApproval } from "@/features/core/products/pages/product-form-state";
import type { Product, ProductInput } from "@/lib/api/client";

/**
 * The owner-PIN field list exists three times: twice on the server (the online PATCH route
 * and the offline sync handler) and once on the client, in a different language, so nothing
 * makes them agree by construction. They drifted, and the failure is silent in the worst
 * way: every product write is local-first, so an edit the client thinks is unprotected saves
 * happily, queues with `ownerPin: undefined`, and is then rejected by applyUpdateProduct
 * with 403. classifySyncError marks 403 non-retryable, so it is not a retry away from
 * working — the outbox item is stranded permanently and Retry can never clear it.
 *
 * Four retail/wholesale price fields and `status` were missing from the client list. Because
 * the form emits all five on every save — and defaults retail/wholesale to the selling price
 * when the product has none — renaming a product was enough to strand it.
 */

const routesSource = readFileSync("../backend/src/modules/products/products.routes.js", "utf8");
const syncSource = readFileSync("../backend/src/modules/sync/sync.service.js", "utf8");
const clientSource = readFileSync("src/features/core/products/pages/product-form-state.ts", "utf8");

/** Field names out of the first `[...]` literal following `anchor`. */
function fieldsAfter(source: string, anchor: string): string[] {
  const start = source.indexOf(anchor);
  expect(start, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  return [...source.slice(open, close).matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
}

const routeFields = fieldsAfter(routesSource, "const protectedProductFields = ");
const syncFields = fieldsAfter(syncSource, "const protectedProductFields = ");
const clientFields = fieldsAfter(clientSource, "const OWNER_APPROVAL_PRODUCT_FIELDS = ");

/**
 * A changed pair per protected field. Driven by the server list at runtime, so a field added
 * on the server with no entry here fails rather than quietly going unprompted on the client.
 */
const CHANGED_VALUES: Record<string, [unknown, unknown]> = {
  stockBaseQty: [5000, 5001],
  defaultPricePerRateUnit: [45, 46],
  retailPricePerRateUnit: [45, 48],
  retailFromQuantity: [1, 2],
  wholesalePricePerRateUnit: [45, 42],
  wholesaleFromQuantity: [10, 12],
  costPerRateUnit: [30, 31],
  minPricePerRateUnit: [40, 41],
  gstRate: [5, 12],
  hsn: ["1701", "1702"],
  mrp: [50, 55],
  barcode: ["8901030", "8901031"],
  sku: ["SUGAR-1KG", "SUGAR-2KG"],
  sellingUnits: [[], [{ unitCode: "pkt", unitType: "pack", name: "Packet", conversionToBase: 1000, defaultPrice: 45 }]],
  variantAxes: [[], [{ name: "Size", values: ["S", "M"] }]],
  packagingMode: ["pooled", "per_pack"],
  batchTrackingEnabled: [false, true],
  drugSchedule: [null, "H"],
  restaurantItemType: ["packaged", "prepared"],
  isActive: [true, false],
  status: ["active", "inactive"],
};

const BASE = {
  name: "Sugar",
  stockBaseQty: 5000,
  defaultPricePerRateUnit: 45,
  retailPricePerRateUnit: 45,
  retailFromQuantity: 1,
  wholesalePricePerRateUnit: 45,
  wholesaleFromQuantity: 10,
  costPerRateUnit: 30,
  minPricePerRateUnit: 40,
  gstRate: 5,
  hsn: "1701",
  mrp: 50,
  barcode: "8901030",
  sku: "SUGAR-1KG",
  sellingUnits: [],
  variantAxes: [],
  packagingMode: "pooled",
  batchTrackingEnabled: false,
  drugSchedule: null,
  restaurantItemType: "packaged",
  isActive: true,
  status: "active",
};

const existing = BASE as unknown as Product;
const unchanged = { ...BASE } as unknown as ProductInput;

describe("product owner-approval parity with the server", () => {
  it("keeps both server copies of protectedProductFields identical", () => {
    expect(routeFields.length).toBeGreaterThan(0);
    expect(syncFields).toEqual(routeFields);
  });

  it("prompts for the owner PIN on every field the server protects", () => {
    expect(clientFields.length).toBeGreaterThan(0);
    const missing = syncFields.filter((field) => !clientFields.includes(field));
    expect(missing, `server-protected fields with no client PIN prompt: ${missing.join(", ")}`).toEqual([]);
  });

  it("treats an unchanged product as needing no approval", () => {
    expect(productUpdateNeedsOwnerApproval(existing, unchanged)).toBe(false);
    expect(productUpdateNeedsOwnerApproval(existing, { ...unchanged, name: "Renamed Sugar" } as ProductInput)).toBe(false);
  });

  it.each(syncFields)(
    "detects a change to %s on its own",
    (field) => {
      const pair = CHANGED_VALUES[field];
      expect(pair, `no fixture for newly protected server field "${field}" — add one and check the client list covers it`).toBeDefined();
      const [before, after] = pair;
      const from = { ...BASE, [field]: before } as unknown as Product;
      const to = { ...BASE, [field]: after } as unknown as ProductInput;
      expect(productUpdateNeedsOwnerApproval(from, to)).toBe(true);
    },
  );

  it("detects the retail and wholesale price edits that were stranding sync", () => {
    // The exact shape of the stuck UPDATE_PRODUCT: only a retail or wholesale price moved,
    // every field the old client list knew about held still.
    expect(productUpdateNeedsOwnerApproval(existing, { ...unchanged, retailPricePerRateUnit: 48 } as ProductInput)).toBe(true);
    expect(productUpdateNeedsOwnerApproval(existing, { ...unchanged, wholesalePricePerRateUnit: 42 } as ProductInput)).toBe(true);
  });

  it("treats a product with no stored retail price as a protected change once the form fills it in", () => {
    // The form defaults retail/wholesale to the selling price, so opening an untouched
    // product and saving writes null -> 45 on a protected field.
    const neverPriced = { ...BASE, retailPricePerRateUnit: undefined, wholesalePricePerRateUnit: undefined } as unknown as Product;
    const afterFormFill = { ...BASE, retailPricePerRateUnit: 45, wholesalePricePerRateUnit: 45 } as unknown as ProductInput;
    expect(productUpdateNeedsOwnerApproval(neverPriced, afterFormFill)).toBe(true);
  });
});
