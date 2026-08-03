import { describe, expect, it } from "vitest";
import { buildOrderWhatsappText, buildOrderWhatsappUrl } from "@/features/core/orders/notify";
import type { CustomerOrder } from "@/features/core/orders/api";

const order: CustomerOrder = {
  id: "ord_1",
  shopId: "shop_1",
  customerName: "Ramesh",
  customerMobile: "9812345678",
  customerAddress: "45 Sudama Nagar",
  note: null,
  items: [
    { productId: "p1", name: "Sugar", unit: "kg", price: 45, qty: 2 },
    { productId: "p2", name: "Parle-G", unit: "piece", price: 10, qty: 1 },
  ],
  itemCount: 2,
  estimatedTotal: 100,
  status: "new",
  billId: null,
  createdAt: "2026-07-08T10:00:00.000Z",
  updatedAt: "2026-07-08T10:00:00.000Z",
};

describe("buildOrderWhatsappText", () => {
  it("greets the customer and lists every line for a received order", () => {
    const text = buildOrderWhatsappText(order, "Rate Test Store", "received");
    expect(text).toContain("Hi Ramesh");
    expect(text).toContain("Rate Test Store");
    expect(text).toContain("• 2× Sugar");
    expect(text).toContain("• 1× Parle-G");
    expect(text).toContain("₹100");
    expect(text).toContain("getting it ready");
  });

  it("uses ready wording for a ready alert", () => {
    const text = buildOrderWhatsappText(order, "Rate Test Store", "ready");
    expect(text).toContain("is ready");
    expect(text).not.toContain("getting it ready");
  });

  it("falls back to a generic shop name when blank", () => {
    expect(buildOrderWhatsappText(order, "", "received")).toContain("our shop");
  });
});

describe("buildOrderWhatsappUrl", () => {
  it("targets the customer's 91-prefixed number", () => {
    const url = buildOrderWhatsappUrl(order, "Shop", "received");
    expect(url.startsWith("https://wa.me/919812345678?text=")).toBe(true);
  });

  it("falls back to the chat picker when the number is unusable", () => {
    const url = buildOrderWhatsappUrl({ ...order, customerMobile: "" }, "Shop", "received");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
  });
});
