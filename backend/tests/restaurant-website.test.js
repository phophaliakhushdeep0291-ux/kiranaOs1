import { test } from "node:test";
import assert from "node:assert/strict";
import { restaurantWebsiteUrl } from "../src/verticals/restaurant/storefront/restaurant-website.js";

test("validates only public HTTPS restaurant menu addresses", () => {
  assert.equal(restaurantWebsiteUrl(" https://dinein-production.up.railway.app/r/my-restaurant/ "), "https://dinein-production.up.railway.app/r/my-restaurant");
  for (const value of [null, "", "javascript:alert(1)", "http://example.com/r/cafe", "https://user:pass@example.com/r/cafe", "https://localhost/r/cafe", "https://127.0.0.1/r/cafe", "https://example.com/order/shop", "https://example.com/r/cafe?next=bad", "https://example.com/r/cafe#x"]) {
    assert.equal(restaurantWebsiteUrl(value), null, String(value));
  }
});
