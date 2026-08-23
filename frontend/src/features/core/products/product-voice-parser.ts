/**
 * Understanding a product spoken as one ordinary sentence.
 *
 * The older product parser sliced the sentence with a regex per field, which
 * fails in the one way that matters at a counter: anything it did not recognise
 * stayed in the product NAME. "add product Tata Salt 1 kg MRP 28" filed a
 * product called "tata salt mrp" and dropped the price, and a sentence carrying
 * MRP, GST, HSN and a barcode filed "amul butter g" with every number lost.
 *
 * This module works the other way round, the way billing's new-product parser
 * already does: walk the tokens, CONSUME the ones a field claims, and whatever
 * survives is the name. A field that is not understood therefore costs its own
 * value and never corrupts the name, and adding vocabulary can only ever make
 * the name cleaner.
 *
 * Everything is bilingual because the mic already listens in hi-IN when the shop
 * works in Hindi (see voice-recognition.ts) — a Hindi shop that dictates a
 * product gets Devanagari back, so Devanagari is what has to be parsed.
 */
import {
  CONNECTOR_WORDS,
  MONEY_WORDS,
  PERCENT_WORDS,
  labelMatchesAt,
  normalizeSpokenText,
  sortedSpokenLabels,
  readSpokenAmount,
  spokenNumber,
  startsAnyLabel,
  uniqueWords,
  valueIndexAfter,
  type SpokenLabel,
} from "@/features/core/voice/voice-text";

/** A field this parser can fill from speech. */
export type ProductVoiceField =
  | "name"
  | "category"
  | "brand"
  | "unit"
  | "packSize"
  | "barcode"
  | "hsn"
  | "aliases"
  | "mrp"
  | "gstRate"
  | "costPrice"
  | "sellingPrice"
  | "minimumSellingPrice"
  | "retailPrice"
  | "wholesalePrice"
  | "stockQuantity"
  | "lowStockAlert";

export type ProductVoiceFields = {
  name?: string;
  category?: string;
  brand?: string;
  unit?: string;
  packSizeValue?: number;
  packSizeUnit?: string;
  barcode?: string;
  hsn?: string;
  aliases?: string[];
  mrp?: number;
  gstRate?: number;
  costPrice?: number;
  sellingPrice?: number;
  minimumSellingPrice?: number;
  retailPrice?: number;
  retailFromQuantity?: number;
  wholesalePrice?: number;
  wholesaleFromQuantity?: number;
  stockQuantity?: number;
  lowStockAlert?: number;
};

/**
 * Spoken labels for each field, in English, Hinglish and Devanagari.
 *
 * Order inside a field does not matter; order BETWEEN entries does not either,
 * because matching always tries the longest label first. That is what keeps
 * "cost price" from being read as the "price" (selling) label, and "low stock"
 * from being read as "stock".
 */
const FIELD_LABELS: Record<ProductVoiceField, string[]> = {
  name: ["product name", "item name", "name", "naam", "नाम", "प्रोडक्ट का नाम"],
  category: ["category", "categorie", "cat", "shreni", "श्रेणी", "कैटेगरी", "केटेगरी"],
  brand: ["brand", "company", "kampani", "ब्रांड", "ब्रँड", "कंपनी", "कम्पनी"],
  unit: ["unit", "sold as", "इकाई", "यूनिट"],
  packSize: ["pack size", "pack of", "packet of", "pack", "पैक साइज", "पैक", "पैकेट"],
  barcode: ["barcode", "bar code", "ean", "बारकोड", "बार कोड"],
  hsn: ["hsn code", "hsn", "एचएसएन"],
  aliases: [
    "aliases",
    "alias",
    "also called",
    "also known as",
    "dusra naam",
    "doosra naam",
    "उपनाम",
    "दूसरा नाम",
  ],
  // "printed price" and छपा दाम are how a shopkeeper describes the figure on the
  // packet when the letters M-R-P are not what the recogniser heard.
  mrp: ["mrp", "m r p", "printed price", "packet price", "एमआरपी", "छपा दाम", "प्रिंट रेट"],
  gstRate: ["gst rate", "gst", "tax", "जीएसटी", "टैक्स", "कर"],
  costPrice: [
    "cost price",
    "purchase price",
    "buying price",
    "average cost",
    "avg cost",
    "cost",
    "kharid",
    "khareed",
    "kharidi",
    "खरीद दाम",
    "खरीद",
    "लागत",
    "कॉस्ट",
  ],
  sellingPrice: [
    "selling price",
    "sale price",
    "sell price",
    "selling",
    "sell",
    "price",
    "rate",
    "daam",
    "bhav",
    "keemat",
    "बिक्री दाम",
    "बिक्री",
    "दाम",
    "भाव",
    "कीमत",
    "रेट",
  ],
  minimumSellingPrice: [
    "minimum selling price",
    "minimum selling",
    "minimum price",
    "min price",
    "minimum",
    "min",
    "kam se kam",
    "न्यूनतम",
    "कम से कम",
  ],
  retailPrice: ["retail price", "retail", "khudra", "खुदरा"],
  wholesalePrice: ["wholesale price", "wholesale", "thok", "थोक"],
  stockQuantity: [
    "opening stock",
    "stock",
    "quantity",
    "qty",
    "maal",
    "स्टॉक",
    "मात्रा",
    "माल",
  ],
  lowStockAlert: [
    "low stock alert",
    "low stock",
    "reorder level",
    "reorder",
    "alert",
    "कम स्टॉक",
    "अलर्ट",
  ],
};

/** Fields that carry a number. Everything else takes words. */
const NUMERIC_FIELDS = new Set<ProductVoiceField>([
  "mrp",
  "gstRate",
  "costPrice",
  "sellingPrice",
  "minimumSellingPrice",
  "retailPrice",
  "wholesalePrice",
  "stockQuantity",
  "lowStockAlert",
  "packSize",
]);

/** Identifiers are digit strings, not quantities — "hsn 0405" must keep its zero. */
const CODE_FIELDS = new Set<ProductVoiceField>(["barcode", "hsn"]);

const UNIT_WORDS: Record<string, string> = {
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  किलो: "kg",
  किलोग्राम: "kg",
  g: "gram",
  gm: "gram",
  gms: "gram",
  gram: "gram",
  grams: "gram",
  ग्राम: "gram",
  ml: "ml",
  मिली: "ml",
  मिलीलीटर: "ml",
  litre: "litre",
  liter: "litre",
  litres: "litre",
  liters: "litre",
  ltr: "litre",
  l: "litre",
  लीटर: "litre",
  piece: "piece",
  pieces: "piece",
  pcs: "piece",
  pc: "piece",
  नग: "piece",
  पीस: "piece",
  packet: "packet",
  packets: "packet",
  pkt: "packet",
  पैकेट: "packet",
  box: "box",
  boxes: "box",
  डिब्बा: "box",
  tablet: "tablet",
  tablets: "tablet",
  गोली: "tablet",
  dozen: "dozen",
  दर्जन: "dozen",
};

/** Opens a command without describing the product — dropped from the name. */
const TRIGGER_WORDS = new Set([
  "add",
  "create",
  "new",
  "make",
  "save",
  "register",
  "edit",
  "update",
  "change",
  "customise",
  "customize",
  "product",
  "products",
  "item",
  "items",
  "naya",
  "nayi",
  "naye",
  "jodo",
  "daalo",
  "dalo",
  "banao",
  "aitam",
  "samaan",
  "saman",
  "नया",
  "नई",
  "नयी",
  "नए",
  "जोड़ो",
  "जोड़",
  "डालो",
  "बनाओ",
  "प्रोडक्ट",
  "आइटम",
  "सामान",
  "माल",
  "जोड़ें",
]);

/** Introduces the quantity a slab price starts at — "retail 45 from 1 kg". */
const FROM_WORDS = new Set(["from", "se", "से", "upar", "ऊपर"]);

/**
 * Lowercase, fold Devanagari digits to ASCII, drop punctuation.
 *
 * Deliberately not billing's normalizeSearchText: that strips the decimal point
 * along with every other non-letter, which turns a spoken "45.50" into two
 * separate numbers. A price parser cannot afford that, so the dot survives
 * between digits and is stripped everywhere else.
 */
export function normalizeProductVoiceText(text: string): string {
  return normalizeSpokenText(text);
}

function unitOf(token: string | undefined): string | undefined {
  if (!token) return undefined;
  return UNIT_WORDS[token];
}

/** Every label, longest first, so "cost price" is claimed before "price". */
const SORTED_LABELS: SpokenLabel<ProductVoiceField>[] = sortedSpokenLabels(FIELD_LABELS);

/**
 * Read every field a sentence states, and take the name from what is left over.
 *
 * Safe to call on a fragment as well as a whole sentence: dictating "cost 40"
 * on its own returns only costPrice, which is what lets the same parser serve
 * both one long sentence and a field-at-a-time conversation.
 */
export function parseSpokenProductFields(spoken: string): ProductVoiceFields {
  const tokens = normalizeProductVoiceText(spoken).split(" ").filter(Boolean);
  if (!tokens.length) return {};

  const consumed = new Set<number>();
  const fields: ProductVoiceFields = {};
  const aliasWords: string[] = [];

  const claim = (from: number, to: number) => {
    for (let index = from; index <= to; index += 1) consumed.add(index);
  };

  // Pass 1 — labelled values. A label only wins when the thing after it is the
  // right SHAPE (a number for a price, a word for a category), so "salt" in
  // "sendha salt rate 20" cannot be mistaken for a label with no value.
  // A field can be filled twice over: "stock 25 kg" states the unit as a side
  // effect and a later "unit kg" states it outright. The explicit mention is the
  // one to trust, and either way BOTH label runs have to be consumed — a label
  // left unconsumed because its field was already set is exactly how "unit" ends
  // up inside the product name.
  const explicit = new Set<ProductVoiceField>();

  for (const { field, tokens: label } of SORTED_LABELS) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (!labelMatchesAt(tokens, index, label, consumed)) continue;
      const alreadyStated = field === "aliases" ? aliasWords.length > 0 : explicit.has(field);
      const labelEnd = index + label.length - 1;
      const valueAt = valueIndexAfter(tokens, labelEnd + 1, consumed);
      if (valueAt >= tokens.length || consumed.has(valueAt)) continue;

      if (CODE_FIELDS.has(field)) {
        // Kept as text: a barcode is 13 digits and an HSN can lead with a zero,
        // both of which Number() would quietly destroy.
        if (!/^\d{3,}$/.test(tokens[valueAt])) continue;
        if (!alreadyStated) {
          assignCode(fields, field, tokens[valueAt]);
          explicit.add(field);
        }
        claim(index, valueAt);
        continue;
      }

      if (NUMERIC_FIELDS.has(field)) {
        // "mrp paanch sau" is 500. Read one token at a time it came back as 5,
        // which put a hundredth of the real price on the shelf label.
        const amount = readSpokenAmount(tokens, valueAt);
        if (amount === undefined) continue;
        const { value, end: valueEnd } = amount;
        claim(index, valueEnd);

        // A unit riding on the value belongs to this field: "stock 25 kg" says
        // the stock is in kilos, "pack of 500 gram" sizes the pack.
        const trailingUnit = unitOf(tokens[valueEnd + 1]);
        if (trailingUnit) claim(valueEnd + 1, valueEnd + 1);

        if (!alreadyStated) {
          applyNumeric(fields, field, value, trailingUnit);
          explicit.add(field);
        }
        consumeMoneyAndPercentAround(tokens, valueAt, valueEnd, consumed, claim);

        // "retail 45 from 1 kg" — the quantity the slab starts at.
        if (field === "retailPrice" || field === "wholesalePrice") {
          const fromAt = trailingUnit ? valueEnd + 2 : valueEnd + 1;
          if (FROM_WORDS.has(tokens[fromAt] ?? "")) {
            const slabValue = spokenNumber(tokens[fromAt + 1]);
            if (slabValue !== undefined) {
              if (field === "retailPrice") fields.retailFromQuantity = slabValue;
              else fields.wholesaleFromQuantity = slabValue;
              claim(fromAt, fromAt + 1);
              if (unitOf(tokens[fromAt + 2])) claim(fromAt + 2, fromAt + 2);
            }
          }
        }
        continue;
      }

      // Word-valued fields run until the next label, number or unit word.
      const words = takeWords(tokens, valueAt, consumed, field === "aliases" ? 12 : 4);
      if (!words.length) continue;
      claim(index, valueAt + words.length - 1);
      if (field === "aliases") {
        aliasWords.push(...words);
        continue;
      }
      // `unit` is allowed past `alreadyStated` because the only way it can already
      // hold a value here is the side effect of a stock or pack figure, and a shop
      // that says "unit kg" outright means it.
      if (alreadyStated) continue;
      explicit.add(field);

      if (field === "unit") fields.unit = unitOf(words[0]) ?? words[0];
      else if (field === "name") fields.name = words.join(" ");
      else if (field === "brand") fields.brand = words.join(" ");
      else if (field === "category") fields.category = words.join(" ");
    }
  }

  if (aliasWords.length) fields.aliases = uniqueWords(aliasWords);

  // Pass 2 — a bare "<number> <unit>" with no label of its own. On a packet this
  // is its size ("Tata Salt 1 kg", "amul butter 500 g"), which is also the read
  // that keeps those tokens out of the product name.
  if (fields.packSizeValue === undefined) {
    for (let index = 0; index < tokens.length - 1; index += 1) {
      if (consumed.has(index) || consumed.has(index + 1)) continue;
      const value = spokenNumber(tokens[index]);
      const unit = unitOf(tokens[index + 1]);
      if (value === undefined || !unit || value <= 0) continue;
      fields.packSizeValue = value;
      fields.packSizeUnit = unit;
      claim(index, index + 1);
      break;
    }
  }

  // Pass 3 — the name is the residue: whatever no field claimed, minus the words
  // that only ever open a command. This is the whole point of the design; a field
  // this parser cannot read costs its own value and never pollutes the name.
  if (fields.name === undefined) {
    // Unit words are NOT filtered here. Any unit that meant a measurement was
    // already consumed next to its number, so one still standing alone is part of
    // what the thing is called — "Parle G" is a biscuit, not 0 grams of Parle.
    const leftover = tokens
      .filter((token, index) => !consumed.has(index))
      .filter(
        (token) =>
          !TRIGGER_WORDS.has(token) &&
          !CONNECTOR_WORDS.has(token) &&
          !MONEY_WORDS.has(token) &&
          !PERCENT_WORDS.has(token) &&
          !FROM_WORDS.has(token) &&
          spokenNumber(token) === undefined,
      );
    const name = leftover.join(" ").trim();
    // One stray syllable is a mishearing, not something worth naming a product.
    if (name.length >= 2) fields.name = name;
  }

  return fields;
}

/** Words up to the next label, number or unit — the value of a word-valued field. */
function takeWords(tokens: string[], start: number, consumed: Set<number>, limit: number) {
  const words: string[] = [];
  for (let index = start; index < tokens.length && words.length < limit; index += 1) {
    if (consumed.has(index)) break;
    const token = tokens[index];
    if (spokenNumber(token) !== undefined) break;
    if (MONEY_WORDS.has(token) || PERCENT_WORDS.has(token)) break;
    if (TRIGGER_WORDS.has(token) || CONNECTOR_WORDS.has(token)) break;
    if (startsAnyLabel(SORTED_LABELS, tokens, index, consumed)) break;
    words.push(token);
  }
  return words;
}

/** Whether the sentence names a field out loud, rather than just holding values. */
export function statesAFieldLabel(spoken: string): boolean {
  const tokens = normalizeProductVoiceText(spoken).split(" ").filter(Boolean);
  const none = new Set<number>();
  return tokens.some((_token, index) => startsAnyLabel(SORTED_LABELS, tokens, index, none));
}

/** "40 rupees" and "5 percent" — the carrier word is not part of the name. */
function consumeMoneyAndPercentAround(
  tokens: string[],
  valueAt: number,
  valueEnd: number,
  consumed: Set<number>,
  claim: (from: number, to: number) => void,
) {
  const before = tokens[valueAt - 1];
  // A multi-token amount ("paanch sau") pushes the trailing rupees/percent past
  // where the value started, so the two ends are tracked separately.
  const after = tokens[valueEnd + 1];
  if (before && (MONEY_WORDS.has(before) || PERCENT_WORDS.has(before)) && !consumed.has(valueAt - 1)) {
    claim(valueAt - 1, valueAt - 1);
  }
  if (after && (MONEY_WORDS.has(after) || PERCENT_WORDS.has(after)) && !consumed.has(valueEnd + 1)) {
    claim(valueEnd + 1, valueEnd + 1);
  }
}

function assignCode(fields: ProductVoiceFields, field: ProductVoiceField, value: string) {
  if (field === "barcode") fields.barcode = value;
  else fields.hsn = value;
}

function applyNumeric(
  fields: ProductVoiceFields,
  field: ProductVoiceField,
  value: number,
  trailingUnit: string | undefined,
) {
  if (field === "packSize") {
    fields.packSizeValue = value;
    if (trailingUnit) fields.packSizeUnit = trailingUnit;
    return;
  }
  if (field === "stockQuantity") {
    fields.stockQuantity = value;
    // "stock 25 kg" is also the shop telling us what this product is measured in.
    if (trailingUnit && fields.unit === undefined) fields.unit = trailingUnit;
    return;
  }
  if (trailingUnit && fields.unit === undefined && field !== "gstRate") fields.unit = trailingUnit;
  (fields as Record<string, number>)[field] = value;
}

/**
 * Read a reply given while one specific field is being asked for.
 *
 * A bare "28" answering "MRP?" has no label to find, so the pending field
 * supplies it. A reply that DOES name fields is treated as a correction and
 * parsed in full instead — that is what lets someone answer "MRP?" with "no,
 * cost is 24" and have it land in the right box.
 */
export function parseProductVoiceAnswer(field: ProductVoiceField, spoken: string): ProductVoiceFields {
  // Both halves of this test matter. Values alone are not enough — answering "how
  // much stock?" with "50 kg" parses as a PACK SIZE when read on its own, and the
  // pending question is the only thing that says otherwise. A label alone is not
  // enough either: a product really called "cost cutter soap" contains a label
  // and states nothing.
  const parsed = parseSpokenProductFields(spoken);
  const named = Object.keys(parsed).filter((key) => key !== "name");
  if (named.length > 0 && statesAFieldLabel(spoken)) return parsed;

  const tokens = normalizeProductVoiceText(spoken).split(" ").filter(Boolean);
  if (!tokens.length) return {};

  if (CODE_FIELDS.has(field)) {
    const digits = tokens.find((token) => /^\d{3,}$/.test(token));
    if (!digits) return {};
    const coded: ProductVoiceFields = {};
    assignCode(coded, field, digits);
    return coded;
  }

  if (NUMERIC_FIELDS.has(field)) {
    const at = tokens.findIndex((token) => spokenNumber(token) !== undefined);
    if (at === -1) return {};
    const value = spokenNumber(tokens[at]);
    if (value === undefined) return {};
    const numeric: ProductVoiceFields = {};
    applyNumeric(numeric, field, value, unitOf(tokens[at + 1]));
    return numeric;
  }

  if (field === "unit") {
    const unit = tokens.map((token) => unitOf(token)).find(Boolean);
    return unit ? { unit } : { unit: tokens[0] };
  }

  // Whatever was said, minus the words that only ever open a command.
  const words = tokens.filter((token) => !TRIGGER_WORDS.has(token) && !CONNECTOR_WORDS.has(token));
  if (!words.length) return {};
  if (field === "aliases") return { aliases: uniqueWords(words) };
  if (field === "brand") return { brand: words.join(" ") };
  if (field === "category") return { category: words.join(" ") };
  return { name: words.join(" ") };
}
