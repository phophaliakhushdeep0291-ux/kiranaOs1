import { describe, expect, it } from "vitest";
import { projectCustomerOutstanding, type CustomerWithLedger } from "@/features/core/customers/customer-ledger-data";

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
});
