import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { englishTranslations } from "@/features/core/settings/translations/english";

const storefront = readFileSync("src/features/core/customer-order/CustomerOrderPage.tsx", "utf8");
const merchantQueue = readFileSync("src/features/core/orders/pages/OrdersReceivedPage.tsx", "utf8");

describe("online ordering production contract", () => {
  it("keeps the customer journey transparent and fulfillment-aware", () => {
    expect(storefront).toContain("Review your order");
    expect(storefront).toContain("The store verifies availability and final amount.");
    expect(storefront).toContain("No payment is taken now.");
    expect(storefront).toContain('fulfillment === "delivery" ? (');
    expect(storefront).toContain("Used only for this order and status updates.");
    expect(storefront).toContain('role="dialog"');
  });

  // The two assertions below moved from the page's source to the dictionary when
  // this screen was translated. What they are actually protecting is the step
  // gate and the confirmation, so they now check that the page still renders the
  // key AND that the key still says the thing — a literal that had merely been
  // deleted would otherwise pass by disappearing.
  it("does not let a new merchant order jump directly to completed", () => {
    expect(merchantQueue).toContain('t("orders.row.reviewConfirm")');
    expect(englishTranslations["orders.row.reviewConfirm"]).toBe("Review & confirm");
    expect(merchantQueue).toContain('order.status !== "new" && order.fulfillmentType !== "dine_in"');
    expect(merchantQueue).not.toContain('next: order.status === "accepted" ? "ready" : "fulfilled"');
  });

  it("routes dine-in through Tables instead of the generic retail importer", () => {
    expect(merchantQueue).toContain('if (order.fulfillmentType === "dine_in")');
    expect(merchantQueue).toContain('navigate("/tables")');
    expect(merchantQueue).toContain('t("orders.row.dineInTable"');
    expect(merchantQueue).toContain('order.fulfillmentType !== "dine_in"');
  });

  it("makes destructive rejection explicit", () => {
    expect(merchantQueue).toContain("window.confirm");
    expect(merchantQueue).toContain('t("orders.confirm.reject"');
    expect(englishTranslations["orders.confirm.reject"]).toContain("declined");
  });
});
