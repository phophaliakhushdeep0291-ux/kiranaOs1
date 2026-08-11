import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { customerMatchesUdharSearch } from "@/features/core/udhar/udhar-search";
import { buildUdharReminderText, buildUdharReminderUrl } from "@/features/core/udhar/reminder";
import type { CustomerWithLedger } from "@/features/core/customers/customer-ledger-data";

function customer(name: string, aliases: string[] = []): CustomerWithLedger {
  return { id: "c1", name, mobile: "9876543210", aliases, ledgerBalance: 123.45, rawLedgerBalance: 123.45, ledgerMetrics: { balance: 123.45, ageing: { total: 123.45, zeroToSeven: 123.45, sevenToThirty: 0, thirtyPlus: 0 }, paymentCount: 0, billCount: 1, trustScore: 80, isBadCustomer: false, warning: null } } as CustomerWithLedger;
}

describe("udhar home search and reminders", () => {
  it("matches Hindi, Hinglish aliases, names and phone", () => {
    const ramesh = customer("रमेश कुमार", ["Ramesh", "ramesh bhai"]);
    expect(customerMatchesUdharSearch(ramesh, "रमेश")).toBe(true);
    expect(customerMatchesUdharSearch(ramesh, "ramesh")).toBe(true);
    expect(customerMatchesUdharSearch(ramesh, "98765")).toBe(true);
  });

  it("binds the right customer and exact displayed amount into WhatsApp", () => {
    const text = buildUdharReminderText("राम किराना", "सीमा", 123.45);
    expect(text).toContain("सीमा");
    expect(text).toContain("₹123.45");
    const url = buildUdharReminderUrl("राम किराना", "सीमा", "9876543210", 123.45);
    expect(url).toContain("wa.me/919876543210");
    expect(decodeURIComponent(url)).toContain("₹123.45");
  });
});

describe("udhar route and phone-first shell", () => {
  const page = readFileSync("src/features/core/udhar/pages/UdharPage.tsx", "utf8");
  const routes = readFileSync("src/app/routes.tsx", "utf8");
  it("makes /udhar a dedicated first-class route", () => {
    expect(routes).toContain('from "./route-preload"');
    expect(routes).toContain("loadUdharRoute");
    expect(routes).toContain("const Udhar = lazy(loadUdharRoute)");
    expect(routes).toContain("<ProtectedRoute component={Udhar} />");
  });
  /**
   * This was written as `it.each([375, 390, 430, 768])` over the same four source
   * assertions, which never read the width and so reported four passes for one check —
   * it looked like proof that /udhar survives 375px when nothing had measured a
   * viewport. There is no DOM environment here, so the honest split is: source keeps the
   * structural guards below, and the real widths are measured by the CDP matrix in
   * scripts/capture-mobile-core-matrix-v1.mjs, which /udhar is now part of.
   */
  it("keeps the structural guards that make the page survive a narrow viewport", () => {
    expect(page).toContain("overflow-x-hidden");
    expect(page).toContain("min-w-0");
  });

  it("keeps primary controls at or above the 44px touch target", () => {
    // h-12 is 48px in this scale; the reminder button is the one a shopkeeper hits most.
    expect(page).toContain('className="h-12 w-full');
    expect(page).toContain('className="h-12 w-12');
  });
});
