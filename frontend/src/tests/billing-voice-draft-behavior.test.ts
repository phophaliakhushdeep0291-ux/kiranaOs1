import { describe, expect, it } from "vitest";
import { BillInputBillType, BillPaymentMode, type Product } from "@/lib/api/client";
import { parseBillingVoiceCommand } from "@/features/billing/pages/billing-voice-parser";
import { SPLIT_PAYMENT } from "@/features/billing/pages/billing-types";
import { parseLocalVoiceIntent } from "@/features/voice/voice-command-parser";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-sugar",
    name: "Sugar",
    category: "Grocery",
    aliases: ["chini", "cheeni", "चीनी"],
    rateUnit: "kg",
    displayUnit: "kg",
    defaultPricePerRateUnit: 42,
    ...overrides,
  };
}

const oil = product({
  id: "prod-oil",
  name: "Oil",
  aliases: ["tel", "oil", "तेल"],
  rateUnit: "packet",
  displayUnit: "packet",
  defaultPricePerRateUnit: 120,
});

const atta = product({
  id: "prod-atta",
  name: "Atta",
  aliases: ["atta", "aata", "आटा"],
  rateUnit: "kg",
  displayUnit: "kg",
  defaultPricePerRateUnit: 38,
});

describe("billing voice draft behavior", () => {
  it("parses cart item with quantity, unit, and rate", () => {
    const draft = parseBillingVoiceCommand("add 5 kg atta at 38", [atta]);

    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0].product.id).toBe("prod-atta");
    expect(draft.lines[0].quantity).toBe(5);
    expect(draft.lines[0].unit).toBe("kg");
    expect(draft.lines[0].rate).toBe(38);
    expect(draft.requiresConfirmation).toBe(true);
  });

  it("parses customer from naam/customer commands", () => {
    expect(parseBillingVoiceCommand("customer Ramesh", [product()]).customerName).toBe("Ramesh");
    expect(parseBillingVoiceCommand("Ramesh ke naam 2 kilo chini", [product()]).customerName).toBe("Ramesh");
  });

  it("parses cash and UPI split payments", () => {
    const draft = parseBillingVoiceCommand("paid 500 cash 200 UPI", [product()]);

    expect(draft.paymentMode).toBe(SPLIT_PAYMENT);
    expect(draft.cashAmount).toBe(500);
    expect(draft.upiAmount).toBe(200);
    expect(draft.lines).toHaveLength(0);
  });

  it("parses udhar billing and marks it as customer-required", () => {
    const draft = parseBillingVoiceCommand("make udhar bill", [product()]);

    expect(draft.paymentMode).toBe(BillPaymentMode.credit);
    expect(draft.billType).toBe(BillInputBillType.udhar_entry);
    expect(draft.warnings.join(" ")).toMatch(/customer/i);
  });

  it("parses mixed Hinglish billing draft with customer, items, and udhar", () => {
    const draft = parseBillingVoiceCommand("Ramesh ke naam 2 kilo chini 45 rupay kilo, ek tel packet 120, 500 udhar", [product(), oil]);

    expect(draft.customerName).toBe("Ramesh");
    expect(draft.udharAmount).toBe(500);
    expect(draft.paymentMode).toBe(BillPaymentMode.credit);
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines[0]).toMatchObject({ quantity: 2, unit: "kg", rate: 45 });
    expect(draft.lines[1]).toMatchObject({ quantity: 1, unit: "packet", rate: 120 });
  });

  it("does not create final bill directly from local voice intent", () => {
    const intent = parseLocalVoiceIntent("Ramesh ke naam 2 kilo chini 45 rupay kilo", "/billing");

    expect(intent.action).toBe("billing_command");
    expect(intent.route).toBe("/billing");
    expect(intent.requiresConfirmation).toBe(true);
  });

  it("routes billing screen customer/payment commands to billing draft instead of other modules", () => {
    expect(parseLocalVoiceIntent("customer Ramesh", "/billing").action).toBe("billing_command");
    expect(parseLocalVoiceIntent("paid 500 cash 200 UPI", "/billing").action).toBe("billing_command");
  });

  it("duplicate transcript receives the same fingerprint for cart idempotency", () => {
    const first = parseBillingVoiceCommand("add 5 kg atta at 38", [atta]);
    const second = parseBillingVoiceCommand("add 5 kg atta at 38", [atta]);

    expect(first.fingerprint).toBe(second.fingerprint);
  });
});
