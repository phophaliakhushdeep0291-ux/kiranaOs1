import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { projectCustomerOutstanding, type CustomerWithLedger } from "@/features/core/customers/customer-ledger-data";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function customer(): CustomerWithLedger {
  return {
    id: "customer_1",
    name: "Mohan",
    mobile: null,
    type: "udhar",
    udharAmount: 356,
    totalUdhar: 356,
    ledgerBalance: 356,
    rawLedgerBalance: 356,
    ledgerMetrics: {
      balance: 356,
      ageing: { total: 356, zeroToSeven: 12, sevenToThirty: 344, thirtyPlus: 0 },
      paymentCount: 0,
      billCount: 1,
      trustScore: 75,
      isBadCustomer: false,
      warning: null,
    },
  } as CustomerWithLedger;
}

describe("partial-payment visible balance", () => {
  it("projects the remainder into every customer-list balance field immediately", () => {
    const [updated] = projectCustomerOutstanding([customer()], "customer_1", 355);

    expect(updated).toMatchObject({
      ledgerBalance: 355,
      udharAmount: 355,
      totalUdhar: 355,
      balance_source: "local_payment_projection",
    });
    expect(updated.ledgerMetrics.balance).toBe(355);
    expect(updated.ledgerMetrics.ageing.total).toBe(355);
  });

  it("does not alter a different customer", () => {
    const original = customer();
    expect(projectCustomerOutstanding([original], "customer_2", 0)[0]).toBe(original);
  });

  it("paints the transaction's exact remainder before background refreshes", () => {
    const listPage = source("../features/core/customers/pages/CustomersPage.tsx");
    const listPayment = listPage.slice(
      listPage.indexOf("async function recordPayment()"),
      listPage.indexOf("function applyRange"),
    );
    const detailPage = source("../features/core/customers/pages/CustomerDetailPage.tsx");
    const detailPayment = detailPage.slice(
      detailPage.indexOf("async function savePayment()"),
      detailPage.indexOf("async function saveReverse"),
    );

    expect(listPayment).toContain("nextOutstanding = result.nextBalance");
    expect(listPayment.indexOf("queryClient.setQueryData")).toBeLessThan(listPayment.indexOf("void refetch()"));
    expect(listPayment).not.toContain("await refetch()");
    expect(detailPayment).toContain("result.nextBalance");
    expect(detailPayment.indexOf("queryClient.setQueryData")).toBeLessThan(detailPayment.indexOf("void refetch()"));
    expect(detailPayment).not.toContain("await refetch()");
  });

  it("does not block reversal or adjustment acknowledgement on a refresh", () => {
    const detailPage = source("../features/core/customers/pages/CustomerDetailPage.tsx");
    const reversal = detailPage.slice(
      detailPage.indexOf("async function saveReverse"),
      detailPage.indexOf("async function saveAdjustment"),
    );
    const adjustment = detailPage.slice(
      detailPage.indexOf("async function saveAdjustment"),
      detailPage.indexOf("if (isLoading)"),
    );

    for (const mutation of [reversal, adjustment]) {
      expect(mutation).toContain("projectVisibleBalance");
      expect(mutation).toContain("void refetch()");
      expect(mutation).not.toContain("await refetch()");
    }
  });
});
