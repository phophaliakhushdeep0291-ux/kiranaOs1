import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { customersEn as customersEnglish } from "@/features/core/settings/translations/customers";

const customersSource = readFileSync("src/features/core/customers/pages/CustomersPage.tsx", "utf8");
const reportsSource = readFileSync("src/features/core/reports/pages/ReportsPage.tsx", "utf8");

describe("udhar collection records the tender the shopkeeper actually took", () => {
  // Regression: the collection panel defaulted to Split and seeded a hardcoded
  // 40/60 cash/UPI ratio, so collecting Rs 10 cash was booked as Rs 4 cash +
  // Rs 6 UPI. The balance stayed right, but the cash drawer and the UPI report
  // were both silently falsified.
  it("never seeds a guessed cash/UPI ratio", () => {
    expect(customersSource).not.toContain("* 0.4");
    expect(customersSource).not.toMatch(/Math\.round\(\s*(total|value)\s*\*/);
  });

  it("defaults udhar collection to a single tender, not split", () => {
    expect(customersSource).toContain(`amount: "", mode: "cash"`);
    expect(customersSource).not.toContain(`amount: "", mode: "split"`);
  });

  it("seeds split mode with the full amount in cash and zero UPI", () => {
    expect(customersSource).toContain(`cashAmount: String(value), upiAmount: "0"`);
  });
});

describe("collection metrics separate udhar recovery from sales revenue", () => {
  // Regression: "Received This Week" summed the payments table, which also holds
  // bill tender for ordinary cash sales, so plain shop revenue was reported as
  // khata recovered.
  it("derives udhar collected from the customer ledger, not the payments table", () => {
    expect(customersSource).toContain("udharCollectionAmount");
    expect(customersSource).not.toContain(
      "const receivedInRange = rangePayments.reduce((sum, payment) => sum + paymentAmount(payment), 0)",
    );
  });

  it("counts only payment-type ledger rows and skips reversals", () => {
    expect(customersSource).toMatch(/if \(!type\.includes\("PAYMENT"\)\) return 0;/);
    expect(customersSource).toMatch(/if \(row\.reversedAt \?\? row\.reversed_at\) return 0;/);
  });

  it("labels the metric as udhar collected rather than generic receipts", () => {
    // The label now comes from the i18n catalogue, so the honesty check is on
    // the key the card renders plus the English text that key resolves to.
    expect(customersSource).toContain(`label={t("customers.stat.udharCollected")}`);
    expect(customersEnglish["customers.stat.udharCollected"]).toBe("Udhar Collected");
    expect(customersSource).not.toContain(`label="Received This Week"`);
  });
});

describe("reports payment donut reconciles to total sales", () => {
  // Regression: the donut summed cashIn/upiIn/bankIn (which include recovery of
  // OLDER udhar) alongside the udhar slice, so "Total Collection" exceeded total
  // sales by the amount of udhar collected in the period.
  it("uses sales tender fields, not collection fields that include old udhar", () => {
    expect(reportsSource).toContain("payment.cash, color");
    expect(reportsSource).toContain("payment.upi, color");
    expect(reportsSource).toContain("payment.bank, color");
    expect(reportsSource).not.toContain("payment.cashIn");
    expect(reportsSource).not.toContain("payment.upiIn");
    expect(reportsSource).not.toContain("payment.bankIn");
  });

  it("does not claim udhar was collected", () => {
    expect(reportsSource).not.toContain("Total Collection");
    expect(reportsSource).not.toContain("leads collected payments");
  });
});
