import { parseSpokenProductFields } from "@/features/core/products/product-voice-parser";
import type {
  CustomerDraft,
  InventoryDraft,
  PaymentDraft,
  ProductDraft,
  VoiceIntent,
  VoiceRoute,
  VoiceSearchTarget,
} from "./voice-types";

export const ROUTES: VoiceRoute[] = [
  {
    route: "/dashboard",
    label: "Dashboard",
    words: ["dashboard", "home", "main", "open dashboard", "go dashboard"],
  },
  {
    route: "/billing",
    label: "Billing",
    words: [
      "billing",
      "bill",
      "new bill",
      "create bill",
      "counter",
      "billing counter",
    ],
  },
  {
    route: "/bills",
    label: "Bills",
    words: ["bill history", "bills", "old bills", "history"],
  },
  {
    route: "/products",
    label: "Products",
    words: ["products", "product", "catalog", "items"],
  },
  { route: "/inventory", label: "Inventory", words: ["inventory", "stock"] },
  {
    route: "/customers",
    label: "Customers",
    words: ["customers", "customer", "party"],
  },
  {
    route: "/udhar",
    label: "Udhar",
    words: ["udhar", "ledger", "khata", "payment"],
  },
  {
    route: "/reports",
    label: "Reports",
    words: ["reports", "report", "sales report"],
  },
  {
    route: "/daily-closing",
    label: "Closing",
    words: ["closing", "daily close", "close day"],
  },
  { route: "/sync-status", label: "Sync", words: ["sync", "backup", "cloud"] },
  {
    route: "/settings",
    label: "Settings",
    words: ["settings", "setting", "profile"],
  },
  {
    route: "/staff",
    label: "Staff",
    words: ["staff", "employees", "employee"],
  },
  {
    route: "/devices",
    label: "Devices",
    words: ["devices", "device", "license"],
  },
  {
    route: "/audit-logs",
    label: "Audit logs",
    words: ["audit logs", "audit", "logs"],
  },
  {
    route: "/recycle-bin",
    label: "Recycle bin",
    words: ["recycle", "recycle bin", "deleted records", "trash"],
  },
];

const UNIT_WORDS: Record<string, string> = {
  kilo: "kg",
  kg: "kg",
  kilogram: "kg",
  gram: "gram",
  gm: "gram",
  litre: "litre",
  liter: "litre",
  ltr: "litre",
  ml: "ml",
  piece: "piece",
  pcs: "piece",
  packet: "packet",
  box: "box",
};

const SEARCH_TARGET_ROUTES: Record<VoiceSearchTarget, string> = {
  product: "/products",
  customer: "/customers",
  bill: "/bills",
  udhar: "/udhar",
  global: "/dashboard",
};

export function normalizeVoiceText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function numberAfter(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(
        `(?:${escaped})\\s*(?:price|rate|cost|rs|₹|rupay|rupee)?\\s*(\\d+(?:\\.\\d+)?)`,
        "i",
      ),
    );
    if (match) return Number(match[1]);
  }
  return undefined;
}

export function firstAmount(text: string) {
  const match = text.match(
    /(?:₹|rs\.?|rupay|rupee)?\s*(\d+(?:\.\d+)?)(?:\s*(?:₹|rs\.?|rupay|rupee))?/i,
  );
  return match ? Number(match[1]) : undefined;
}

export function extractMobile(text: string) {
  const match = text.match(/\b([6-9]\d{9})\b/);
  return match?.[1];
}

export function extractNameAfter(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(
        `${escaped}\\s+([a-zA-Z\u0900-\u097f][a-zA-Z\u0900-\u097f\s]{1,40}?)(?:\\s+(?:mobile|phone|number|cost|price|selling|stock|quantity|address|udhar|limit|kilo|kg|gram|packet|piece|rs|rupay|rupee|paid|payment|cash|upi|amount)|$)`,
        "i",
      ),
    );
    if (match) return match[1].trim();
  }
  return undefined;
}

const PRODUCT_FIELD_STOP_WORDS = new Set([
  "cost",
  "selling",
  "minimum",
  "min",
  "stock",
  "quantity",
  "unit",
  "category",
  "barcode",
  "retail",
  "wholesale",
  "from",
  "price",
  "rate",
  "kg",
  "kilo",
  "kilogram",
  "gram",
  "gm",
  "litre",
  "liter",
  "ltr",
  "ml",
  "piece",
  "pcs",
  "packet",
  "box",
]);

const CUSTOMER_FIELD_STOP_WORDS = [
  "mobile",
  "phone",
  "number",
  "address",
  "udhar",
  "limit",
  "due",
  "date",
  "promise",
  "notes",
  "note",
  "customer",
  "party",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTrailingCustomerFields(value: string) {
  const stopPattern = CUSTOMER_FIELD_STOP_WORDS.map(escapeRegExp).join("|");
  return (
    value.split(new RegExp(`\\s+(?:${stopPattern})\\b`, "i"))[0]?.trim() ?? ""
  );
}

function extractCustomerTextAfter(command: string, labels: string[]) {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const match = command.match(new RegExp(`(?:${escaped})\\s+([^.;]+)`, "i"));
    if (!match) continue;
    const value = stripTrailingCustomerFields(match[1]);
    if (value) return value;
  }
  return undefined;
}

export function parseCustomerName(command: string) {
  const explicit = extractNameAfter(command, [
    "add customer",
    "create customer",
    "new customer",
    "edit customer",
    "update customer",
    "customer",
    "name",
    "naam",
  ]);
  if (explicit) return stripTrailingCustomerFields(explicit);
  const text = normalizeVoiceText(command);
  if (
    /\b(add customer|create customer|new customer|edit customer|update customer)\b/.test(
      text,
    )
  ) {
    return (
      stripTrailingCustomerFields(
        text
          .replace(/\b(add|create|new|edit|update|customer|party)\b/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      ) || undefined
    );
  }
  return undefined;
}

function dateToInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextWeekday(targetDay: number, now = new Date()) {
  const result = new Date(now);
  result.setHours(12, 0, 0, 0);
  const diff = (targetDay - result.getDay() + 7) % 7 || 7;
  result.setDate(result.getDate() + diff);
  return dateToInputValue(result);
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function parseSpokenDate(command: string, labels: string[]) {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const match = command.match(new RegExp(`(?:${escaped})\\s+([^.;]+)`, "i"));
    if (!match) continue;
    const raw = match[1].trim();
    const explicit = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
    if (explicit) return explicit;
    const slashDate = raw.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
    if (slashDate) {
      const day = Number(slashDate[1]);
      const month = Number(slashDate[2]);
      const year = slashDate[3]
        ? Number(slashDate[3].length === 2 ? `20${slashDate[3]}` : slashDate[3])
        : new Date().getFullYear();
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12)
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    const weekday = raw
      .match(
        /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
      )?.[1]
      ?.toLowerCase();
    if (weekday) return nextWeekday(WEEKDAY_INDEX[weekday]);
    if (/\btomorrow\b/i.test(raw)) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return dateToInputValue(tomorrow);
    }
    if (/\btoday\b/i.test(raw)) return dateToInputValue(new Date());
  }
  return undefined;
}

function uniqueVoiceWords(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase("en-IN").normalize("NFKC");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function extractAliases(text: string) {
  const match = text.match(
    /(?:alias|aliases|also called|other names|naam bhi)\s+([^.;]+)/i,
  );
  if (!match) return undefined;
  const rawTail =
    match[1].split(
      /\b(?:cost|selling|minimum|min|stock|quantity|unit|category|barcode|retail|wholesale)\b/i,
    )[0] ?? "";
  const parts = rawTail
    .split(/[,/\n]+|\s+and\s+|\s+or\s+|\s+/i)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 1 && !PRODUCT_FIELD_STOP_WORDS.has(part.toLowerCase()),
    );
  const aliases = uniqueVoiceWords(parts);
  return aliases.length ? aliases.slice(0, 12) : undefined;
}

function normalizeUnit(value: string | undefined) {
  if (!value) return undefined;
  const clean = value.toLowerCase().trim();
  return UNIT_WORDS[clean] ?? clean;
}

function unitAfter(text: string) {
  const afterLabel = extractNameAfter(text, ["unit"]);
  if (afterLabel) return normalizeUnit(afterLabel.split(/\s+/)[0]);
  const stockMatch = text.match(
    /\b(?:stock|quantity|opening stock)\s*\d+(?:\.\d+)?\s*(kilo|kg|kilogram|gram|gm|litre|liter|ltr|ml|piece|pcs|packet|box)\b/i,
  );
  return normalizeUnit(stockMatch?.[1]);
}

function quantityAfterPriceFrom(text: string, label: "retail" | "wholesale") {
  const match = text.match(
    new RegExp(
      `\\b${label}(?:\\s+price)?\\s*\\d+(?:\\.\\d+)?\\s*(?:from|above|after)\\s*(\\d+(?:\\.\\d+)?)`,
      "i",
    ),
  );
  return match ? Number(match[1]) : undefined;
}

/**
 * Hindi product vocabulary.
 *
 * Written with explicit space anchors instead of `\b`, because `\b` is defined
 * against [A-Za-z0-9_]: every Devanagari character counts as a non-word
 * character, so a `\b`-delimited Hindi word never matches at all. That is why a
 * Hindi shop dictating a product got `noop` back while the mic was already
 * listening in hi-IN for them.
 */
const HINDI_PRODUCT_TRIGGER =
  /(?:^|\s)(?:(?:नया|नई|नयी|नए)\s+(?:प्रोडक्ट|आइटम|सामान|माल)|(?:प्रोडक्ट|आइटम|सामान|माल)\s+(?:जोड़ो|जोड़ें|डालो|बनाओ))(?=\s|$)/;

const HINDI_PRODUCT_FIELD =
  /(?:^|\s)(?:दाम|भाव|कीमत|रेट|स्टॉक|खरीद|लागत|बिक्री|एमआरपी|जीएसटी|कैटेगरी|श्रेणी|यूनिट|इकाई|बारकोड|एचएसएन|उपनाम|थोक|खुदरा|न्यूनतम|ब्रांड|कंपनी)(?=\s|$)/;

/**
 * Only an explicit Hindi product trigger routes here from elsewhere in the app.
 * A bare field word like खरीद or स्टॉक belongs just as plausibly to an inventory
 * purchase, so it counts only once the shop is already on the products screen
 * with the form in front of it.
 */
export function looksLikeHindiProductCommand(text: string, currentRoute = "") {
  if (HINDI_PRODUCT_TRIGGER.test(text)) return true;
  return currentRoute.startsWith("/products") && HINDI_PRODUCT_FIELD.test(text);
}

export function looksLikeProductFieldCommand(text: string) {
  return /\b(name|naam|product name|cost|avg cost|average cost|selling|sell|minimum|min price|min|stock|quantity|unit|category|barcode|alias|aliases|retail|wholesale|low stock|alert)\b/.test(
    text,
  );
}

export function looksLikeProductVoiceFillCommand(text: string) {
  return (
    /\b(name|product name|cost|avg cost|average cost|selling|sell|minimum|min price|min|stock|quantity|unit|category|barcode|alias|aliases|retail|wholesale|low stock|alert)\b/.test(
      text,
    ) &&
    !/\b(record payment|payment received|customer paid|paid|collect payment|customer|add customer|create customer|new customer|purchase|buy stock|stock purchase|damage|wastage|correction|correct stock|adjust stock|inventory entry|inventory|bill history|pending sync|dashboard summary)\b/.test(
      text,
    )
  );
}

export function looksLikeCustomerFieldCommand(text: string) {
  return /\b(name|naam|mobile|phone|address|udhar|limit|due date|promise|notes?)\b/.test(
    text,
  );
}

export function looksLikeCustomerVoiceFillCommand(
  text: string,
  currentRoute = "",
) {
  if (
    currentRoute.startsWith("/customers") &&
    looksLikeCustomerFieldCommand(text)
  )
    return true;
  return (
    /\b(add customer|create customer|new customer|edit customer|update customer|mobile|phone|address|udhar limit|promise date|due date)\b/.test(
      text,
    ) &&
    !/\b(add product|create product|new product|product|category|cost|selling|minimum|stock|inventory|purchase|damage|correction|record payment|payment received|customer paid|paid|collect payment|bill history|pending sync|dashboard summary)\b/.test(
      text,
    )
  );
}

export function parseQuantityUnit(text: string) {
  const match = text.match(
    /\b(?:stock|quantity|qty)?\s*(\d+(?:\.\d+)?)\s*(kilo|kg|kilogram|gram|gm|litre|liter|ltr|ml|piece|pcs|packet|box)?\b/i,
  );
  return {
    quantity: match ? Number(match[1]) : undefined,
    unit: match?.[2]
      ? (UNIT_WORDS[match[2].toLowerCase()] ?? match[2].toLowerCase())
      : undefined,
  };
}

type ParsedInventoryMovement = NonNullable<InventoryDraft["movementType"]>;

const INVENTORY_TRAILING_FIELD_PATTERN =
  /\b(?:cost|cost price|rate|supplier|from supplier|bill|bill amount|total|reason|note|min|minimum|minimum price|selling|sell|selling price|min margin|minimum margin|selling margin|margin|owner pin|pin)\b/i;

function trimInventoryFieldTail(value: string) {
  return value
    .split(INVENTORY_TRAILING_FIELD_PATTERN)[0]
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingQuantityUnit(value: string) {
  return value
    .replace(
      /^\s*(?:stock|quantity|qty)?\s*\d+(?:\.\d+)?\s*(?:kilo|kg|kilogram|gram|gm|litre|liter|ltr|ml|piece|pcs|packet|box)?\s*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function inventoryCommandBody(command: string, movementType: ParsedInventoryMovement) {
  const triggerPatterns: Record<ParsedInventoryMovement, RegExp[]> = {
    purchase: [
      /\b(?:purchase|buy stock|stock purchase|buy|add stock)\b/i,
    ],
    sale: [/\b(?:sale|manual sale)\b/i],
    damage: [/\b(?:damage|wastage|waste|damaged)\b/i],
    correction: [
      /\b(?:stock correction|correction|correct stock|adjust stock|correct|adjust)\b/i,
    ],
  };
  for (const pattern of triggerPatterns[movementType]) {
    const match = command.match(pattern);
    if (!match || match.index === undefined) continue;
    return command.slice(match.index + match[0].length).trim();
  }
  return command.trim();
}

export function parseInventoryProductName(command: string, movementType: ParsedInventoryMovement) {
  const body = inventoryCommandBody(command, movementType);
  const withoutQuantity = stripLeadingQuantityUnit(body);
  const beforeFields = trimInventoryFieldTail(withoutQuantity);
  const withoutStockKeyword = beforeFields
    .replace(/\bstock\s+\d+(?:\.\d+)?\s*(?:kilo|kg|kilogram|gram|gm|litre|liter|ltr|ml|piece|pcs|packet|box)?\b/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return withoutStockKeyword || undefined;
}

function extractInventoryTextAfter(command: string, labels: string[]) {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const match = command.match(new RegExp(`(?:${escaped})\\s+([^.;]+)`, "i"));
    if (!match) continue;
    const value = trimInventoryFieldTail(match[1]);
    if (value) return value;
  }
  return undefined;
}

export function parseProductName(text: string) {
  const normalized = normalizeVoiceText(text);
  const after = extractNameAfter(text, [
    "add product",
    "create product",
    "new product",
    "edit product",
    "update product",
    "change product",
    "customise product",
    "customize product",
    "product name",
    "name",
    "naam",
  ]);
  if (after) return after;

  const isExplicitProductCommand =
    /\b(add product|create product|new product|edit product|update product|change product|product)\b/.test(
      normalized,
    );
  const hasFieldLabels =
    /\b(category|unit|cost|avg cost|average cost|selling|sell|minimum|min|stock|quantity|barcode|alias|aliases|retail|wholesale|low stock|alert)\b/.test(
      normalized,
    );
  if (!isExplicitProductCommand && hasFieldLabels) return undefined;

  const words = normalized.split(" ");
  const blockers = new Set([
    "add",
    "create",
    "new",
    "edit",
    "update",
    "change",
    "product",
    "name",
    "naam",
    "avg",
    "average",
    "sell",
    "purchase",
    "inventory",
    "alias",
    "aliases",
    "low",
    "alert",
    ...PRODUCT_FIELD_STOP_WORDS,
  ]);
  const filtered = words.filter(
    (word) => !blockers.has(word) && !/^\d/.test(word),
  );
  return filtered.slice(0, 3).join(" ").trim() || undefined;
}

/**
 * A spoken product, read by the shared token parser.
 *
 * Delegated rather than duplicated so the floating assistant and the form's own
 * dictation understand exactly the same sentences: this used to have its own
 * regex-per-field reader that dropped MRP, GST, brand, HSN and pack size, and
 * left every word it failed to recognise inside the product NAME.
 */
export function parseProductDraft(command: string): ProductDraft {
  const text = normalizeVoiceText(command);
  const mode = /\b(edit|update|change|customise|customize)\b/.test(text) ? "edit" : "create";
  const fields = parseSpokenProductFields(command);
  return { mode, productName: fields.name, ...fields };
}

export function parseCustomerDraft(command: string): CustomerDraft {
  const text = normalizeVoiceText(command);
  const mode = /\b(edit|update|change)\b/.test(text) ? "edit" : "create";
  const udharLimit = numberAfter(command, ["udhar limit", "limit"]);
  return {
    mode,
    name: parseCustomerName(command),
    mobile: extractMobile(command),
    address: extractCustomerTextAfter(command, ["address"]),
    type:
      text.includes("udhar") ||
      text.includes("khata") ||
      udharLimit !== undefined
        ? "udhar"
        : "regular",
    udharLimit,
    dueDate: parseSpokenDate(command, ["due date", "due"]),
    promiseToPayDate: parseSpokenDate(command, [
      "promise date",
      "promise to pay",
      "promise",
    ]),
    notes:
      extractCustomerTextAfter(command, ["note", "notes"]) ??
      (text.includes("bad customer") ? "Bad customer warning" : undefined),
  };
}

export function parseInventoryDraft(command: string): InventoryDraft {
  const text = normalizeVoiceText(command);
  const movementType =
    text.includes("damage") || text.includes("wastage") || text.includes("waste")
      ? "damage"
      : text.includes("correction") ||
          text.includes("correct") ||
          text.includes("adjust")
        ? "correction"
        : text.includes("sale")
          ? "sale"
          : "purchase";
  const quantityUnit = parseQuantityUnit(text);
  const productName =
    parseInventoryProductName(command, movementType) ?? parseProductName(command);
  return {
    movementType,
    productName,
    quantity: quantityUnit.quantity,
    unit: quantityUnit.unit,
    supplierName: extractInventoryTextAfter(command, ["supplier", "from"]),
    billAmount: numberAfter(command, ["bill", "bill amount", "total"]),
    costPrice: numberAfter(command, ["cost", "cost price", "rate"]),
    minPrice: numberAfter(command, ["min", "minimum", "minimum price"]),
    sellingPrice: numberAfter(command, ["selling", "sell", "selling price"]),
    minMarginPercent: numberAfter(command, ["min margin", "minimum margin"]),
    sellingMarginPercent: numberAfter(command, ["selling margin", "margin"]),
    reason: extractInventoryTextAfter(command, ["reason", "note"]),
  };
}

export function parsePaymentDraft(command: string): PaymentDraft {
  const text = normalizeVoiceText(command);
  const nameBeforeAmount = command
    .match(
      /(?:record payment|payment|paid|pay|received|collect)\s+([a-zA-Z\u0900-\u097f][a-zA-Z\u0900-\u097f\s]{1,40}?)\s+(?:₹|rs\.?|rupay|rupee)?\s*\d/i,
    )?.[1]
    ?.trim();
  const customerName =
    extractNameAfter(command, ["customer", "from", "by", "name", "naam"]) ??
    nameBeforeAmount ??
    extractNameAfter(command, ["record payment", "payment", "paid", "pay"]);
  const explicitAmount = numberAfter(command, [
    "amount",
    "payment",
    "paid",
    "pay",
    "received",
    "collect",
    "collection",
  ]);
  return {
    customerName,
    mobile: extractMobile(command),
    amount: explicitAmount ?? firstAmount(command),
    mode: /\b(upi|phonepe|gpay|paytm|online)\b/.test(text) ? "upi" : "cash",
    note: extractNameAfter(command, ["note", "reason"]),
  };
}

export function parseSearchIntent(
  command: string,
  currentRoute = "",
): VoiceIntent | null {
  const text = normalizeVoiceText(command);
  const match = text.match(
    /\b(?:search|find|look for|show|dhundo|dhoondo)\s+(?:(product|item|customer|party|bill|udhar|ledger)\s+)?(.+)$/i,
  );
  if (!match) return null;
  const rawTarget = match[1]?.toLowerCase();
  const query = match[2]
    .replace(/\b(in|on|page|list)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!query) return null;

  const target: VoiceSearchTarget =
    rawTarget === "customer" || rawTarget === "party"
      ? "customer"
      : rawTarget === "bill"
        ? "bill"
        : rawTarget === "udhar" || rawTarget === "ledger"
          ? "udhar"
          : rawTarget === "product" || rawTarget === "item"
            ? "product"
            : currentRoute.startsWith("/customers")
              ? "customer"
              : currentRoute.startsWith("/udhar")
                ? "udhar"
                : currentRoute.startsWith("/bills")
                  ? "bill"
                  : "product";
  return {
    action: "search",
    route: SEARCH_TARGET_ROUTES[target],
    search: { target, query },
    message: `Searching ${target} for ${query}.`,
    auditable: true,
  };
}

export function looksLikeBillingCommand(normalized: string) {
  return (
    /\b(kg|kilo|gram|gm|packet|piece|pcs|liter|litre|rupay|rupee|rs|₹|udhar|naam|name|chini|sugar|atta|tel|oil|cash bill|upi bill|udhar bill)\b/.test(
      normalized,
    ) &&
    !/\b(add product|create product|new product|edit product|update product|add customer|create customer|new customer|purchase|damage|correction|inventory|record payment|payment received|collect payment)\b/.test(
      normalized,
    )
  );
}

export function looksLikeBillingDraftCommand(
  normalized: string,
  currentRoute = "",
) {
  if (/\b(make\s+(?:cash|upi|udhar)\s+bill|cash\s+bill|upi\s+bill|udhar\s+bill)\b/.test(normalized)) {
    return true;
  }
  if (currentRoute.startsWith("/billing")) {
    return (
      /\b(customer|naam|name|paid|cash|upi|phonepe|gpay|paytm|udhar|kg|kilo|gram|gm|packet|piece|pcs|liter|litre|rupay|rupee|rs|₹|chini|sugar|atta|tel|oil)\b/.test(normalized) &&
      !/\b(record payment|payment received|collect payment|add product|create product|new product|add customer|create customer|new customer|purchase|damage|correction|inventory)\b/.test(normalized)
    );
  }
  return (
    looksLikeBillingCommand(normalized) &&
    (/\b(\d+(?:\.\d+)?|ek|do|teen|char|chaar|panch|paanch|aadha|one|two|three|half)\b/.test(normalized) ||
      /\b(chini|sugar|atta|tel|oil)\b/.test(normalized))
  );
}

export function looksLikePaymentCommand(normalized: string) {
  return (
    /\b(record payment|payment received|customer paid|paid|collect payment|payment)\b/.test(
      normalized,
    ) && /\b(\d+(?:\.\d+)?|cash|upi|phonepe|gpay|paytm)\b/.test(normalized)
  );
}

export function parseLocalVoiceIntent(
  command: string,
  currentRoute = "",
): VoiceIntent {
  const text = normalizeVoiceText(command);
  if (!text) return { action: "noop", message: "No command found." };

  if (
    /\b(pending sync|sync pending|pending backup|sync count|pending sync count)\b/.test(
      text,
    )
  ) {
    return {
      action: "sync_count",
      route: currentRoute || "/sync-status",
      message: "Checking pending sync operations.",
      auditable: true,
    };
  }

  if (
    /\b(dashboard summary|business summary|today summary|sales summary|counter summary)\b/.test(
      text,
    )
  ) {
    return {
      action: "dashboard_summary",
      route: "/dashboard",
      message: "Preparing dashboard summary.",
      auditable: true,
    };
  }

  const searchIntent = parseSearchIntent(command, currentRoute);
  if (searchIntent) return searchIntent;

  if (looksLikeBillingDraftCommand(text, currentRoute)) {
    return {
      action: "billing_command",
      route: "/billing",
      billingCommand: command,
      message: "Preparing billing draft for review.",
      requiresConfirmation: true,
      auditable: true,
    };
  }

  if (looksLikeCustomerVoiceFillCommand(text, currentRoute)) {
    const isOpenFormFill = currentRoute.startsWith("/customers");
    return {
      action: "customer_draft",
      route: "/customers",
      customer: parseCustomerDraft(command),
      message: isOpenFormFill
        ? "Filled the open customer form from voice. Review and save locally."
        : "Opening customer form with your voice details. Review and save locally.",
      auditable: true,
    };
  }

  if (
    (currentRoute.startsWith("/products") &&
      looksLikeProductFieldCommand(text)) ||
    looksLikeProductVoiceFillCommand(text) ||
    looksLikeHindiProductCommand(text, currentRoute)
  ) {
    const isOpenFormFill = currentRoute.startsWith("/products");
    return {
      action: "product_draft",
      route: "/products",
      product: parseProductDraft(command),
      message: isOpenFormFill
        ? "Filled the open product form from voice. Review and save locally."
        : "Opening product form with your voice details. Review and save locally.",
      auditable: true,
    };
  }

  if (looksLikePaymentCommand(text)) {
    return {
      action: "payment_draft",
      route: "/udhar",
      payment: parsePaymentDraft(command),
      message:
        "Opening payment form with your voice details. Review before saving.",
      requiresConfirmation: true,
      auditable: true,
    };
  }

  if (
    /\b(add product|create product|new product|edit product|update product|change product|customise product|customize product)\b/.test(
      text,
    )
  ) {
    return {
      action: "product_draft",
      route: "/products",
      product: parseProductDraft(command),
      message: "Opening product form with your voice details.",
      auditable: true,
    };
  }

  if (
    /\b(add customer|create customer|new customer|edit customer|update customer)\b/.test(
      text,
    )
  ) {
    return {
      action: "customer_draft",
      route: "/customers",
      customer: parseCustomerDraft(command),
      message: "Opening customer form with your voice details.",
      auditable: true,
    };
  }

  if (
    /\b(purchase|buy stock|stock purchase|damage|wastage|correction|correct stock|adjust stock|inventory entry)\b/.test(
      text,
    )
  ) {
    const draft = parseInventoryDraft(command);
    return {
      action: "inventory_draft",
      route: "/inventory",
      inventory: draft,
      message: "Opening inventory entry with your voice details.",
      requiresConfirmation: true,
      requiresOwnerPin: draft.movementType === "correction",
      auditable: true,
    };
  }

  for (const route of ROUTES) {
    if (route.words.some((word) => text.includes(word))) {
      if (route.route === "/billing" && looksLikeBillingCommand(text)) {
        return {
          action: "billing_command",
          route: "/billing",
          billingCommand: command,
          message: "Opening billing and preparing voice bill.",
          requiresConfirmation: true,
          auditable: true,
        };
      }
      return {
        action: "navigate",
        route: route.route,
        message: `Opening ${route.label}.`,
        auditable: true,
      };
    }
  }

  if (looksLikeBillingCommand(text)) {
    return {
      action: "billing_command",
      route: "/billing",
      billingCommand: command,
      message: "Preparing billing command.",
      requiresConfirmation: true,
      auditable: true,
    };
  }

  return {
    action: "noop",
    message:
      "Try: open billing, add product chini cost 40 selling 45, add customer Ramesh mobile 987..., purchase 10 kilo chini cost 40, or record payment Ramesh 500 cash.",
  };
}

export function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return undefined;
}

export function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
  return rows.length ? rows : undefined;
}

export function normalizeProductDraft(
  value: unknown,
): ProductDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    mode: record.mode === "edit" ? "edit" : "create",
    name: asString(record.name),
    productName: asString(record.productName) ?? asString(record.product_name),
    category: asString(record.category),
    unit: asString(record.unit),
    barcode: asString(record.barcode) ?? asString(record.sku),
    aliases: asStringArray(record.aliases),
    costPrice: asNumber(record.costPrice ?? record.cost_price),
    sellingPrice: asNumber(record.sellingPrice ?? record.selling_price),
    minimumSellingPrice: asNumber(
      record.minimumSellingPrice ??
        record.minimum_selling_price ??
        record.minPrice,
    ),
    retailPrice: asNumber(record.retailPrice ?? record.retail_price),
    wholesalePrice: asNumber(record.wholesalePrice ?? record.wholesale_price),
    retailFromQuantity: asNumber(
      record.retailFromQuantity ?? record.retail_from_quantity,
    ),
    wholesaleFromQuantity: asNumber(
      record.wholesaleFromQuantity ?? record.wholesale_from_quantity,
    ),
    stockQuantity: asNumber(record.stockQuantity ?? record.stock_quantity),
    lowStockAlert: asNumber(record.lowStockAlert ?? record.low_stock_alert),
  };
}

export function normalizeCustomerDraft(
  value: unknown,
): CustomerDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    mode: record.mode === "edit" ? "edit" : "create",
    name: asString(record.name),
    mobile: asString(record.mobile) ?? asString(record.phone),
    address: asString(record.address),
    type: record.type === "udhar" ? "udhar" : "regular",
    udharLimit: asNumber(record.udharLimit ?? record.udhar_limit),
    dueDate: asString(record.dueDate ?? record.due_date),
    promiseToPayDate: asString(
      record.promiseToPayDate ?? record.promise_to_pay_date,
    ),
    notes: asString(record.notes),
  };
}

export function normalizeInventoryDraft(
  value: unknown,
): InventoryDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawMovementType = String(record.movementType ?? record.movement_type);
  const movementType = ["purchase", "sale", "damage", "correction"].includes(
    rawMovementType,
  )
    ? (rawMovementType as InventoryDraft["movementType"])
    : "purchase";
  return {
    movementType,
    productName: asString(record.productName ?? record.product_name),
    quantity: asNumber(record.quantity),
    unit: asString(record.unit),
    supplierName: asString(record.supplierName ?? record.supplier_name),
    billAmount: asNumber(record.billAmount ?? record.bill_amount),
    costPrice: asNumber(record.costPrice ?? record.cost_price),
    minPrice: asNumber(record.minPrice ?? record.min_price),
    sellingPrice: asNumber(record.sellingPrice ?? record.selling_price),
    minMarginPercent: asNumber(
      record.minMarginPercent ?? record.min_margin_percent,
    ),
    sellingMarginPercent: asNumber(
      record.sellingMarginPercent ?? record.selling_margin_percent,
    ),
    reason: asString(record.reason ?? record.note),
  };
}

export function normalizePaymentDraft(
  value: unknown,
): PaymentDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawMode = asString(record.mode ?? record.payment_mode)?.toLowerCase();
  return {
    customerName: asString(
      record.customerName ?? record.customer_name ?? record.name,
    ),
    mobile: asString(record.mobile ?? record.phone),
    amount: asNumber(record.amount),
    mode: rawMode === "upi" ? "upi" : "cash",
    note: asString(record.note ?? record.reason),
  };
}

export function normalizeSearchIntent(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawTarget = asString(record.target)?.toLowerCase();
  const query = asString(record.query);
  if (!query) return undefined;
  const target: VoiceSearchTarget =
    rawTarget === "customer" ||
    rawTarget === "bill" ||
    rawTarget === "udhar" ||
    rawTarget === "global"
      ? rawTarget
      : "product";
  return { target, query };
}

export function normalizeAiIntent(value: unknown): VoiceIntent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : "noop";
  if (
    ![
      "navigate",
      "billing_command",
      "product_draft",
      "customer_draft",
      "inventory_draft",
      "payment_draft",
      "search",
      "dashboard_summary",
      "sync_count",
      "noop",
    ].includes(action)
  )
    return null;
  const search = normalizeSearchIntent(record.search ?? record.search_intent);
  const route =
    asString(record.route) ??
    (search ? SEARCH_TARGET_ROUTES[search.target] : undefined);
  return {
    action: action as VoiceIntent["action"],
    route,
    billingCommand:
      asString(record.billingCommand) ?? asString(record.billing_command),
    product: normalizeProductDraft(
      record.product ?? record.productDraft ?? record.product_draft,
    ),
    customer: normalizeCustomerDraft(
      record.customer ?? record.customerDraft ?? record.customer_draft,
    ),
    inventory: normalizeInventoryDraft(
      record.inventory ?? record.inventoryDraft ?? record.inventory_draft,
    ),
    payment: normalizePaymentDraft(
      record.payment ?? record.paymentDraft ?? record.payment_draft,
    ),
    search,
    message: asString(record.message),
    requiresConfirmation:
      record.requiresConfirmation === true ||
      record.requires_confirmation === true,
    requiresOwnerPin:
      record.requiresOwnerPin === true || record.requires_owner_pin === true,
    auditable: record.auditable !== false,
  };
}
