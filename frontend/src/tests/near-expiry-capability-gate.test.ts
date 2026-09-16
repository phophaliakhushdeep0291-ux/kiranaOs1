import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { packForBusinessType } from "@/features/verticals/registry";

/**
 * The dashboard must not ask a question its own trade cannot be allowed to ask.
 *
 * `/inventory-lots/expiry-alerts` is gated on BATCH_TRACKING by the server. The
 * dashboard rendered NearExpiryAlert for every trade regardless, so the seven
 * trades without that capability spent five to eight requests per dashboard load
 * being told 403. `retry: false` was already there and did not help: it stops a
 * failed query retrying, not the query from being issued on each mount and
 * refetch.
 *
 * The interesting failure mode is drift — the server tightening or renaming the
 * capability while the client keeps asking — so the capability is read out of the
 * route file rather than written down twice.
 */

const componentSource = readFileSync("src/features/core/inventory/components/NearExpiryAlert.tsx", "utf8");
const routeSource = readFileSync("../backend/src/modules/inventory-lots/inventoryLots.routes.js", "utf8");

/** The capability the server actually demands, read from its own router. */
function serverRequiredCapability(): string {
  const match = routeSource.match(/requireCapability\(\s*["']([A-Z_]+)["']\s*\)/);
    if (!match) throw new Error("inventoryLots.routes.js no longer calls requireCapability; update this test");
  return match[1];
}

describe("near-expiry alert capability gate", () => {
  it("asks only for the capability the server requires", () => {
    const required = serverRequiredCapability();
    expect(required).toBe("BATCH_TRACKING");
    // The component must gate on that same capability, not a hand-copied guess.
    expect(componentSource).toContain(`hasCapability("${required}")`);
  });

  it("disables the query rather than only suppressing its retries", () => {
    // `enabled` is the whole fix: retry:false still issued one request per mount.
    expect(componentSource).toMatch(/enabled:\s*tracksBatches/);
    expect(componentSource).toContain("useShopCapability");
  });

  it("renders nothing for a trade that cannot hold batches, even from cache", () => {
    // initialData reads a device cache that can outlive a change of trade.
    expect(componentSource).toMatch(/const data = tracksBatches \? query\.data : undefined/);
  });

  it("still serves every trade that does hold the capability", () => {
    const required = serverRequiredCapability() as "BATCH_TRACKING";
    const holders = (Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[])
      .filter((businessType) => packForBusinessType(businessType)?.capabilities?.includes(required));

    // Dated stock is not a pharmacy-only idea: a kirana store sells dairy and
    // atta, a kitchen holds perishables, a factory tracks batch genealogy.
    expect(holders).toEqual(expect.arrayContaining(["kirana", "pharmacy", "cosmetics", "restaurant", "manufacturing"]));

    // ...and the trades that sell nothing dated must not be asking at all.
    for (const businessType of ["clothing", "footwear", "auto_parts", "electronics", "stationery", "furniture", "other"] as BusinessType[]) {
      expect(packForBusinessType(businessType)?.capabilities ?? []).not.toContain(required);
    }
  });
});
