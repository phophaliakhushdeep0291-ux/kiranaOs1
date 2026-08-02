import { describe, it, expect } from "vitest";
import {
  matchSearchSuggestions,
  orderByUsage,
  preferredFilterFor,
  suggestNextProducts,
  trendingProductIds,
  usageScores,
} from "@/lib/activity/personalize";
import type { Personalization } from "@/lib/activity/api";

// These rules decide what a shopkeeper sees during a sale, so the property that
// matters most is the one asserted throughout: with no history, nothing moves.

function personalization(overrides: Partial<Personalization> = {}): Personalization {
  return {
    generatedAt: new Date().toISOString(),
    quickProducts: [],
    searchSuggestions: [],
    frequentCustomers: [],
    preferredPaymentMethod: null,
    paymentMethods: [],
    preferredFilters: {},
    dashboardOrder: [],
    productCombos: {},
    predictedProducts: { hour: 9, sufficientData: false, products: [] },
    onlineTrending: [],
    onlineCartTrending: [],
    abandonedCarts: [],
    ...overrides,
  };
}

describe("orderByUsage", () => {
  const actions = [{ href: "/a" }, { href: "/b" }, { href: "/c" }];

  it("leaves order untouched when there is no history", () => {
    expect(orderByUsage(actions, (a) => a.href, new Map())).toEqual(actions);
  });

  it("puts the most-used first", () => {
    const ordered = orderByUsage(actions, (a) => a.href, new Map([["/c", 9], ["/a", 3]]));
    expect(ordered.map((a) => a.href)).toEqual(["/c", "/a", "/b"]);
  });

  it("keeps unknown items in their original relative order, at the end", () => {
    const four = [{ href: "/a" }, { href: "/b" }, { href: "/c" }, { href: "/d" }];
    const ordered = orderByUsage(four, (a) => a.href, new Map([["/d", 5]]));
    expect(ordered.map((a) => a.href)).toEqual(["/d", "/a", "/b", "/c"]);
  });

  it("does not mutate the input", () => {
    const input = [...actions];
    orderByUsage(input, (a) => a.href, new Map([["/c", 1]]));
    expect(input.map((a) => a.href)).toEqual(["/a", "/b", "/c"]);
  });

  it("reads scores straight off the personalization payload", () => {
    const scores = usageScores([{ key: "/billing", score: 4 }, { key: "/reports", score: 1 }]);
    expect(scores.get("/billing")).toBe(4);
    expect(usageScores(undefined).size).toBe(0);
  });
});

describe("suggestNextProducts", () => {
  it("suggests nothing without personalization", () => {
    expect(suggestNextProducts(undefined, [])).toEqual({ reason: null, productIds: [] });
  });

  it("offers the time-of-day prediction for an empty cart", () => {
    const data = personalization({
      predictedProducts: { hour: 7, sufficientData: true, products: [{ productId: "milk", label: "Milk", count: 9 }] },
    });
    expect(suggestNextProducts(data, [])).toEqual({ reason: "predicted", productIds: ["milk"] });
  });

  it("stays silent when the prediction has too little history behind it", () => {
    const data = personalization({
      predictedProducts: { hour: 7, sufficientData: false, products: [{ productId: "milk", label: "Milk", count: 1 }] },
    });
    expect(suggestNextProducts(data, []).reason).toBeNull();
  });

  it("switches to basket pairs once the cart has something in it", () => {
    const data = personalization({
      productCombos: { milk: [{ productId: "bread", count: 8, score: 8 }] },
    });
    expect(suggestNextProducts(data, ["milk"])).toEqual({ reason: "combo", productIds: ["bread"] });
  });

  it("never suggests what is already in the cart", () => {
    const data = personalization({
      productCombos: {
        milk: [{ productId: "bread", count: 8, score: 8 }, { productId: "eggs", count: 5, score: 5 }],
        bread: [{ productId: "milk", count: 8, score: 8 }],
      },
    });
    expect(suggestNextProducts(data, ["milk", "bread"]).productIds).toEqual(["eggs"]);
  });

  it("adds up pair scores across the whole cart", () => {
    const data = personalization({
      productCombos: {
        milk: [{ productId: "jam", count: 2, score: 2 }, { productId: "eggs", count: 3, score: 3 }],
        bread: [{ productId: "jam", count: 4, score: 4 }],
      },
    });
    // jam scores 2 + 4 across both lines and so beats eggs' single 3.
    expect(suggestNextProducts(data, ["milk", "bread"]).productIds[0]).toBe("jam");
  });
});

describe("matchSearchSuggestions", () => {
  const data = personalization({
    searchSuggestions: [
      { query: "maggi", count: 9, score: 9 },
      { query: "milk", count: 5, score: 5 },
      { query: "matchbox", count: 2, score: 2 },
    ],
  });

  it("returns the most frequent searches for an empty box", () => {
    expect(matchSearchSuggestions(data, "")).toEqual(["maggi", "milk", "matchbox"]);
  });

  it("narrows to what matches as the user types", () => {
    expect(matchSearchSuggestions(data, "ma")).toEqual(["maggi", "matchbox"]);
  });

  it("never offers back exactly what is already typed", () => {
    expect(matchSearchSuggestions(data, "maggi")).toEqual([]);
  });

  it("returns nothing without personalization", () => {
    expect(matchSearchSuggestions(undefined, "ma")).toEqual([]);
  });
});

describe("trendingProductIds", () => {
  it("caps the marker to the top few, so it stays meaningful", () => {
    const data = personalization({
      onlineTrending: Array.from({ length: 9 }, (_, i) => ({
        key: `p${i}`, label: `P${i}`, count: 9 - i, score: 9 - i, lastSeenAt: "2026-08-02T00:00:00.000Z",
      })),
    });
    const ids = trendingProductIds(data);
    expect(ids.size).toBe(5);
    expect(ids.has("p0")).toBe(true);
    expect(ids.has("p8")).toBe(false);
  });

  it("is empty without personalization", () => {
    expect(trendingProductIds(undefined).size).toBe(0);
  });
});

describe("preferredFilterFor", () => {
  it("returns the top filter for that screen only", () => {
    const data = personalization({
      preferredFilters: {
        "/billing": [{ filter: "dairy", count: 7, score: 7 }, { filter: "snacks", count: 3, score: 3 }],
        "/products": [{ filter: "grocery", count: 9, score: 9 }],
      },
    });
    expect(preferredFilterFor(data, "/billing")).toBe("dairy");
    expect(preferredFilterFor(data, "/inventory")).toBeNull();
  });

  it("returns null without personalization, so the screen keeps its default", () => {
    expect(preferredFilterFor(undefined, "/billing")).toBeNull();
  });
});
