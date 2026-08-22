import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  collectionProgressPercent,
  paymentAmount,
  udharCollectionAmount,
} from "@/features/core/customers/pages/CustomersPage";

describe("customer collection progress and reminder safety", () => {
  it("counts only live customer payments as collections", () => {
    expect(udharCollectionAmount({ type: "PAYMENT", mode: "cash", amount: 250 })).toBe(250);
    expect(udharCollectionAmount({ type: "payment", mode: "upi", amount: 75 })).toBe(75);
    expect(udharCollectionAmount({ type: "PAYMENT", mode: "cash", amount: 250, reversed_at: "2026-08-22T10:00:00.000Z" })).toBe(0);
    expect(udharCollectionAmount({ type: "payment", mode: "reversal", amount: 250 })).toBe(0);
    expect(udharCollectionAmount({ type: "payment", mode: "adjustment", amount: 250 })).toBe(0);
    expect(udharCollectionAmount({ type: "payment", mode: "return", amount: 250 })).toBe(0);
    expect(udharCollectionAmount({ type: "debit", mode: "credit", amount: 250 })).toBe(0);
  });

  it("excludes reversed payments from customer totals and keeps progress bounded", () => {
    expect(paymentAmount({ amount: 400, mode: "cash" })).toBe(400);
    expect(paymentAmount({ amount: 400, mode: "cash", reversedAt: "2026-08-22T10:00:00.000Z" })).toBe(0);
    expect(collectionProgressPercent(300, 700)).toBe(30);
    expect(collectionProgressPercent(-10, 0)).toBe(0);
    expect(collectionProgressPercent(50, -20)).toBe(100);
  });

  it("routes automated reminders through the audited backend instead of wa.me", () => {
    const source = readFileSync(new URL("../features/core/customers/pages/CustomersPage.tsx", import.meta.url), "utf8");
    expect(source).toContain('>("/reminders/send", {');
    expect(source).toContain('useFeature("whatsapp_reminders")');
    expect(source).toContain("customers.toast.noPendingRemind");
    expect(source).not.toContain("https://wa.me/91");
  });
});
