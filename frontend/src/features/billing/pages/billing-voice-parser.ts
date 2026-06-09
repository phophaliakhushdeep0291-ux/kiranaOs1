import {
  BillInputBillType,
  BillPaymentMode,
  type Product,
} from "@/lib/api/client";
import type {
  PaymentSelection,
  VoiceParsedDraft,
  VoiceParsedLine,
} from "./billing-types";
import { SPLIT_PAYMENT } from "./billing-types";
import {
  normalizeSearchText,
  productSellingPrice,
  roundMoney,
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
};

const MONEY_WORDS = new Set([
  "rs",
  "rupay",
  "rupee",
  "rupees",
  "price",
  "rate",
  "at",
  "₹",
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
  if (["kg", "kilo", "kilogram", "kilos"].includes(unit)) return "kg";
  if (["gram", "grams", "g", "gm"].includes(unit)) return "g";
  if (["litre", "liter", "l", "ltr"].includes(unit)) return "litre";
  if (unit === "ml") return "ml";
  if (["packet", "pkt", "pack"].includes(unit)) return "packet";
  if (["piece", "pc", "pcs"].includes(unit)) return "piece";
  if (unit === "box") return "box";
  if (unit === "dozen") return "dozen";
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
      quantity: roundMoney(number),
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
        quantity: roundMoney(firstNumber),
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

function parseCustomerName(command: string) {
  const patterns = [
    /^\s*(.+?)\s+ke\s+naam\b/i,
    /\b(?:customer|naam|name)\s+([a-zA-Z\u0900-\u097f][a-zA-Z\u0900-\u097f\s]{1,40}?)(?:\s+(?:paid|cash|upi|udhar|bill|ke|\d)|$)/i,
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
    .replace(/^\s*[^,]+?\s+ke\s+naam\b/i, "")
    .replace(
      /\b(?:customer|naam|name)\s+[a-zA-Z\u0900-\u097f][a-zA-Z\u0900-\u097f\s]{1,40}?(?=\s+(?:paid|cash|upi|udhar|bill|\d)|$)/gi,
      "",
    )
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

export function parseBillingVoiceCommand(
  command: string,
  products: Product[],
): VoiceParsedDraft {
  const warnings: string[] = [];
  const normalized = normalizeSearchText(command);
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

  const itemCommand = stripBillingDirectives(command)
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

  for (const segment of segments) {
    const normalizedSegment = normalizeSearchText(segment);
    const candidates = products.filter(
      (product) =>
        !matchedProductIds.has(product.id) &&
        voiceProductAliases(product).some((alias) =>
          normalizedSegment.includes(alias),
        ),
    );
    if (candidates.length === 0) continue;
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
  if (lines.length === 0 && !hasNonItemDraft && (segments.length > 0 || hasCartLikeWords(normalized)))
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
