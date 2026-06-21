import { describe, expect, it } from "vitest";
import { buildUdharReminderText, buildUdharReminderUrl } from "@/features/ledger/udhar-reminder";

describe("buildUdharReminderText", () => {
  it("greets the customer and states the outstanding amount + shop", () => {
    const text = buildUdharReminderText({ customerName: "Ramesh", amount: 360, shopName: "Sharma General Store" });
    expect(text).toContain("नमस्ते Ramesh");
    expect(text).toContain("*Sharma General Store*");
    expect(text).toContain("Aapka udhar baki hai: *₹360*");
    expect(text).toContain("Dhanyavaad");
  });

  it("includes a UPI id only when provided", () => {
    expect(buildUdharReminderText({ amount: 100, upiId: "shop@upi" })).toContain("UPI: shop@upi");
    expect(buildUdharReminderText({ amount: 100 })).not.toContain("UPI:");
  });

  it("uses absolute amount with Indian grouping", () => {
    expect(buildUdharReminderText({ amount: 12500 })).toContain("₹12,500");
  });
});

describe("buildUdharReminderUrl", () => {
  it("targets the customer's normalized number", () => {
    const url = buildUdharReminderUrl({ amount: 100, customerMobile: "9876543210" });
    expect(url.startsWith("https://wa.me/919876543210?text=")).toBe(true);
  });

  it("falls back to the chat picker without a number", () => {
    expect(buildUdharReminderUrl({ amount: 100 }).startsWith("https://wa.me/?text=")).toBe(true);
  });

  it("encodes the body (no raw newlines)", () => {
    expect(buildUdharReminderUrl({ amount: 100 })).not.toContain("\n");
  });
});
