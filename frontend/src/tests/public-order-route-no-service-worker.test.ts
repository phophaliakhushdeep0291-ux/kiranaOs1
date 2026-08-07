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

  it("treats a restaurant table's QR menu as public", () => {
    // Same stranger, same one-off phone, same shop wifi — and worse to fail,
    // because a waiter is standing there while the guest stares at a blank page.
    expect(isPublicCustomerRoute("/t/cmqgn7cmg00cpvehajtvim3o2/t5")).toBe(true);
    expect(isPublicCustomerRoute("/t/cmqgn7cmg00cpvehajtvim3o2")).toBe(true);
  });

  it("keeps the shopkeeper's own routes on the PWA", () => {
    // /orders-received is the owner's inbox for these orders — it shares a prefix
    // with /order but must keep its service worker and offline behaviour.
    expect(isPublicCustomerRoute("/orders-received")).toBe(false);
    expect(isPublicCustomerRoute("/orders")).toBe(false);
    expect(isPublicCustomerRoute("/dashboard")).toBe(false);
    expect(isPublicCustomerRoute("/billing")).toBe(false);
    expect(isPublicCustomerRoute("/")).toBe(false);
    // The till's own floor screen shares a first letter with the guest menu and
    // must keep its offline PWA — this is why the pattern anchors on "/t/".
    expect(isPublicCustomerRoute("/tables")).toBe(false);
    expect(isPublicCustomerRoute("/testers")).toBe(false);
  });
});
