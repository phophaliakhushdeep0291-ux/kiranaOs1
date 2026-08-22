import {
  BillInputBillType,
  BillPaymentMode,
  type Product,
} from "@/lib/api/client";
import type {
  PaymentSelection,
  VoiceNewProductLine,
  VoiceParsedDraft,
  VoiceParsedLine,
} from "./billing-types";
import { SPLIT_PAYMENT } from "./billing-types";
import {
  normalizeSearchText,
  productSellingPrice,
  roundMoney,
  roundQuantity,
} from "./billing-calculations";

export const VOICE_NUMBER_WORDS: Record<string, number> = {
  ek: 1,
  one: 1,
  do: 2,
  two: 2,
  teen: 3,
  three: 3,
  char: 4,
  chaar: 4,
  four: 4,
  panch: 5,
  paanch: 5,
  five: 5,
  che: 6,
  chhe: 6,
  six: 6,
  saat: 7,
  seven: 7,
  aath: 8,
  eight: 8,
  nau: 9,
  nine: 9,
  dus: 10,
  das: 10,
  ten: 10,
  aadha: 0.5,
  half: 0.5,
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
  छह: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  आधा: 0.5,
  // Everything above stops at ten, which is the wrong range for a BILLING feature:
  // counter prices are twenty, thirty, fifty, a hundred. "naya maggi bees rupaye"
  // returned null and the item was silently never created, while the same sentence
  // with "das" worked — so the feature appeared to work and failed on real prices.
  //
  // Digits are unaffected and always were ("20", "२०" both parse), which is what a
  // recogniser usually returns; these cover the case where it transcribes the word.
  gyarah: 11, ग्यारह: 11,
  barah: 12, बारह: 12,
  terah: 13, तेरह: 13,
  chaudah: 14, चौदह: 14,
  pandrah: 15, पंद्रह: 15,
  solah: 16, सोलह: 16,
  satrah: 17, सत्रह: 17,
  atharah: 18, अठारह: 18,
  unnis: 19, उन्नीस: 19,
  bees: 20, बीस: 20,
  pachchis: 25, pachees: 25, पच्चीस: 25,
  tees: 30, तीस: 30,
  chalis: 40, chalees: 40, चालीस: 40,
  pachas: 50, pachaas: 50, पचास: 50,
  // 60 is Devanagari-only on purpose: romanised "saath" is how people write BOTH
  // saath (60) and saat (7), and 7 is already spoken far more often at a counter.
  // Guessing wrong here misprices a bill, so the ambiguous spelling stays out.
  साठ: 60,
  sattar: 70, सत्तर: 70,
  assi: 80, अस्सी: 80,
  nabbe: 90, नब्बे: 90,
  sau: 100, सौ: 100,
  hazar: 1000, hazaar: 1000, हजार: 1000, "हज़ार": 1000,
  // Fractions a counter says constantly for weight: "dedh kilo", "dhai kilo".
  sava: 1.25, सवा: 1.25,
  dedh: 1.5, "डेढ़": 1.5, डेढ: 1.5,
  dhai: 2.5, ढाई: 2.5,
  paun: 0.75, पौन: 0.75,
};

const MONEY_WORDS = new Set([
  "rs",
  "rupay",
  // "rupaye" is how the romanised word is usually written, and it was the one
  // spelling missing: "naya maggi bees rupaye" returned null even after the number
  // table learned "bees", because the price marker beside it was not a money word.
  "rupaye",
  "rupaya",
  "rupaiya",
  "rupaiye",
  "rupee",
  "rupees",
  "price",
  "rate",
  "at",
  "₹",
  // Hindi, in both scripts. A counter dictating in Hindi says the price as often as it
  // says the item, and without these the number beside it reads as a quantity.
  "daam",
  "bhav",
  "रुपये",
  "रुपए",
  "रुपया",
  "रुपय",
  "रु",
  "दाम",
  "भाव",
  "रेट",
]);
const UNIT_WORDS = new Set([
  "kg",
  "kilo",
  "kilogram",
  "kilos",
  "gram",
  "grams",
  "g",
  "gm",
  "litre",
  "liter",
  "l",
  "ltr",
  "ml",
  "packet",
  "pkt",
  "pack",
  "piece",
  "pc",
  "pcs",
  "box",
  "dozen",
  // Devanagari spellings of the same units.
  "किलो",
  "ग्राम",
  "लीटर",
  "मिली",
  "पैकेट",
  "पैकिट",
  "पीस",
  "डिब्बा",
  "दर्जन",
]);

export function parseVoiceNumber(token: string): number | undefined {
  const normalized = normalizeSearchText(token);
  const value = Number(normalized);
  if (Number.isFinite(value)) return value;
  return VOICE_NUMBER_WORDS[normalized];
}

export function normalizeVoiceUnit(
  token: string | undefined,
  fallback: string,
): string {
  const unit = normalizeSearchText(token ?? "");
  if (["kg", "kilo", "kilogram", "kilos", "किलो"].includes(unit)) return "kg";
  if (["gram", "grams", "g", "gm", "ग्राम"].includes(unit)) return "g";
  if (["litre", "liter", "l", "ltr", "लीटर"].includes(unit)) return "litre";
  if (["ml", "मिली"].includes(unit)) return "ml";
  if (["packet", "pkt", "pack", "पैकेट", "पैकिट"].includes(unit)) return "packet";
  if (["piece", "pc", "pcs", "पीस"].includes(unit)) return "piece";
  if (["box", "डिब्बा"].includes(unit)) return "box";
  if (["dozen", "दर्जन"].includes(unit)) return "dozen";
  return fallback;
}

function isUnitWord(token: string | undefined) {
  return Boolean(token && UNIT_WORDS.has(normalizeSearchText(token)));
}

export function voiceProductAliases(product: Product): string[] {
  return [product.name, ...(product.aliases ?? [])]
    .map((value) => normalizeSearchText(value))
    .filter((value) => value.length >= 2)
    .sort((a, b) => b.length - a.length);
}

function findAliasTokenIndex(tokens: string[], alias: string): number {
  const aliasTokens = alias.split(" ").filter(Boolean);
  if (aliasTokens.length === 0) return -1;
  for (let index = 0; index <= tokens.length - aliasTokens.length; index += 1) {
    const matches = aliasTokens.every(
      (token, offset) => tokens[index + offset] === token,
    );
    if (matches) return index;
  }
  return -1;
}

type QuantityParse = {
  quantity: number;
  unit: string;
  explicitQuantity: boolean;
  consumedAfterIndexes: Set<number>;
};

function parseQuantityAroundAlias(
  beforeTokens: string[],
  afterTokens: string[],
  fallbackUnit: string,
): QuantityParse {
  const consumedAfterIndexes = new Set<number>();

  for (let index = beforeTokens.length - 1; index >= 0; index -= 1) {
    const number = parseVoiceNumber(beforeTokens[index]);
    if (number === undefined) continue;
    return {
      quantity: roundQuantity(number),
      unit: normalizeVoiceUnit(beforeTokens[index + 1], fallbackUnit),
      explicitQuantity: true,
      consumedAfterIndexes,
    };
  }

  if (afterTokens.length >= 2) {
    const firstNumber = parseVoiceNumber(afterTokens[0]);
    if (firstNumber !== undefined && isUnitWord(afterTokens[1])) {
      consumedAfterIndexes.add(0);
      consumedAfterIndexes.add(1);
      return {
        quantity: roundQuantity(firstNumber),
        unit: normalizeVoiceUnit(afterTokens[1], fallbackUnit),
        explicitQuantity: true,
        consumedAfterIndexes,
      };
    }
  }

  if (isUnitWord(afterTokens[0])) {
    consumedAfterIndexes.add(0);
    return {
      quantity: 1,
      unit: normalizeVoiceUnit(afterTokens[0], fallbackUnit),
      explicitQuantity: true,
      consumedAfterIndexes,
    };
  }

  return {
    quantity: 1,
    unit: fallbackUnit,
    explicitQuantity: false,
    consumedAfterIndexes,
  };
}

function parseRateAfterAlias(
  afterTokens: string[],
  consumedIndexes: Set<number>,
  fallback: number,
) {
  const candidates: number[] = [];
  afterTokens.forEach((token, index) => {
    if (consumedIndexes.has(index)) return;
    const number = parseVoiceNumber(token);
    if (number === undefined) return;

    const next = afterTokens[index + 1] ?? "";
    const prev = afterTokens[index - 1] ?? "";
    const nextIsQuantityUnit =
      isUnitWord(next) && !MONEY_WORDS.has(normalizeSearchText(prev));
    const prevIsMoneyMarker = MONEY_WORDS.has(normalizeSearchText(prev));
    const nextIsMoneyMarker = MONEY_WORDS.has(normalizeSearchText(next));

    if (nextIsQuantityUnit) return;
    if (
      prevIsMoneyMarker ||
      nextIsMoneyMarker ||
      index >= 1 ||
      consumedIndexes.size > 0
    ) {
      candidates.push(number);
    }
  });
  return roundMoney(
    candidates.length > 0 ? candidates[candidates.length - 1] : fallback,
  );
}

export function parseVoiceLine(
  segment: string,
  product: Product,
): VoiceParsedLine | null {
  const normalized = normalizeSearchText(segment);
  const tokens = normalized.split(" ").filter(Boolean);
  const alias = voiceProductAliases(product).find((candidate) =>
    normalized.includes(candidate),
  );
  if (!alias) return null;
  const aliasIndex = findAliasTokenIndex(tokens, alias);
  const aliasLength = alias.split(" ").filter(Boolean).length || 1;
  const fallbackUnit = product.rateUnit ?? product.displayUnit ?? "piece";

  const beforeTokens =
    aliasIndex >= 0
      ? tokens.slice(Math.max(0, aliasIndex - 5), aliasIndex)
      : tokens;
  const afterTokens =
    aliasIndex >= 0 ? tokens.slice(aliasIndex + aliasLength) : tokens;
  const quantity = parseQuantityAroundAlias(
    beforeTokens,
    afterTokens,
    fallbackUnit,
  );
  const rate = parseRateAfterAlias(
    afterTokens,
    quantity.consumedAfterIndexes,
    productSellingPrice(product, quantity.quantity),
  );

  return {
    product,
    quantity: quantity.quantity,
    unit: quantity.unit,
    rate,
    source: segment.trim(),
  };
}

/** Words that only ever mean "this is a new item", never part of its name. */
/**
 * Hindi particles that glue a price to an item ("rusk KA daam 25"). They are grammar,
 * not part of what the thing is called, so they are dropped from the name — otherwise
 * the catalogue fills up with "rusk ka".
 */
// "item" is how people actually say it — "add new item sabun" — and without it
// here the word survives into the name, creating a product called "item sabun".
const NAME_FILLER_WORDS = new Set(["ka", "ke", "ki", "का", "के", "की", "item", "आइटम", "aitam"]);

const NEW_PRODUCT_WORDS = new Set([
  "add", "new", "naya", "nayi", "naye", "jodo", "daalo", "dalo",
  "नया", "नई", "नयी", "नए", "जोड़ो", "जोड़", "डालो",
]);

/**
 * An item the catalogue does not have, priced well enough to bill right now.
 *
 * Only ever called for a segment that matched no product. The bar for proposing one is
 * a stated PRICE — "parle biscuit forty rupees", "add rusk at 25" — because that is the
 * one thing a bill line cannot be invented without, and because a bare trailing number
 * is far more likely to be a quantity ("do packet rusk") than a price. Getting that
 * wrong would quietly put a ₹2 product in the catalogue, so a number with no money word
 * beside it is left alone and the segment stays unmatched.
 *
 * The name is whatever is left once the quantity, the price and the words that carried
 * them are removed, so "add 2 packet rusk at 25 rupees" names the product "rusk".
 */
export function parseNewProductLine(segment: string): VoiceNewProductLine | null {
  const tokens = normalizeSearchText(segment).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  const consumed = new Set<number>();

  let sellingPrice: number | undefined;
  tokens.forEach((token, index) => {
    if (sellingPrice !== undefined) return;
    const value = parseVoiceNumber(token);
    if (value === undefined) return;
    const previous = tokens[index - 1] ?? "";
    const next = tokens[index + 1] ?? "";
    // A money word on either side is what separates a price from a count.
    if (!MONEY_WORDS.has(previous) && !MONEY_WORDS.has(next)) return;
    sellingPrice = value;
    consumed.add(index);
    if (MONEY_WORDS.has(previous)) consumed.add(index - 1);
    if (MONEY_WORDS.has(next)) consumed.add(index + 1);
  });
  if (sellingPrice === undefined || !(sellingPrice > 0)) return null;

  let quantity = 1;
  let unit = "piece";
  tokens.forEach((token, index) => {
    if (consumed.has(index)) return;
    const value = parseVoiceNumber(token);
    if (value === undefined || !(value > 0)) return;
    const next = tokens[index + 1] ?? "";
    if (!isUnitWord(next)) return;
    quantity = value;
    unit = normalizeVoiceUnit(next, "piece");
    consumed.add(index);
    consumed.add(index + 1);
  });

  const name = tokens
    .filter((token, index) =>
      !consumed.has(index)
      && !NEW_PRODUCT_WORDS.has(token)
      && !NAME_FILLER_WORDS.has(token)
      && !MONEY_WORDS.has(token)
      && !isUnitWord(token)
      && parseVoiceNumber(token) === undefined)
    .join(" ")
    .trim();
  // One stray syllable is a mishearing, not a product worth creating.
  if (name.length < 2) return null;

  return { name, sellingPrice, quantity, unit, source: segment.trim() };
}

function parseCustomerName(command: string) {
  const patterns = [
    /^\s*(.+?)\s+(?:ke\s+naam|के\s+नाम)(?=\s|$)/i,
    /\b(?:customer|naam|name)\s+([a-zA-Z\u0900-\u097f][a-zA-Z\u0900-\u097f\s]{1,40}?)(?:\s+(?:paid|cash|upi|udhar|bill|ke|के|उधार|नकद|\d)|$)/i,
    // A Devanagari label takes exactly one word. The pattern above ends a name at a
    // digit and Hindi counts in words, so "ग्राहक रमेश दो किलो" ran past the
    // name and would have filed a customer called "रमेश दो किलो".
    /(?:^|\s)(?:नाम|ग्राहक)\s+([\u0900-\u097f]{2,20})(?=\s|$)/,
  ];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    const name = match?.[1]?.trim().replace(/\s+/g, " ");
    if (name && name.length >= 2) return name;
  }
  return undefined;
}

function amountBeforeLabel(normalized: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(
    new RegExp(
      `(\\d+(?:\\.\\d+)?)\\s*(?:rs|rupay|rupee|rupees)?\\s*${escaped}\\b`,
      "i",
    ),
  );
  return match ? Number(match[1]) : undefined;
}

function amountAfterLabel(normalized: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(
    new RegExp(
      `\\b${escaped}\\s*(?:rs|rupay|rupee|rupees)?\\s*(\\d+(?:\\.\\d+)?)`,
      "i",
    ),
  );
  return match ? Number(match[1]) : undefined;
}

function parsePaymentAmounts(normalized: string) {
  const cashAmount =
    amountBeforeLabel(normalized, "cash") ??
    amountAfterLabel(normalized, "cash");
  const upiAmount =
    amountBeforeLabel(normalized, "upi") ??
    amountBeforeLabel(normalized, "phonepe") ??
    amountBeforeLabel(normalized, "gpay") ??
    amountBeforeLabel(normalized, "paytm") ??
    amountAfterLabel(normalized, "upi") ??
    amountAfterLabel(normalized, "phonepe") ??
    amountAfterLabel(normalized, "gpay") ??
    amountAfterLabel(normalized, "paytm");
  const paidAmount =
    amountAfterLabel(normalized, "paid") ??
    amountAfterLabel(normalized, "pay") ??
    amountAfterLabel(normalized, "payment");
  return {
    cashAmount: cashAmount !== undefined ? roundMoney(cashAmount) : undefined,
    upiAmount: upiAmount !== undefined ? roundMoney(upiAmount) : undefined,
    paidAmount: paidAmount !== undefined ? roundMoney(paidAmount) : undefined,
  };
}

function parsePaymentMode(
  normalized: string,
  cashAmount?: number,
  upiAmount?: number,
): PaymentSelection | undefined {
  if (/\b(make|create)?\s*udhar\s+bill\b|\budhar\s+bill\b/.test(normalized))
    return BillPaymentMode.credit;
  if (cashAmount !== undefined && upiAmount !== undefined) return SPLIT_PAYMENT;
  if (/\bmake\s+cash\s+bill\b|\bcash\s+bill\b/.test(normalized))
    return BillPaymentMode.cash;
  if (/\bmake\s+upi\s+bill\b|\bupi\s+bill\b/.test(normalized))
    return BillPaymentMode.upi;
  if (cashAmount !== undefined) return BillPaymentMode.cash;
  if (upiAmount !== undefined) return BillPaymentMode.upi;
  return undefined;
}

function buildFingerprint(
  draft: Omit<VoiceParsedDraft, "fingerprint" | "requiresConfirmation">,
) {
  return normalizeSearchText(
    [
      draft.sourceCommand,
      draft.customerName ?? "",
      draft.paymentMode ?? "",
      draft.billType ?? "",
      draft.udharAmount ?? "",
      draft.paidAmount ?? "",
      draft.cashAmount ?? "",
      draft.upiAmount ?? "",
      ...draft.lines.map(
        (line) =>
          `${line.product.id}:${line.quantity}:${line.unit}:${line.rate}`,
      ),
    ].join("|"),
  );
}

function stripBillingDirectives(command: string) {
  return command
    .replace(/^\s*[^,]+?\s+(?:ke\s+naam|के\s+नाम)(?=\s|$)/i, "")
    .replace(
      /\b(?:customer|naam|name)\s+[a-zA-Z\u0900-\u097f][a-zA-Z\u0900-\u097f\s]{1,40}?(?=\s+(?:paid|cash|upi|udhar|bill|के|उधार|नकद|\d)|$)/gi,
      "",
    )
    .replace(/(?:^|\s)(?:नाम|ग्राहक)\s+[\u0900-\u097f]{2,20}(?=\s|$)/g, "")
    .replace(/\bmake\s+(?:cash|upi|udhar)\s+bill\b/gi, "")
    .replace(
      /\b(?:paid|pay|payment)\s*(?:rs|rupay|rupee|rupees)?\s*\d+(?:\.\d+)?\b/gi,
      "",
    )
    .replace(
      /\b\d+(?:\.\d+)?\s*(?:rs|rupay|rupee|rupees)?\s*(?:cash|upi|phonepe|gpay|paytm|udhar)\b/gi,
      "",
    )
    .trim();
}

function hasCartLikeWords(normalized: string) {
  return /\b(add|kg|kilo|gram|gm|packet|piece|pcs|liter|litre|rupay|rupee|rs|₹|chini|sugar|atta|tel|oil)\b/.test(
    normalized,
  );
}

/**
 * Hindi tender words, mapped onto the English labels the payment rules already read.
 *
 * The alternative was Devanagari alternatives inside a dozen separate regexes, each of
 * which ends its label on an ASCII word boundary that never fires after "उधार" — so
 * every one of them would have needed its terminator rewritten too. Translating the
 * handful of tender words once, up front, leaves those rules exactly as they are.
 *
 * Plain string swaps rather than a regex: these are whole words in a script with no
 * case, and the money they decide is real.
 */
const TENDER_WORD_PAIRS: Array<[string, string]> = [
  ["उधारी", "udhar"],
  ["उधार", "udhar"],
  ["नकद", "cash"],
  ["नक़द", "cash"],
  ["दिया", "paid"],
  ["दिये", "paid"],
  ["दिए", "paid"],
];

export function withEnglishTenderWords(text: string): string {
  let out = text;
  for (const [hindi, english] of TENDER_WORD_PAIRS) out = out.split(hindi).join(english);
  return out;
}

export function parseBillingVoiceCommand(
  command: string,
  products: Product[],
): VoiceParsedDraft {
  const warnings: string[] = [];
  const tenderCommand = withEnglishTenderWords(command);
  const normalized = normalizeSearchText(tenderCommand);
  const customerName = parseCustomerName(command);
  const udharAmount = amountBeforeLabel(normalized, "udhar");
  const paymentAmounts = parsePaymentAmounts(normalized);
  const paymentMode =
    parsePaymentMode(
      normalized,
      paymentAmounts.cashAmount,
      paymentAmounts.upiAmount,
    ) ?? (udharAmount !== undefined ? BillPaymentMode.credit : undefined);
  const billType =
    paymentMode === BillPaymentMode.credit
      ? BillInputBillType.udhar_entry
      : undefined;

  const itemCommand = stripBillingDirectives(tenderCommand)
    .replace(/\b(?:and|aur)\b/gi, ",")
    .replace(/\s+/g, " ")
    .trim();
  const rawSegments = itemCommand
    .split(/,|\baur\b|\band\b/gi)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const segments = rawSegments.length > 0 ? rawSegments : [];
  const matchedProductIds = new Set<string>();
  const lines: VoiceParsedLine[] = [];
  const newProducts: VoiceNewProductLine[] = [];

  for (const segment of segments) {
    const normalizedSegment = normalizeSearchText(segment);
    const candidates = products.filter(
      (product) =>
        !matchedProductIds.has(product.id) &&
        voiceProductAliases(product).some((alias) =>
          normalizedSegment.includes(alias),
        ),
    );
    if (candidates.length === 0) {
      // Nothing in the catalogue answers to this. If the counter priced it, offer it as
      // a product to create rather than dropping the item and stalling the bill.
      const proposed = parseNewProductLine(segment);
      if (proposed && !newProducts.some((row) => row.name === proposed.name)) {
        newProducts.push(proposed);
      }
      continue;
    }
    const product = candidates.sort(
      (a, b) =>
        voiceProductAliases(b)[0].length - voiceProductAliases(a)[0].length,
    )[0];
    const line = parseVoiceLine(segment, product);
    if (line) {
      lines.push(line);
      matchedProductIds.add(product.id);
    }
  }

  const hasNonItemDraft = Boolean(
    customerName ||
    udharAmount !== undefined ||
    paymentMode ||
    paymentAmounts.cashAmount !== undefined ||
    paymentAmounts.upiAmount !== undefined ||
    paymentAmounts.paidAmount !== undefined,
  );
  if (lines.length === 0 && newProducts.length === 0 && !hasNonItemDraft && (segments.length > 0 || hasCartLikeWords(normalized)))
    warnings.push(
      "No saved product matched this command. Add aliases/Hindi names in Products, then try again.",
    );
  if (customerName && customerName.length < 2)
    warnings.push(
      "Customer name looked incomplete. Please review before udhar billing.",
    );
  if (
    (paymentMode === BillPaymentMode.credit || udharAmount !== undefined) &&
    !customerName
  )
    warnings.push(
      "Udhar billing requires a customer before final confirmation.",
    );

  const draftWithoutFingerprint = {
    newProducts,
    customerName,
    udharAmount,
    paymentMode,
    billType,
    paidAmount: paymentAmounts.paidAmount,
    cashAmount: paymentAmounts.cashAmount,
    upiAmount: paymentAmounts.upiAmount,
    lines,
    warnings,
    sourceCommand: command.trim(),
  } satisfies Omit<VoiceParsedDraft, "fingerprint" | "requiresConfirmation">;

  return {
    ...draftWithoutFingerprint,
    fingerprint: buildFingerprint(draftWithoutFingerprint),
    requiresConfirmation: true,
  };
}
