import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");
const palette = readFileSync("src/components/layout/CommandPalette.tsx", "utf8");
const voiceActions = readFileSync("src/features/voice/voice-actions.ts", "utf8");
const productsPage = readFileSync("src/features/products/pages/ProductsPage.tsx", "utf8");
const billsPage = readFileSync("src/features/bills/pages/BillsPage.tsx", "utf8");
const customersPage = readFileSync("src/features/customers/pages/CustomersPage.tsx", "utf8");

describe("command palette and voice page bridge", () => {
  it("wires header search to an offline-first command palette", () => {
    expect(layout).toContain("setPaletteOpen(true)");
    expect(layout).toContain("<CommandPalette open={paletteOpen}");
    expect(palette).toContain("offlineDB.getAll<AnyRow>(\"products\")");
    expect(palette).toContain("offlineDB.getAll<AnyRow>(\"customers\")");
    expect(palette).toContain("offlineDB.getAll<AnyRow>(\"bills\")");
    expect(palette).toContain("readInstantCache<AnyRow[]>");
    expect(palette).toContain("ArrowDown");
    expect(palette).toContain("ArrowUp");
    expect(palette).toContain("Enter");
  });

  it("keeps voice search and payment draft events connected to destination pages", () => {
    expect(voiceActions).toContain("kirana:voice-product-search");
    expect(voiceActions).toContain("kirana:voice-customer-search");
    expect(voiceActions).toContain("kirana:voice-bill-search");
    expect(voiceActions).toContain("kirana:voice-udhar-search");
    expect(voiceActions).toContain("kirana:voice-payment-draft");

    expect(productsPage).toContain("window.addEventListener(\"kirana:voice-product-search\"");
    expect(billsPage).toContain("window.addEventListener(\"kirana:voice-bill-search\"");
    expect(customersPage).toContain("window.addEventListener(\"kirana:voice-customer-search\"");
    // /udhar was retired; its voice handlers moved to the Customers/Udhar page.
    expect(customersPage).toContain("window.addEventListener(\"kirana:voice-udhar-search\"");
    expect(customersPage).toContain("window.addEventListener(\"kirana:voice-payment-draft\"");
  });
});
