import { describe, expect, it } from "vitest";
import { parseSpokenProductFields } from "@/features/core/products/product-voice-parser";

/**
 * Three ways a shopkeeper actually speaks that the parser used to drop on the
 * floor. All three failed SILENTLY — the product saved with a missing price or a
 * command word baked into its name, and nothing said so. The feature's own suite
 * was green throughout, because it only exercises keyword-disciplined phrasing
 * ("cost 24 selling 26"), which is not how anyone talks at a counter.
 */
describe("product voice: how people actually speak", () => {
  it("reads a price stated with a currency word and no label", () => {
    // "chini 45 rupaye" is the most natural phrasing there is. Both tokens were
    // already filtered out of the name, so the number simply vanished and the
    // product saved with NO price.
    expect(parseSpokenProductFields("chini 45 rupaye")).toMatchObject({
      name: "chini",
      sellingPrice: 45,
    });
    expect(parseSpokenProductFields("आटा 170 रुपये")).toMatchObject({
      name: "आटा",
      sellingPrice: 170,
    });
    expect(parseSpokenProductFields("sugar 45 rupees").sellingPrice).toBe(45);
  });

  it("does not mistake a pack size for a price", () => {
    // "500 gram" is a size; only a figure next to a CURRENCY word is money.
    const packet = parseSpokenProductFields("amul butter 500 gram");
    expect(packet.packSizeValue).toBe(500);
    expect(packet.sellingPrice).toBeUndefined();
  });

  it("lets an explicit label win over the currency-word guess", () => {
    // "दाम" states it outright; the currency word must not overwrite that.
    expect(parseSpokenProductFields("आटा दाम 170 रुपये")).toMatchObject({
      name: "आटा",
      sellingPrice: 170,
    });
    const both = parseSpokenProductFields("chini selling 40 rupaye 45");
    expect(both.sellingPrice).toBe(40);
  });

  it("understands the fractions a counter says constantly", () => {
    // billing-voice-parser has had these for a while. This parser did not, so the
    // same person saying "डेढ़ किलो चीनी" was understood at the till but got a
    // product literally named "डेढ़ किलो चीनी" here.
    expect(parseSpokenProductFields("डेढ़ किलो चीनी")).toMatchObject({
      name: "चीनी",
      packSizeValue: 1.5,
      packSizeUnit: "kg",
    });
    expect(parseSpokenProductFields("ढाई किलो आटा").packSizeValue).toBe(2.5);
    expect(parseSpokenProductFields("सवा किलो दाल").packSizeValue).toBe(1.25);
    expect(parseSpokenProductFields("पौन किलो चावल").packSizeValue).toBe(0.75);
    // Romanised, because dictation transcribes Hinglish as often as Devanagari.
    expect(parseSpokenProductFields("dedh kilo chini").packSizeValue).toBe(1.5);
    expect(parseSpokenProductFields("dhai kilo aata").packSizeValue).toBe(2.5);
  });

  it("reads a figure spoken before its label", () => {
    // Pass 1 only ever looked AFTER a label, so "50 stock" lost the number AND
    // left "stock" stranded in the product name.
    expect(parseSpokenProductFields("tata salt 50 stock")).toMatchObject({
      name: "tata salt",
      stockQuantity: 50,
    });
    // The order that always worked must keep working.
    expect(parseSpokenProductFields("amul butter stock 12")).toMatchObject({
      name: "amul butter",
      stockQuantity: 12,
    });
  });

  it("still refuses to swallow a bare label-like word into a value", () => {
    // The guard on the before-the-label pass: it fires only when a real number
    // sits in front. A word that is genuinely part of the name must survive.
    const noNumber = parseSpokenProductFields("amul butter stock");
    expect(noNumber.stockQuantity).toBeUndefined();
  });

  it("never lets a label a speaker abandoned become part of the name", () => {
    // A label said and then left with nothing behind it — the sentence ran out,
    // or another field already took its value. It used to fall through into the
    // residue and get filed as part of the product's name.
    expect(parseSpokenProductFields("amul butter stock").name).toBe("amul butter");
    expect(parseSpokenProductFields("tata salt cost").name).toBe("tata salt");
    expect(parseSpokenProductFields("chini category grocery brand")).toMatchObject({
      name: "chini",
      category: "grocery",
    });
    expect(parseSpokenProductFields("amul butter mrp 62 stock 12 unit").name).toBe("amul butter");
  });

  it("never files a product with no name at all", () => {
    // A word-valued label fires on ANY word after it, so it can eat the words
    // that were going to be the name. "cat food rate 200" priced something and
    // named nothing. The capture gives its VALUE back; the label word stays
    // consumed, so this is a shirt rather than a brand-factory-shirt.
    expect(parseSpokenProductFields("cat food rate 200")).toMatchObject({
      name: "cat food",
      sellingPrice: 200,
    });
    expect(parseSpokenProductFields("unit soap rate 30").name).toBe("soap");
    expect(parseSpokenProductFields("brand factory shirt rate 500").name).toBe("factory shirt");
    expect(parseSpokenProductFields("company seal rate 15").name).toBe("seal");
  });

  it("still reads a mid-sentence label as a real value, not a rescued name", () => {
    // The gate on the rescue is positional. A label that OPENS the sentence was
    // probably the product's name; one said mid-sentence is a genuine field, and
    // rescuing it filed a product named "litre" with its unit cleared. This is
    // also what protects field-at-a-time dictation.
    expect(parseSpokenProductFields("stock 25 kg unit litre")).toMatchObject({
      stockQuantity: 25,
      unit: "litre",
    });
    expect(parseSpokenProductFields("stock 25 kg unit litre").name).toBeUndefined();
    expect(parseSpokenProductFields("category grocery")).toMatchObject({ category: "grocery" });
    expect(parseSpokenProductFields("category grocery").name).toBeUndefined();
  });

  it("reads a figure before its label even though the label gets claimed", () => {
    // The interaction that broke when these fixes were first combined: claiming a
    // stranded label consumes it, so pairing it with a preceding number has to
    // happen in the SAME place, not in a later pass. Once claimed, nothing
    // downstream can see it.
    expect(parseSpokenProductFields("tata salt 50 stock")).toMatchObject({
      name: "tata salt",
      stockQuantity: 50,
    });
  });

  it("keeps a name that merely looks like a label", () => {
    // The other half of the stranded-label rule: a label whose SHAPE check fails
    // is probably not a label at all, and must fall through unclaimed.
    expect(parseSpokenProductFields("cost guard biscuit rate 20").name).toBe("cost guard biscuit");
    expect(parseSpokenProductFields("sendha salt rate 20").name).toBe("sendha salt");
    expect(parseSpokenProductFields("stock pot rate 400").name).toBe("stock pot");
  });

  it("keeps reading the keyword-disciplined sentences it always could", () => {
    expect(parseSpokenProductFields("add product Tata Salt cost 24 selling 26 stock 50")).toMatchObject({
      name: "tata salt",
      costPrice: 24,
      sellingPrice: 26,
      stockQuantity: 50,
    });
    expect(parseSpokenProductFields("आटा 5 किलो एमआरपी 340 लागत 320 बिक्री 340")).toMatchObject({
      name: "आटा",
      mrp: 340,
      costPrice: 320,
      sellingPrice: 340,
      packSizeValue: 5,
    });
    // Decimals must survive: this parser deliberately keeps the dot.
    expect(parseSpokenProductFields("colgate mrp 55.50 gst 18 percent").mrp).toBe(55.5);
  });
});
