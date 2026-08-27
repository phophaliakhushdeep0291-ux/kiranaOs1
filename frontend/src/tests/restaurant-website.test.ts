import { describe, expect, it } from "vitest";
import { guestWebsiteRedirect, restaurantGuestUrl, restaurantWebsiteUrl, websiteFromPrefs } from "@/features/core/customer-order/restaurant-website";
import { buildTableOrderUrl } from "@/features/verticals/restaurant/service/table-qr";
import { BLANK_BRAND, readMenuBrand, toStoredBrand } from "@/features/verticals/restaurant/service/menu-branding";

const website = "https://dinein-production.up.railway.app/r/my-restaurant";
const catalog = { storefront: { mode: "dine_in", branding: { websiteUrl: website } } };

describe("per-shop restaurant website", () => {
  it("normalizes the configured menu address", () => {
    expect(restaurantWebsiteUrl(` ${website}/ `)).toBe(website);
  });
  it.each(["javascript:alert(1)", "http://example.com/r/cafe", "https://user:pass@example.com/r/cafe", "https://localhost/r/cafe", "https://127.0.0.1/r/cafe", "https://example.com/order/shop", "https://example.com/r/cafe?redirect=evil", "https://example.com/r/cafe#x", "https://example.com/r/cafe/t/t1", "//example.com/r/cafe"])("rejects unsafe or incorrect destinations: %s", value => {
    expect(restaurantWebsiteUrl(value)).toBeNull();
  });
  it("keeps the table code exactly, safely encoded", () => {
    expect(restaurantGuestUrl(website, "terrace 5/#")).toBe(`${website}/t/terrace%205%2F%23`);
    expect(restaurantGuestUrl(website)).toBe(website);
  });
  it("uses the dedicated site in newly printed table QR codes", () => {
    expect(buildTableOrderUrl({ shopId: "shop1", tableCode: "terrace-5", websiteUrl: website, currentOrigin: "https://pos.example.com" })).toBe(`${website}/t/terrace-5`);
  });
  it("keeps other shops on their existing POS frontend", () => {
    expect(buildTableOrderUrl({ shopId: "shop2", tableCode: "t2", currentOrigin: "https://pos.example.com" })).toBe("https://pos.example.com/t/shop2/t2");
    expect(websiteFromPrefs({})).toBeNull();
    expect(guestWebsiteRedirect({ storefront: { mode: "retail", branding: { websiteUrl: website } } }, "https://pos.example.com/order/shop2")).toBeNull();
  });
  it("redirects both old browse and table URLs without copying arbitrary query parameters", () => {
    expect(guestWebsiteRedirect(catalog, "https://pos.example.com/order/shop1?token=secret")).toBe(website);
    expect(guestWebsiteRedirect(catalog, "https://pos.example.com/t/shop1/t5", "t5")).toBe(`${website}/t/t5`);
  });
  it("prevents redirects back to the same frontend", () => {
    expect(guestWebsiteRedirect(catalog, "https://dinein-production.up.railway.app/order/shop1")).toBeNull();
  });
  it("persists and clears the owner setting without leaving an old redirect behind", () => {
    expect(toStoredBrand({ ...BLANK_BRAND, websiteUrl: website }).websiteUrl).toBe(website);
    expect(toStoredBrand({ ...BLANK_BRAND, websiteUrl: "" }).websiteUrl).toBe("");
    expect(readMenuBrand({ restaurant: { brand: { websiteUrl: website } } }).websiteUrl).toBe(website);
    expect(() => toStoredBrand({ ...BLANK_BRAND, websiteUrl: "https://example.com/order/shop1" })).toThrow();
  });
});
