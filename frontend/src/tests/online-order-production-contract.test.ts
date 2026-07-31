import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storefront = readFileSync("src/features/customer-order/CustomerOrderPage.tsx", "utf8");
const merchantQueue = readFileSync("src/features/orders/pages/OrdersReceivedPage.tsx", "utf8");

describe("online ordering production contract", () => {
  it("keeps the customer journey transparent and fulfillment-aware", () => {
    expect(storefront).toContain("Review your order");
    expect(storefront).toContain("The store verifies availability and final amount.");
    expect(storefront).toContain("No payment is taken now.");
    expect(storefront).toContain('fulfillment === "delivery" ? (');
    expect(storefront).toContain("Used only for this order and status updates.");
    expect(storefront).toContain('role="dialog"');
  });

  it("does not let a new merchant order jump directly to completed", () => {
    expect(merchantQueue).toContain("Review & confirm");
    expect(merchantQueue).toContain('order.status !== "new" ? (');
    expect(merchantQueue).not.toContain('next: order.status === "accepted" ? "ready" : "fulfilled"');
  });

  it("makes destructive rejection explicit", () => {
    expect(merchantQueue).toContain("window.confirm");
    expect(merchantQueue).toContain("The customer will see this order as declined.");
  });
});
