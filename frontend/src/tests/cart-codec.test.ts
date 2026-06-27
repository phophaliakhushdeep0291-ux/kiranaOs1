import { describe, it, expect } from "vitest";
import {
  encodeCart,
  decodeCart,
  buildOrderDeepLink,
  parseOrderFromHash,
  CartDecodeError,
  type CartPayload,
} from "@/lib/qr/cart-codec";

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("cart codec", () => {
  it("round-trips a typical cart", () => {
    const payload: CartPayload = {
      shopCode: "ramesh-kirana",
      items: [
        { productId: "ckp1abc23def45", qty: 2 },
        { productId: "ckp9zzz88yyy77", qty: 1 },
      ],
    };
    const decoded = decodeCart(encodeCart(payload));
    expect(decoded).toEqual(payload);
  });

  it("preserves fractional quantities (display units like 0.5 kg)", () => {
    const decoded = decodeCart(encodeCart({ shopCode: "s1", items: [{ productId: "p1", qty: 0.5 }] }));
    expect(decoded.items[0].qty).toBe(0.5);
  });

  it("round-trips an empty cart", () => {
    const decoded = decodeCart(encodeCart({ shopCode: "s1", items: [] }));
    expect(decoded).toEqual({ shopCode: "s1", items: [] });
  });

  it("drops zero/negative/invalid quantities when encoding", () => {
    const decoded = decodeCart(
      encodeCart({
        shopCode: "s1",
        items: [
          { productId: "p1", qty: 0 },
          { productId: "p2", qty: -3 },
          { productId: "p3", qty: Number.NaN },
          { productId: "p4", qty: 4 },
        ],
      }),
    );
    expect(decoded.items).toEqual([{ productId: "p4", qty: 4 }]);
  });

  it("skips malformed item tokens on decode instead of throwing", () => {
    // version|shop|<good>;<no-colon>;<empty-id>;<bad-qty>
    const encoded = b64url("1|s1|p1:2;garbage;:5;p2:abc;p3:3");
    const decoded = decodeCart(encoded);
    expect(decoded.items).toEqual([
      { productId: "p1", qty: 2 },
      { productId: "p3", qty: 3 },
    ]);
  });

  it("throws CartDecodeError on non-base64 / structurally invalid input", () => {
    expect(() => decodeCart("!!! definitely not a code !!!")).toThrow(CartDecodeError);
    expect(() => decodeCart(b64url("hello"))).toThrow(CartDecodeError); // valid base64, wrong shape
  });

  it("throws CartDecodeError on an unsupported version", () => {
    expect(() => decodeCart(b64url("2|s1|p1:1"))).toThrow(CartDecodeError);
  });

  it("builds a deep link that parseOrderFromHash can read back", () => {
    const payload: CartPayload = { shopCode: "s1", items: [{ productId: "p1", qty: 2 }] };
    const url = buildOrderDeepLink("https://app.example.com/", payload);
    expect(url.startsWith("https://app.example.com/import-order#o=")).toBe(true);
    const hash = url.slice(url.indexOf("#"));
    expect(parseOrderFromHash(hash)).toEqual(payload);
  });

  it("returns null from parseOrderFromHash when there is no order param", () => {
    expect(parseOrderFromHash("")).toBeNull();
    expect(parseOrderFromHash("#something=else")).toBeNull();
  });
});
