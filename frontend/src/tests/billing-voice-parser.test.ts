import { describe, expect, it } from "vitest";
import type { Product } from "@/lib/api/client";
import { normalizeVoiceUnit, parseBillingVoiceCommand, parseVoiceLine, parseVoiceNumber, voiceProductAliases } from "@/features/core/billing/pages/billing-voice-parser";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    name: "Sugar",
    category: "Grocery",
    aliases: ["chini", "cheeni", "चीनी"],
    rateUnit: "kg",
    displayUnit: "kg",
    defaultPricePerRateUnit: 42,
    ...overrides,
  };
}

describe("billing voice parser", () => {
  it("parses Hindi/Hinglish number words and units", () => {
    expect(parseVoiceNumber("aadha")).toBe(0.5);
    expect(parseVoiceNumber("do")).toBe(2);
    expect(normalizeVoiceUnit("kilo", "piece")).toBe("kg");
    expect(normalizeVoiceUnit("pkt", "piece")).toBe("packet");
  });

  it("sorts longer product aliases first for safer matching", () => {
    const aliases = voiceProductAliases(product({ aliases: ["oil", "mustard oil"] }));

    expect(aliases[0]).toBe("mustard oil");
  });

  it("parses one product line with quantity, unit, and explicit rate", () => {
    const line = parseVoiceLine("2 kilo chini 45 rupay kilo", product());

    expect(line?.product.id).toBe("prod-1");
    expect(line?.quantity).toBe(2);
    expect(line?.unit).toBe("kg");
    expect(line?.rate).toBe(45);
  });

  it("falls back to product selling price when the command has no rate", () => {
    const line = parseVoiceLine("aadha kilo cheeni", product({ sellingPrice: 44 }));

    expect(line?.quantity).toBe(0.5);
    expect(line?.rate).toBe(44);
  });

  it("parses customer, udhar amount, and multiple cart lines", () => {
    const oil = product({ id: "prod-2", name: "Oil", aliases: ["tel", "तेल"], rateUnit: "packet", displayUnit: "packet", defaultPricePerRateUnit: 120 });
    const draft = parseBillingVoiceCommand("Ramesh ke naam 2 kilo chini 45 rupay kilo, ek tel packet 120, 500 udhar", [product(), oil]);

    expect(draft.customerName).toBe("Ramesh");
    expect(draft.udharAmount).toBe(500);
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines.map((line) => line.product.id)).toEqual(["prod-1", "prod-2"]);
    expect(draft.warnings).toEqual([]);
  });

  it("warns clearly when no saved product matches", () => {
    const draft = parseBillingVoiceCommand("do biscuit", [product()]);

    expect(draft.lines).toHaveLength(0);
    expect(draft.warnings[0]).toMatch(/No saved product matched/i);
  });
});
