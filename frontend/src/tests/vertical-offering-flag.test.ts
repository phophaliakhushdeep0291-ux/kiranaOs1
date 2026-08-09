import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_IDS, offeredBusinessTypes } from "@/features/core/settings/business-types";
import { packForBusinessType } from "@/features/verticals/registry";

describe("vertical offering surface", () => {
  it("offers every registered trade, with no build flag standing between a shop and its own type", () => {
    expect(offeredBusinessTypes()).toEqual([...BUSINESS_TYPE_IDS]);
    for (const businessType of BUSINESS_TYPE_IDS) {
      expect(offeredBusinessTypes()).toContain(businessType);
    }
  });

  it("resolves an existing restaurant shop", () => {
    const restaurant = packForBusinessType("restaurant");
    expect(restaurant.routes.map((route) => route.path)).toContain("/tables");
    expect(restaurant.nav.map((entry) => entry.href)).toContain("/kitchen");
    expect(restaurant.capabilities).toContain("KOT");
    expect(restaurant.capabilities).toContain("TABLE_MANAGEMENT");
  });
});
