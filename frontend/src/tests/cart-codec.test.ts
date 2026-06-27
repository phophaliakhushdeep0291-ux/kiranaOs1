import { describe, it, expect } from "vitest";
import {
  encodeCart,
  decodeCart,
  buildOrderDeepLink,
  parseOrderFromHash,
  buildOrderQrPayloads,
  parseOrderHash,
  reassembleOrderChunks,
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

describe("multi-QR for large carts", () => {
  const bigCart: CartPayload = {
    shopCode: "ramesh-kirana",
    items: Array.from({ length: 12 }, (_, i) => ({ productId: `ckp${i}aaaaaaaaaaaaaaaaaaaa`, qty: i + 1 })),
  };

  it("returns a single #o= URL when the order fits in one QR", () => {
    const urls = buildOrderQrPayloads("https://app.example.com", { shopCode: "s1", items: [{ productId: "p1", qty: 1 }] });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/import-order#o=");
    const hash = urls[0].slice(urls[0].indexOf("#"));
    const parsed = parseOrderHash(hash);
    expect(parsed?.kind).toBe("single");
    if (parsed?.kind === "single") expect(parsed.payload).toEqual({ shopCode: "s1", items: [{ productId: "p1", qty: 1 }] });
  });

  it("splits into ordered #m= parts and round-trips when reassembled in order", () => {
    // Force splitting with a tiny single-QR ceiling + small chunk length.
    const urls = buildOrderQrPayloads("https://app.example.com", bigCart, { singleMax: 120, chunkLen: 40 });
    expect(urls.length).toBeGreaterThan(1);

    const collected: Record<number, string> = {};
    let total = 0;
    let group = "";
    urls.forEach((url) => {
      const parsed = parseOrderHash(url.slice(url.indexOf("#")));
      expect(parsed?.kind).toBe("part");
      if (parsed?.kind === "part") {
        collected[parsed.index] = parsed.chunk;
        total = parsed.total;
        group = group || parsed.group;
        expect(parsed.group).toBe(group); // all parts share one group id
        expect(parsed.total).toBe(urls.length);
      }
    });

    expect(reassembleOrderChunks(collected, total)).toEqual(bigCart);
  });

  it("does not reassemble until every part is present", () => {
    const urls = buildOrderQrPayloads("https://app.example.com", bigCart, { singleMax: 120, chunkLen: 40 });
    const partial: Record<number, string> = {};
    const parsedFirst = parseOrderHash(urls[0].slice(urls[0].indexOf("#")));
    if (parsedFirst?.kind === "part") partial[parsedFirst.index] = parsedFirst.chunk;
    expect(reassembleOrderChunks(partial, urls.length)).toBeNull(); // missing parts
  });

  it("parseOrderHash returns null for a malformed multipart fragment", () => {
    expect(parseOrderHash("#m=onlytwo.fields")).toBeNull();
    expect(parseOrderHash("#nope")).toBeNull();
  });
});
