import { describe, expect, it } from "vitest";
import { isPublicCustomerRoute } from "@/lib/pwa/registerServiceWorker";

/**
 * The customer QR order page is opened by walk-in strangers we can never give
 * instructions to, so it must stay a plain network-served page: no service
 * worker, nothing intercepting its lazy chunks. These cases pin which paths that
 * applies to — widening it would silently strip the till of its offline PWA.
 */
describe("public customer order route", () => {
  it("treats the QR self-order page as public", () => {
    expect(isPublicCustomerRoute("/order/cmqgn7cmg00cpvehajtvim3o2")).toBe(true);
    expect(isPublicCustomerRoute("/order")).toBe(true);
    expect(isPublicCustomerRoute("/order/")).toBe(true);
  });

  it("keeps the shopkeeper's own routes on the PWA", () => {
    // /orders-received is the owner's inbox for these orders — it shares a prefix
    // with /order but must keep its service worker and offline behaviour.
    expect(isPublicCustomerRoute("/orders-received")).toBe(false);
    expect(isPublicCustomerRoute("/orders")).toBe(false);
    expect(isPublicCustomerRoute("/dashboard")).toBe(false);
    expect(isPublicCustomerRoute("/billing")).toBe(false);
    expect(isPublicCustomerRoute("/")).toBe(false);
  });
});
