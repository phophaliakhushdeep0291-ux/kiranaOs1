import { describe, expect, it } from "vitest";
import { activeCategoryNames, mergeCategories, type ShopCategory } from "@/features/core/inventory/category-store";

function category(overrides: Partial<ShopCategory> = {}): ShopCategory {
  return {
    id: "cat_1",
    name: "Beverages",
    parentId: null,
    status: "active",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("category cross-device merge", () => {
  it("keeps unrelated categories from both local and cloud lists", () => {
    const merged = mergeCategories([category()], [category({ id: "cat_2", name: "Snacks" })]);
    expect(merged.map((row) => row.id).sort()).toEqual(["cat_1", "cat_2"]);
  });

  it("uses the newest record for the same category", () => {
    const merged = mergeCategories(
      [category({ name: "Cold Drinks", updatedAt: "2026-07-02T00:00:00.000Z" })],
      [category({ name: "Beverages", updatedAt: "2026-07-01T00:00:00.000Z" })],
    );
    expect(merged[0].name).toBe("Cold Drinks");
  });

  it("retains a newer deletion tombstone so another device cannot resurrect it", () => {
    const deletedAt = "2026-07-03T00:00:00.000Z";
    const merged = mergeCategories(
      [category({ deletedAt, updatedAt: deletedAt })],
      [category({ updatedAt: "2026-07-02T00:00:00.000Z" })],
    );
    expect(merged[0].deletedAt).toBe(deletedAt);
  });

  it("offers only active, non-deleted custom categories to a new product", () => {
    expect(activeCategoryNames([
      category({ name: "Cold Drinks" }),
      category({ id: "cat_2", name: "cold drinks" }),
      category({ id: "cat_3", name: "Retired", status: "inactive" }),
      category({ id: "cat_4", name: "Deleted", deletedAt: "2026-07-03T00:00:00.000Z" }),
    ])).toEqual(["Cold Drinks"]);
  });
});
