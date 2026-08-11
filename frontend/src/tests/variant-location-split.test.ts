import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * "Where these are" — the per-branch split under the size grid.
 *
 * The grid says the shop owns four L-Blue shirts. This says one is on the counter
 * and three are at the second branch, which is the difference between promising a
 * customer a size and actually having it in the room.
 */

const component = readFileSync("src/features/core/products/pages/components/VariantLocationSplit.tsx", "utf8");
const form = readFileSync("src/features/core/products/pages/components/ProductFormPanel.tsx", "utf8");
const service = readFileSync("../backend/src/modules/products/products.service.js", "utf8");
const routes = readFileSync("../backend/src/modules/products/products.routes.js", "utf8");

describe("the split is read-only", () => {
  it("offers no way to type a new quantity", () => {
    // Stock moves through sales, purchases and transfers, each of which writes a
    // ledger row. An editable box here would be a fourth way to move stock that
    // nothing explains afterwards.
    expect(component).not.toMatch(/<[Ii]nput/);
    expect(component).not.toMatch(/useMutation|onSubmit|form\.setValue/);
  });

  it("reads through the products API rather than reaching for the table itself", () => {
    expect(component).toContain("getVariantStockByLocation");
  });
});

describe("what it refuses to render", () => {
  it("says nothing while loading, on error, or with no data", () => {
    expect(component).toContain("if (isLoading || isError || !data || data.locations.length === 0) return null;");
  });

  it("says nothing for a one-branch shop", () => {
    // A single-location shop already knows where everything is — the grid said so.
    expect(component).toContain("if (data.locations.length < 2) return null;");
  });

  it("is only mounted for a saved product that already has a grid", () => {
    // A product being created has no stock anywhere yet, and the split is read from
    // the server, not from the unsaved form.
    expect(form).toContain("showVariantGrid && !isLoose && editing?.id && hasVariantGrid");
    expect(form).toContain("<VariantLocationSplit productId={editing.id} />");
  });
});

describe("the server keeps one number authoritative", () => {
  it("derives the primary location's share instead of storing it", () => {
    // The primary location holds no LocationStock row, exactly as base units work.
    // Storing it too would give two numbers that can disagree.
    expect(service).toMatch(/location\.isPrimary\s*\?\s*round2\(Number\(unit\.onHandQty \?\? 0\) - \(heldTotal\.get\(unit\.id\) \?\? 0\)\)/);
  });

  it("counts only rows that sit on an axis", () => {
    // An "8-pack" is packaging, not a size, and has no place in a size grid.
    expect(service).toContain("product.sellingUnits.filter((unit) => unit.variantValue1 || unit.variantValue2)");
  });

  it("reads every location in one query rather than one per cell", () => {
    // A 6 x 6 grid across four branches is 144 answers; asking one at a time would
    // make opening a product a hundred-query page load.
    expect(service).toContain("db.locationStock.findMany({");
    expect(service).not.toMatch(/for \(const location of locations\)[\s\S]{0,200}await/);
  });

  it("is exposed read-only, and not gated behind multi-store", () => {
    // A single-shop shop still gets a straight answer instead of a feature error.
    expect(routes).toContain('router.get("/:id/variant-stock", requireLocationAccess("view"), ctrl.variantStockByLocation);');
    expect(routes).not.toMatch(/variant-stock[^\n]*requireFeature/);
  });
});
