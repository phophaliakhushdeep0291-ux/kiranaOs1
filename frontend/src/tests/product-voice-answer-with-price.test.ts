import { describe, expect, it } from "vitest";
import { parseProductVoiceAnswer } from "@/features/core/products/product-voice-parser";
import { spokenNumber } from "@/features/core/voice/voice-text";

/**
 * Answering "what is it called?" the way a shop actually answers it.
 *
 * Nobody replies with a bare noun. Asked for the name they say the whole thing —
 * "Tata Salt chhabbis rupaye", "surf excel ek kilo sau bees rupaye" — because
 * that is the sentence in their head.
 *
 * The free-form reader understood those perfectly. The answer path threw its
 * result away unless the sentence spelled out a field LABEL, and a money word is
 * not a label. So the entire sentence went into the name: a product called
 * "tata salt chhabbis rupaye", no price on it, and the very next question asking
 * for the price it had just been told.
 *
 * Two things had to be true for that to work. A price is a safe signal, because
 * reaching one takes a money word or a label and an ordinary product name raises
 * neither. A bare quantity is not: "5 star chocolate" and "500 ml bottle" are
 * names, and reading their numbers would eat the words being asked for.
 *
 * The numbers themselves were the other half. This table went 1-10, 20, 30, 40,
 * 50, 100 — so every price a counter actually says between those, which is most
 * of them, fell through as an ordinary word into the name.
 */

describe("a name answer that carries a price", () => {
  it("keeps the name and takes the price", () => {
    expect(parseProductVoiceAnswer("name", "Tata Salt 28 rupaye")).toEqual({
      name: "tata salt",
      sellingPrice: 28,
    });
  });

  it("reads the price when it is spoken as a Hindi word", () => {
    expect(parseProductVoiceAnswer("name", "Tata Salt chhabbis rupaye")).toEqual({
      name: "tata salt",
      sellingPrice: 26,
    });
    // The same shop with the mic in hi-IN gets Devanagari back.
    expect(parseProductVoiceAnswer("name", "टाटा नमक छब्बीस रुपये")).toEqual({
      name: "टाटा नमक",
      sellingPrice: 26,
    });
  });

  it("takes the pack size that rides along with the price", () => {
    expect(parseProductVoiceAnswer("name", "surf excel 1 kg 120 rupaye")).toMatchObject({
      name: "surf excel",
      packSizeValue: 1,
      packSizeUnit: "kg",
      sellingPrice: 120,
    });
  });

  it("puts the words on the field that was actually asked for", () => {
    // Asked which brand, the same sentence means the words are the brand.
    expect(parseProductVoiceAnswer("brand", "Amul 58 rupaye")).toMatchObject({
      brand: "amul",
      sellingPrice: 58,
    });
  });
});

describe("names that only look like they carry numbers", () => {
  it.each([
    ["5 star chocolate", "5 star chocolate"],
    ["seven up", "seven up"],
    ["cost cutter soap", "cost cutter soap"],
    // No money word, so the pack size stays in the name rather than being
    // guessed at. Losing a pack size is recoverable on the form; losing the
    // name the question asked for is not.
    ["colgate 200 gram", "colgate 200 gram"],
  ])("keeps %s whole", (spoken, name) => {
    expect(parseProductVoiceAnswer("name", spoken)).toEqual({ name });
  });
});

describe("the prices a counter says out loud", () => {
  it.each([
    ["gyarah", 11], ["pandrah", 15], ["unnis", 19], ["chhabbis", 26], ["paintis", 35],
    ["paintalis", 45], ["pachpan", 55], ["saath", 60], ["pachhattar", 75], ["assi", 80],
    ["nabbe", 90], ["ninyanve", 99],
  ])("reads %s", (word, value) => {
    expect(spokenNumber(word)).toBe(value);
  });

  it.each([
    ["छब्बीस", 26], ["पैंतालीस", 45], ["पचहत्तर", 75], ["नब्बे", 90],
  ])("reads %s in Devanagari too", (word, value) => {
    expect(spokenNumber(word)).toBe(value);
  });

  it("leaves ordinary Hindi words alone", () => {
    // tera (yours), bara (big) and sola are left out of the table on purpose:
    // they would cost more in corrupted names than they earn as numbers.
    for (const word of ["tera", "bara", "sola", "namak", "chini"]) {
      expect(spokenNumber(word)).toBeUndefined();
    }
  });
});

describe("a price answered as a spoken amount", () => {
  /**
   * The free-form reader was taught that "paanch sau" is five hundred; this
   * path, which is the one the voice bar actually runs, was not. Every amount
   * with a multiplier in it was filed at a hundredth or a thousandth of what the
   * shop said — a Rs 500 MRP saved as Rs 5, and nothing on the form to say so.
   */
  it.each([
    ["paanch sau", 500],
    ["ek sau bees", 120],
    ["dedh sau", 150],
    ["do hazaar", 2000],
    ["120", 120],
  ])("reads %s as %i", (spoken, value) => {
    expect(parseProductVoiceAnswer("mrp", spoken)).toEqual({ mrp: value });
  });

  it("keeps the unit that rides on the amount", () => {
    expect(parseProductVoiceAnswer("stockQuantity", "dedh sau kg")).toMatchObject({ stockQuantity: 150 });
  });
});
