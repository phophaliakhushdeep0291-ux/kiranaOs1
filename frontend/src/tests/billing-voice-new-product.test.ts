/**
 * Billing an item the catalogue has never heard of.
 *
 * A shop sells things before it lists them, and the queue is exactly the wrong moment to
 * find out. Until now an unmatched segment was dropped and the command came back "No
 * saved product matched" — so the cashier had to leave the bill, add the product, take
 * the owner PIN, and come back to a cart they had half built.
 *
 * The parser now offers the unlisted item as a product to create, but ONLY when the
 * command carried a price. That bar is the whole safety story: a bare number next to an
 * item is far more often a count ("do packet rusk") than a rate, and reading it as a
 * rate would quietly file a ₹2 product in the catalogue for every later sale to inherit.
 */
import { describe, expect, it } from "vitest";
import { type Product } from "@/lib/api/client";
import { parseBillingVoiceCommand, parseNewProductLine } from "@/features/core/billing/pages/billing-voice-parser";

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
  } as Product;
}

const CATALOGUE = [product()];

describe("an unlisted item that the counter priced", () => {
  it("is offered as a product to create instead of being dropped", () => {
    const draft = parseBillingVoiceCommand("add parle biscuit at 40 rupees", CATALOGUE);

    expect(draft.newProducts).toEqual([
      expect.objectContaining({ name: "parle biscuit", sellingPrice: 40, quantity: 1 }),
    ]);
  });

  it("keeps the quantity and unit the shop actually said", () => {
    const draft = parseBillingVoiceCommand("do packet rusk 25 rupees", CATALOGUE);

    expect(draft.newProducts[0]).toEqual(expect.objectContaining({
      name: "rusk",
      sellingPrice: 25,
      quantity: 2,
      unit: "packet",
    }));
  });

  it("stops warning that nothing matched, because something now can be done", () => {
    const draft = parseBillingVoiceCommand("add rusk at 25", CATALOGUE);

    expect(draft.newProducts).toHaveLength(1);
    expect(draft.warnings.join(" ")).not.toMatch(/no saved product matched/i);
  });

  it("still bills the products the shop already has", () => {
    const draft = parseBillingVoiceCommand("2 kilo chini and add rusk at 25 rupees", CATALOGUE);

    expect(draft.lines.map((line) => line.product.name)).toEqual(["Sugar"]);
    expect(draft.newProducts.map((row) => row.name)).toEqual(["rusk"]);
  });

  it("offers each new item once, however often it is repeated", () => {
    const draft = parseBillingVoiceCommand("add rusk at 25, add rusk at 25", CATALOGUE);

    expect(draft.newProducts).toHaveLength(1);
  });
});

describe("what it refuses to invent", () => {
  it("will not read a quantity as a price", () => {
    // "do packet rusk" is two packets, not a two-rupee product. No money word, no offer.
    expect(parseNewProductLine("do packet rusk")).toBeNull();
    expect(parseBillingVoiceCommand("do packet rusk", CATALOGUE).newProducts).toEqual([]);
  });

  it("will not create a product from a bare name", () => {
    expect(parseNewProductLine("rusk")).toBeNull();
  });

  it("will not create one from a price with nothing to call it", () => {
    expect(parseNewProductLine("at 25 rupees")).toBeNull();
    expect(parseNewProductLine("add at 40 rs")).toBeNull();
  });

  it("will not accept a free or negative price", () => {
    expect(parseNewProductLine("rusk at 0 rupees")).toBeNull();
  });

  it("leaves a known product alone rather than duplicating it", () => {
    const draft = parseBillingVoiceCommand("2 kilo chini at 45 rupees", CATALOGUE);

    expect(draft.lines).toHaveLength(1);
    expect(draft.newProducts).toEqual([]);
  });
});

describe("the name it settles on", () => {
  it("drops the words that carried the price and the count", () => {
    expect(parseNewProductLine("add 2 packet rusk at 25 rupees")?.name).toBe("rusk");
  });

  it("keeps a multi-word name intact", () => {
    expect(parseNewProductLine("add good day biscuit 30 rs")?.name).toBe("good day biscuit");
  });

  it("understands a spoken number as the price", () => {
    expect(parseNewProductLine("rusk rate das")?.sellingPrice).toBe(10);
  });
});

/**
 * The same command, spoken in Hindi.
 *
 * A shop that runs the app in Hindi dictates in Hindi, and until now none of this
 * reached the parser: `normalizeSearchText` classed every Devanagari matra as
 * punctuation and deleted it, so "किलो" arrived as "क ल" and matched no vocabulary
 * word — including the Devanagari numerals that were already in the number table.
 */
describe("dictated in Hindi", () => {
  it("creates the product from a Devanagari command", () => {
    const draft = parseBillingVoiceCommand("नया रस्क 25 रुपये", CATALOGUE);

    expect(draft.newProducts[0]).toEqual(expect.objectContaining({ name: "रस्क", sellingPrice: 25 }));
  });

  it("reads a Devanagari quantity and unit", () => {
    expect(parseNewProductLine("दो पैकेट रस्क 25 रुपये")).toEqual(expect.objectContaining({
      name: "रस्क",
      sellingPrice: 25,
      quantity: 2,
      unit: "packet",
    }));
  });

  it("accepts Devanagari digits", () => {
    expect(parseNewProductLine("रस्क ४० रुपये")?.sellingPrice).toBe(40);
  });

  it("does not keep the possessive particle in the name", () => {
    expect(parseNewProductLine("रस्क का दाम 25")?.name).toBe("रस्क");
    expect(parseNewProductLine("rusk ka daam 25")?.name).toBe("rusk");
  });

  it("holds the same line against a quantity, in Hindi too", () => {
    // "दो पैकेट रस्क" is two packets, not a two-rupee product.
    expect(parseNewProductLine("दो पैकेट रस्क")).toBeNull();
  });

  it("still bills a Hindi-named product the shop already has", () => {
    const draft = parseBillingVoiceCommand("दो किलो चीनी", CATALOGUE);

    // The quantity is the point. The alias matched even before, because query and alias
    // were shredded identically — but "दो" was not a number any more, so a shop asking
    // for two kilos was billed for one.
    expect(draft.lines).toEqual([expect.objectContaining({ quantity: 2, unit: "kg" })]);
    expect(draft.lines.map((line) => line.product.name)).toEqual(["Sugar"]);
    expect(draft.newProducts).toEqual([]);
  });
});
