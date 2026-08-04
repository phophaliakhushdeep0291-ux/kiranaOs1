import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveBusinessType } from "@/features/core/settings/business-types";
import { isPathInBusinessProfile } from "@/features/core/settings/business-profile-bootstrap";
import { isPathEnabled, setModulePathGate } from "@/features/core/settings/modules";
import { isVerticalPathActive } from "@/features/verticals/registry";

/**
 * The general store, walked end to end.
 *
 * Kirana is the trade the product was built for and the default a new shop
 * lands on, so its screens are the ones that must never be unreachable. Three
 * independent gates decide that — the vertical gate, the owner's module
 * switches, and the server's business profile — and a screen is only actually
 * usable when all three agree. Checking them together is the point: each one
 * passed on its own while /products stayed walled off behind the third.
 *
 * The navigation list mirrors backend/src/verticals/kirana/navigation.js plus
 * the shared spine that `defineBusinessProfile` composes onto every profile.
 */
const KIRANA_NAVIGATION = [
  // Trade entries — backend/src/verticals/kirana/navigation.js
  "billing", "products", "inventory", "udhar", "daily-closing",
  // Shared spine — composed on by defineBusinessProfile
  "dashboard", "customers", "purchases", "suppliers", "sales", "returns",
  "reports", "cash-payments", "expenses", "staff", "settings",
];

/** Every href the phone offers, read from the drawer and tab bar themselves. */
function mobileNavHrefs() {
  const source = readFileSync("src/components/layout/MobileAppChrome.tsx", "utf8");
  return [...new Set([...source.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]))];
}

describe("general store (kirana) reachability", () => {
  beforeAll(() => {
    setModulePathGate(isVerticalPathActive);
    saveBusinessType("kirana");
  });
  afterAll(() => {
    setModulePathGate(() => true);
    saveBusinessType("kirana");
  });

  it("opens every screen the phone offers a general store", () => {
    const blocked = mobileNavHrefs().filter(
      (href) => !isPathEnabled(href) || !isPathInBusinessProfile(href, KIRANA_NAVIGATION),
    );

    // A row in the drawer that leads to "Not part of this business profile" is
    // worse than no row at all, so the two gates have to agree with the menu.
    expect(blocked).toEqual([]);
  });

  it("covers the capabilities a general store actually trades on", () => {
    // Loose weighing, pack conversion and udhar are the kirana counter; each
    // needs its screen reachable, not merely its capability flag set.
    for (const path of ["/billing", "/products", "/inventory", "/customers", "/daily-closing", "/money-statement"]) {
      expect(isPathEnabled(path), `${path} unreachable`).toBe(true);
      expect(isPathInBusinessProfile(path, KIRANA_NAVIGATION), `${path} not in profile`).toBe(true);
    }
  });

  it("still keeps another trade's screens out", () => {
    // Reachability must not have been bought by opening the gates for everyone.
    expect(isPathEnabled("/rentals")).toBe(false);
    expect(isPathInBusinessProfile("/rentals", KIRANA_NAVIGATION)).toBe(false);
  });
});
