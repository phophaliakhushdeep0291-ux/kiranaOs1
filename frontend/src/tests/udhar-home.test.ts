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

describe("the udhar route", () => {
  const routes = readFileSync("src/app/routes.tsx", "utf8");
  /**
   * `/udhar` is an alias, not a screen. It briefly rendered a standalone page,
   * which split the same concept across two lists — the dashboard "Outstanding
   * Udhar" card opened one and the sidebar's "Customers / Udhar" the other, and
   * only the sidebar's could record a payment. Both land on the customer credit
   * view again. The widths that view survives are measured by the CDP matrix in
   * scripts/capture-mobile-core-matrix-v1.mjs, not by source assertions here.
   */
  it("resolves to the customer credit view rather than a screen of its own", () => {
    expect(routes).toContain('<Redirect to="/customers?filter=udhar" />');
    expect(routes).not.toContain("loadUdharRoute");
  });
});
