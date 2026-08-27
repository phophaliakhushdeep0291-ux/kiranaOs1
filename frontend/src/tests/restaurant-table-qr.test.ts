import { describe, expect, it } from "vitest";
import type { MenuDish, Product } from "@/types/api";
import type { CartItem } from "@/features/core/billing/pages/billing-types";
import type { CustomerOrder } from "@/features/core/orders/api";
import {
  buildTableOrderUrl,
  describeTableQr,
  mergeServerCodes,
  tableCodeForName,
  tableOrderPath,
  tablesForPrinting,
  unpublishedTables,
} from "@/features/verticals/restaurant/service/table-qr";
import {
  guestOrderCartLines,
  mergeCartLines,
  pendingGuestOrders,
} from "@/features/verticals/restaurant/service/guest-orders";
import {
  BLANK_BRAND, guestOrdersEnabled, readMenuBrand, toStoredBrand,
} from "@/features/verticals/restaurant/service/menu-branding";
import { dineInTheme, isDarkSurface } from "@/features/core/customer-order/dine-in-theme";

/**
 * The QR on a table, and what happens to what a guest sends through it.
 *
 * What is pinned here is everything a printed sticker depends on: that the code
 * a till derives matches the one the server published, that an address a phone
 * cannot reach is caught BEFORE the glue dries, and that a guest's order lands
 * on one table's bill exactly once.
 */

describe("the code on the sticker", () => {
  it("derives the same code the server does", () => {
    // These pairs are the contract between two implementations. If they drift,
    // a till republishes the whole floor on every load — retiring and recreating
    // tables whose stickers are already on the wall.
    expect(tableCodeForName("T5")).toBe("t5");
    expect(tableCodeForName("Terrace 2")).toBe("terrace-2");
    expect(tableCodeForName("  AC Hall / 12  ")).toBe("ac-hall-12");
    expect(tableCodeForName("")).toBe("table");
  });

  it("keeps the till's own table ids while taking the server's codes", () => {
    const plan = [
      { id: "table-1", name: "T1", section: "Dining", seats: 4 },
      { id: "table-9", name: "Terrace 2", section: "Terrace", seats: 2 },
    ];
    const merged = mergeServerCodes(plan, [
      { code: "t1", name: "T1", selfOrderEnabled: true },
      { code: "terrace-2", name: "Terrace 2", selfOrderEnabled: false },
    ]);

    // The ids key the table -> open-order map: rewriting them would drop every
    // seating currently on the floor.
    expect(merged.map((table) => table.id)).toEqual(["table-1", "table-9"]);
    expect(merged[0].code).toBe("t1");
    expect(merged[1].selfOrderEnabled).toBe(false);
  });

  it("reports a table the server has never seen", () => {
    const merged = mergeServerCodes(
      [{ id: "table-1", name: "T1" }, { id: "table-2", name: "T2" }],
      [{ code: "t1", name: "T1", selfOrderEnabled: true }],
    );
    expect(unpublishedTables(merged).map((table) => table.name)).toEqual(["T2"]);
  });
});

describe("where the QR points", () => {
  const shopId = "shop_abc";

  it("carries the table in the path, so a guest never types where they are sitting", () => {
    expect(tableOrderPath(shopId, "t5")).toBe("/t/shop_abc/t5");
    expect(buildTableOrderUrl({ shopId, tableCode: "t5", currentOrigin: "https://shop.example.com" }))
      .toBe("https://shop.example.com/t/shop_abc/t5");
  });

  it("prefers the shop's published address over whatever the till is running on", () => {
    // The till may be on localhost, a LAN IP or a preview URL. What gets printed
    // must be the address the shop actually publishes.
    expect(buildTableOrderUrl({
      shopId,
      tableCode: "t5",
      configuredBaseUrl: "https://order.myrestaurant.in/",
      currentOrigin: "http://localhost:5173",
    })).toBe("https://order.myrestaurant.in/t/shop_abc/t5");
  });

  it("refuses to build a link without both a shop and a table", () => {
    expect(buildTableOrderUrl({ shopId: "", tableCode: "t5", currentOrigin: "https://x.com" })).toBe("");
    expect(buildTableOrderUrl({ shopId, tableCode: "", currentOrigin: "https://x.com" })).toBe("");
  });

  it("catches an address a guest's phone can never open, before it is printed", () => {
    // The whole failure mode this guards: a QR made on a till running at
    // localhost points the guest's phone at their OWN phone. It fails silently,
    // in their hands, with nothing on screen to explain it.
    const local = describeTableQr({ shopId, tableCode: "t5", currentOrigin: "http://localhost:5173" });
    expect(local.reach.reachable).toBe(false);

    const lan = describeTableQr({ shopId, tableCode: "t5", currentOrigin: "http://192.168.1.9:5173" });
    expect(lan.reach.reachable).toBe(false);

    const live = describeTableQr({ shopId, tableCode: "t5", currentOrigin: "https://shop.example.com" });
    expect(live.reach.reachable).toBe(true);
  });
});

describe("the printed sheet", () => {
  const floor = [
    { id: "3", name: "T10", section: "Dining", code: "t10", sortOrder: 9, active: true },
    { id: "1", name: "T2", section: "Dining", code: "t2", sortOrder: 1, active: true },
    { id: "4", name: "Terrace 1", section: "Terrace", code: "terrace-1", sortOrder: 0, active: true },
    { id: "5", name: "T7", section: "Dining", code: undefined, sortOrder: 6, active: true },
    { id: "6", name: "Old table", section: "Dining", code: "old", sortOrder: 2, active: false },
  ];

  it("prints by section then by the shop's own order", () => {
    // A sheet that runs T1, T10, T2 is a sheet somebody sorts by hand while the
    // glue dries.
    expect(tablesForPrinting(floor).map((table) => table.name)).toEqual(["T2", "T10", "Terrace 1"]);
  });

  it("leaves out tables that have no sticker to print", () => {
    const names = tablesForPrinting(floor).map((table) => table.name);
    // No code means the server has never seen it: a QR made here would resolve
    // to nothing on the guest's phone.
    expect(names).not.toContain("T7");
    expect(names).not.toContain("Old table");
  });
});

describe("what a guest sends", () => {
  const order = (overrides: Partial<CustomerOrder> = {}): CustomerOrder => ({
    id: "order_1",
    shopId: "shop_abc",
    locationId: null,
    customerName: "T5",
    customerMobile: "",
    customerAddress: null,
    note: null,
    items: [{ productId: "p1", name: "Masala Dosa", unit: "plate", price: 120, qty: 2 }],
    itemCount: 1,
    estimatedTotal: 240,
    fulfillmentType: "dine_in",
    tableId: "tbl_1",
    tableName: "T5",
    promisedSlot: null,
    sourceChannel: "customer_portal",
    externalOrderId: null,
    paymentStatus: "unpaid",
    fulfillmentStatus: "unfulfilled",
    status: "new",
    billId: null,
    acceptedAt: null,
    readyAt: null,
    fulfilledAt: null,
    rejectedAt: null,
    cancelledAt: null,
    createdAt: "2026-08-07T10:00:00.000Z",
    updatedAt: "2026-08-07T10:00:00.000Z",
    ...overrides,
  });

  it("waits to be taken, and only once", () => {
    const orders = [
      order({ id: "a" }),
      order({ id: "b", createdAt: "2026-08-07T09:00:00.000Z" }),
      order({ id: "c", status: "accepted" }),
      order({ id: "d", fulfillmentType: "delivery", tableId: null }),
    ];
    // Oldest first: the table that has been waiting longest is served first.
    expect(pendingGuestOrders(orders, []).map((row) => row.id)).toEqual(["b", "a"]);
    // Already added to a table's bill — offering it again would double the food.
    expect(pendingGuestOrders(orders, ["b"]).map((row) => row.id)).toEqual(["a"]);
  });

  it("preserves the server-priced order when the catalogue changes", () => {
    const products = [
      { id: "p1", name: "Masala Dosa", rateUnit: "plate", defaultPricePerRateUnit: 140 } as unknown as Product,
    ];
    const { lines, skipped } = guestOrderCartLines(order(), products);
    expect(skipped).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);
    // The server priced this order at 120 before the catalogue changed to 140.
    expect(lines[0].rate).toBe(120);
  });

  it("says which items it could not match rather than dropping them silently", () => {
    const { lines, skipped } = guestOrderCartLines(order(), []);
    expect(lines).toEqual([]);
    expect(skipped).toEqual(["Masala Dosa"]);
  });

  it("adds to a line the table already has instead of splitting it", () => {
    const naan = { id: "p2", name: "Naan" } as unknown as Product;
    const existing: CartItem[] = [{ product: naan, quantity: 2, rate: 45, unit: "piece" }];
    const incoming: CartItem[] = [{ product: naan, quantity: 2, rate: 45, unit: "piece" }];

    const merged = mergeCartLines(existing, incoming);
    // Beyond tidiness: the kitchen ticket counts what is outstanding per line, so
    // a split line would fire the same naan twice.
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(4);
  });

  it("keeps different packs of the same product apart", () => {
    const water = { id: "p3", name: "Water" } as unknown as Product;
    const merged = mergeCartLines(
      [{ product: water, quantity: 1, rate: 20, unit: "bottle", sellingUnit: { id: "su1" } as CartItem["sellingUnit"] }],
      [{ product: water, quantity: 1, rate: 60, unit: "bottle", sellingUnit: { id: "su2" } as CartItem["sellingUnit"] }],
    );
    expect(merged).toHaveLength(2);
  });

  it("keeps the server snapshot of a guest's portion and options", () => {
    const product = {
      id: "p1",
      name: "Masala Dosa",
      rateUnit: "plate",
      defaultPricePerRateUnit: 140,
      sellingUnits: [{ id: "half-id", unitCode: "portion-half", name: "Half", defaultPrice: 90, isActive: true }],
    } as unknown as Product;
    const configuredOrder = order({
      items: [{
        productId: "p1", name: "Masala Dosa (Half)", unit: "Half", price: 105, qty: 2,
        variation: { unitCode: "portion-half", name: "Half", price: 80 },
        addons: [{ optionId: "cheese", groupName: "Extras", name: "Old cheese", price: 25, quantity: 1 }],
      }],
    });
    const menu = [{
      id: "p1",
      addonGroups: [{ id: "extras", name: "Extras", minSelect: 0, maxSelect: 2, required: false, sortOrder: 0, isActive: true, options: [{ id: "cheese", name: "Cheese", price: 30, linkedProductId: null, linkedQtyBase: 1, sortOrder: 0, isActive: true }] }],
    }] as unknown as MenuDish[];
    const { lines } = guestOrderCartLines(configuredOrder, [product], menu);
    expect(lines[0].sellingUnit?.unitCode).toBe("portion-half");
    expect(lines[0].rate).toBe(80);
    expect(lines[0].addons).toEqual([{ optionId: "cheese", groupName: "Extras", name: "Old cheese", price: 25, quantity: 1 }]);
  });

  it("never merges two differently configured dishes", () => {
    const burger = { id: "burger", name: "Burger" } as unknown as Product;
    const base = { product: burger, quantity: 1, rate: 150, unit: "plate" };
    const merged = mergeCartLines(
      [{ ...base, addons: [{ optionId: "cheese", groupName: "Extras", name: "Cheese", price: 25 }] }],
      [{ ...base, addons: [{ optionId: "jalapeno", groupName: "Extras", name: "Jalapeño", price: 20 }] }],
    );
    expect(merged).toHaveLength(2);
  });
});

describe("one restaurant must not look like the next", () => {
  it("stores only what is worth storing", () => {
    // The settings blob has a hard 20 KB ceiling shared with the printer config
    // and everything else, so an empty string is not worth a key.
    expect(toStoredBrand(BLANK_BRAND)).toEqual({});
    expect(toStoredBrand({ ...BLANK_BRAND, displayName: "  Kaapi & Co  ", theme: "emerald" }))
      .toEqual({ displayName: "Kaapi & Co", theme: "emerald" });
  });

  it("refuses a logo the guest's browser should not be asked to fetch", () => {
    expect(toStoredBrand({ ...BLANK_BRAND, logoUrl: "javascript:alert(1)" }).logoUrl).toBeUndefined();
    expect(toStoredBrand({ ...BLANK_BRAND, logoUrl: "https://cdn.example.com/logo.png" }).logoUrl)
      .toBe("https://cdn.example.com/logo.png");
  });

  it("reads back a brand that was never set without inventing one", () => {
    expect(readMenuBrand(undefined)).toEqual(BLANK_BRAND);
    expect(readMenuBrand({ restaurant: { brand: { theme: "not-a-theme" } } }).theme).toBe("classic");
  });

  it("treats guest ordering as on unless it was turned off", () => {
    expect(guestOrdersEnabled(undefined)).toBe(true);
    expect(guestOrdersEnabled({ restaurant: { dineIn: { guestOrders: false } } })).toBe(false);
    expect(guestOrdersEnabled({ restaurant: { dineIn: {} } })).toBe(true);
  });
});

describe("the theme a scanned menu renders in", () => {
  it("judges brightness the way an eye does, not by averaging channels", () => {
    // Green reads far brighter than blue at the same numeric value. Averaging
    // would call a deep green surface "light" and put dark grey text on it.
    expect(isDarkSurface("#0f172a")).toBe(true);
    expect(isDarkSurface("#fffaf3")).toBe(false);
    expect(isDarkSurface("#052e16")).toBe(true);
    expect(isDarkSurface("not-a-colour")).toBe(false);
  });

  it("derives a whole page from the restaurant's two colours", () => {
    const light = dineInTheme({
      displayName: "X", tagline: null, themeKey: "classic",
      accent: "#b45309", surface: "#fffaf3", ink: "#1c1917", logoUrl: null, footerNote: null,
    });
    expect(light.dark).toBe(false);
    expect(light.style["--menu-accent"]).toBe("#b45309");
    // A card has to lift off the surface in both directions.
    expect(light.style["--menu-card"]).toBe("#ffffff");

    const dark = dineInTheme({
      displayName: "X", tagline: null, themeKey: "midnight",
      accent: "#818cf8", surface: "#0f172a", ink: "#e2e8f0", logoUrl: null, footerNote: null,
    });
    expect(dark.dark).toBe(true);
    expect(dark.style["--menu-card"]).not.toBe("#ffffff");
  });

  it("still themes a page for a shop that sent no branding at all", () => {
    const theme = dineInTheme(null);
    expect(theme.style["--menu-accent"]).toBeTruthy();
    expect(theme.style["--menu-surface"]).toBeTruthy();
  });
});
