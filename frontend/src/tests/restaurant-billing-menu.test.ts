import { beforeEach, describe, expect, it, vi } from "vitest";
import { productInventoryBadge } from "@/features/core/billing/pages/billing-calculations";
import { productTracksStock } from "@/features/core/inventory/stock-display";
import { formToInput, productToForm } from "@/features/core/products/pages/product-form-state";
import { getShopBillingProfile } from "@/features/core/settings/shop-billing";
import { loadRestaurantAddonGroups } from "@/features/verticals/restaurant/billing-addon-configurator";
import type { MenuAddonGroup, Product } from "@/types/api";

const mocks = vi.hoisted(() => ({ getMenuBoard: vi.fn() }));
vi.mock("@/features/verticals/restaurant/service/restaurant-api", () => ({ getMenuBoard: mocks.getMenuBoard }));

const product = (patch: Partial<Product> = {}) => ({ id: "dish", name: "Dal Fry", stockBaseQty: 0, ...patch }) as Product;
const groups = (price: number) => [{ id: "extras", name: "Extras", options: [{ id: "cheese", name: "Cheese", price }] }] as MenuAddonGroup[];
const board = (addonGroups: MenuAddonGroup[]) => ({ courses: [{ course: "Main course", dishes: [{ id: "dish", addonGroups }] }] });

describe("restaurant billing stock badges", () => {
  it("does not call cooked-to-order dishes out or low from finished-product counts", () => {
    const profile = getShopBillingProfile("restaurant");
    for (const stockBaseQty of [-3, 0, 2, 20]) {
      expect(productInventoryBadge(product({ stockBaseQty }), profile.showInventoryBadges)).toBeNull();
    }
  });

  it("treats the saved restaurant role as authoritative over stale stock flags", () => {
    expect(productTracksStock(product({ restaurantItemType: "prepared", stockTrackingEnabled: true, trackStock: true }))).toBe(false);
    expect(productTracksStock(product({ restaurantItemType: "packaged", stockTrackingEnabled: true }))).toBe(true);
    expect(productTracksStock(product({ restaurantItemType: "ingredient", trackStock: true }))).toBe(true);
  });

  it("clears legacy stock controls when a product becomes a prepared dish", () => {
    const values = {
      ...productToForm(product({
        restaurantItemType: "prepared",
        sellingPrice: 180,
        stockBaseQty: 24,
        stockQuantity: 24,
        stockTrackingEnabled: true,
      })),
      sellingPrice: 180,
      stockQuantity: 24,
      lowStockAlert: 5,
      reorderLevel: 8,
      batchTrackingEnabled: true,
      packagingMode: "per_pack" as const,
      sellingUnits: [{
        name: "Plate",
        unitType: "piece",
        unitCode: "piece",
        conversionToBase: 1,
        defaultPrice: 180,
        onHandQty: 24,
        lowStockThreshold: 5,
        reorderLevel: 8,
        isDefault: true,
        isActive: true,
      }],
    };
    const payload = formToInput(values);

    expect(payload.restaurantItemType).toBe("prepared");
    expect(payload.stockTrackingEnabled).toBe(false);
    expect(payload.stockBaseQty).toBe(0);
    expect(payload.stockQuantity).toBe(0);
    expect(payload.packagingMode).toBe("pooled");
    expect(payload.reorderLevel).toBe(0);
    expect(payload.lowStockThreshold).toBe(0);
    expect(payload.batchTrackingEnabled).toBe(false);
    expect(payload.sellingUnits?.[0]?.onHandQty).toBeUndefined();
    expect(payload.sellingUnits?.[0]?.lowStockThreshold).toBeUndefined();
    expect(payload.sellingUnits?.[0]?.reorderLevel).toBeUndefined();
  });

  it("retains inventory badges for retail and honours stock tracking", () => {
    const profile = getShopBillingProfile("kirana");
    expect(productInventoryBadge(product(), profile.showInventoryBadges)).toBe("out");
    expect(productInventoryBadge(product({ stockBaseQty: 3 }), profile.showInventoryBadges)).toBe("low");
    expect(productInventoryBadge(product({ stockBaseQty: 12 }))).toBeNull();
    expect(productInventoryBadge(product({ stockTrackingEnabled: false }))).toBeNull();
    expect(productInventoryBadge(product({ trackStock: false }))).toBeNull();
    expect(productInventoryBadge(product({ stockBaseQty: Number.NaN }))).toBeNull();
    expect(productInventoryBadge(product({ stockBaseQty: undefined, stockQuantity: 12 }))).toBeNull();
  });
});

describe("restaurant add-on loading", () => {
  beforeEach(() => mocks.getMenuBoard.mockReset());

  it("reads changed options and prices on the next selection", async () => {
    mocks.getMenuBoard.mockResolvedValueOnce(board(groups(20))).mockResolvedValueOnce(board(groups(35)));
    expect(await loadRestaurantAddonGroups("dish")).toEqual(groups(20));
    expect(await loadRestaurantAddonGroups("dish")).toEqual(groups(35));
    expect(mocks.getMenuBoard).toHaveBeenCalledTimes(2);
  });

  it("recovers on retry instead of keeping a rejected promise for the whole session", async () => {
    mocks.getMenuBoard.mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValueOnce(board(groups(20)));
    await expect(loadRestaurantAddonGroups("dish")).rejects.toThrow("Connection interrupted");
    await expect(loadRestaurantAddonGroups("dish")).resolves.toEqual(groups(20));
  });

  it("does not reuse the previous shop's choices when the scoped menu changes", async () => {
    mocks.getMenuBoard.mockResolvedValueOnce(board(groups(20))).mockResolvedValueOnce({ courses: [] });
    expect(await loadRestaurantAddonGroups("dish")).toEqual(groups(20));
    expect(await loadRestaurantAddonGroups("dish")).toBeNull();
  });

  it("clears removed options and skips dishes without add-ons", async () => {
    mocks.getMenuBoard.mockResolvedValueOnce(board(groups(20))).mockResolvedValueOnce(board([]));
    expect(await loadRestaurantAddonGroups("dish")).toEqual(groups(20));
    expect(await loadRestaurantAddonGroups("dish")).toBeNull();
    mocks.getMenuBoard.mockResolvedValue(board([]));
    expect(await loadRestaurantAddonGroups("unknown")).toBeNull();
  });
});
