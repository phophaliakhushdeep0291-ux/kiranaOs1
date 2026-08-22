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
import { parseBillingVoiceCommand, parseNewProductLine, parseVoiceNumber } from "@/features/core/billing/pages/billing-voice-parser";

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

  it("names the customer when the command says so in Hindi", () => {
    // "ke naam" was matched only in Latin, so a Hindi shop putting a bill on a
    // customer's account got no customer — and with it no udhar ledger entry.
    expect(parseBillingVoiceCommand("रमेश के नाम दो किलो चीनी", CATALOGUE).customerName).toBe("रमेश");
    expect(parseBillingVoiceCommand("ग्राहक रमेश दो किलो चीनी", CATALOGUE).customerName).toBe("रमेश");
  });

  it("still names the customer in Hinglish", () => {
    expect(parseBillingVoiceCommand("Ramesh ke naam 2 kilo chini", CATALOGUE).customerName).toBe("Ramesh");
    expect(parseBillingVoiceCommand("customer Ramesh 2 kilo chini", CATALOGUE).customerName).toBe("Ramesh");
  });

  it("records udhar when the amount is spoken in Hindi", () => {
    // Money. "500 उधार" set no credit at all, so the bill looked settled
    // and the customer's ledger never moved.
    const draft = parseBillingVoiceCommand("रमेश के नाम दो किलो चीनी, 500 उधार", CATALOGUE);

    expect(draft.customerName).toBe("रमेश");
    expect(draft.udharAmount).toBe(500);
    expect(draft.paymentMode).toBe("credit");
    expect(draft.lines).toEqual([expect.objectContaining({ quantity: 2, unit: "kg" })]);
  });

  it("reads a Hindi cash tender", () => {
    const draft = parseBillingVoiceCommand("दो किलो चीनी, 100 नकद", CATALOGUE);

    expect(draft.paymentMode).toBe("cash");
  });

  it("still reads the English tender words", () => {
    const draft = parseBillingVoiceCommand("Ramesh ke naam 2 kilo chini, 500 udhar", CATALOGUE);

    expect(draft.udharAmount).toBe(500);
    expect(draft.paymentMode).toBe("credit");
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

/**
 * The counter says the price out loud, and prices are not single digits.
 *
 * The Hindi number table originally stopped at दस (10), so "naya maggi bees rupaye"
 * parsed to null and the item was silently never created — while the same sentence
 * at "das rupaye" worked. The feature therefore looked fine in a demo and failed on
 * every real price. Digits were never affected, which is what hid it.
 */
describe("prices a counter actually says", () => {
  const prices: Array<[string, number]> = [
    ["ग्यारह", 11], ["पंद्रह", 15], ["बीस", 20], ["पच्चीस", 25], ["तीस", 30],
    ["चालीस", 40], ["पचास", 50], ["साठ", 60], ["सौ", 100],
    ["bees", 20], ["pachas", 50], ["sau", 100],
  ];
  it.each(prices)("reads %s as %i", (word, value) => {
    expect(parseVoiceNumber(word)).toBe(value);
  });

  // Weight words, which is where these show up rather than in the price.
  it.each([["डेढ़", 1.5], ["ढाई", 2.5], ["सवा", 1.25], ["पौन", 0.75]] as Array<[string, number]>)(
    "reads the fraction %s as %f",
    (word, value) => { expect(parseVoiceNumber(word)).toBe(value); },
  );

  it("still reads seven as seven, which romanised sixty would have broken", () => {
    // "saath" is how people write BOTH 60 and 7, so 60 is Devanagari-only on purpose.
    expect(parseVoiceNumber("saat")).toBe(7);
    expect(parseVoiceNumber("सात")).toBe(7);
    expect(parseVoiceNumber("साठ")).toBe(60);
  });

  it("creates the product at a real price", () => {
    expect(parseNewProductLine("नया मैगी बीस रुपये")).toMatchObject({ name: "मैगी", sellingPrice: 20 });
  });

  it("does not name the product after the word 'item'", () => {
    // "add new item sabun" used to create a product called "item sabun".
    expect(parseNewProductLine("add new item sabun 45 rupees")).toMatchObject({ name: "sabun" });
    expect(parseNewProductLine("नया आइटम मैगी बीस रुपये")).toMatchObject({ name: "मैगी" });
  });
});
