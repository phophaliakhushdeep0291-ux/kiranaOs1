import { AI_INTENTS } from "./ai.command-schema.js";

const NUMBER_WORDS = new Map(Object.entries({
  zero: 0, shunya: 0,
  "शून्य": 0,
  one: 1, ek: 1,
  "एक": 1,
  two: 2, do: 2,
  "दो": 2,
  three: 3, teen: 3,
  "तीन": 3,
  four: 4, char: 4, chaar: 4,
  "चार": 4,
  five: 5, paanch: 5, panch: 5,
  "पांच": 5, "पाँच": 5,
  six: 6, chhe: 6, cheh: 6,
  "छह": 6,
  seven: 7, saat: 7,
  "सात": 7,
  eight: 8, aath: 8,
  "आठ": 8,
  nine: 9, nau: 9,
  "नौ": 9,
  ten: 10, das: 10,
  "दस": 10,
  half: 0.5, aadha: 0.5, adha: 0.5,
  "आधा": 0.5,
}));

const INTENT_EVIDENCE = Object.freeze({
  [AI_INTENTS.ADD_ITEMS]: ["add", "daal", "dalo", "laga", "bill", "banao", "\u0921\u093e\u0932", "\u0932\u0917\u093e", "\u092c\u093f\u0932"],
  [AI_INTENTS.REMOVE_ITEM]: ["remove", "hata", "nikal", "\u0939\u091f\u093e", "\u0928\u093f\u0915\u093e\u0932"],
  [AI_INTENTS.UPDATE_QUANTITY]: ["quantity", "qty", "change", "update", "set", "badal", "\u092c\u0926\u0932"],
  [AI_INTENTS.SET_CUSTOMER]: ["customer", "grahak", "name", "naam", "mobile", "\u0917\u094d\u0930\u093e\u0939\u0915", "\u0928\u093e\u092e", "\u092e\u094b\u092c\u093e\u0907\u0932"],
  [AI_INTENTS.OPEN_REPORTS]: ["report", "profit", "sales", "bikri", "\u0930\u093f\u092a\u094b\u0930\u094d\u091f", "\u092e\u0941\u0928\u093e\u092b\u093e", "\u092c\u093f\u0915\u094d\u0930\u0940"],
  [AI_INTENTS.OPEN_INVENTORY]: ["stock", "inventory", "\u0938\u094d\u091f\u0949\u0915", "\u0907\u0928\u094d\u0935\u0947\u0902\u091f\u0930\u0940"],
  [AI_INTENTS.SHOW_KHATA]: ["khata", "udhar", "credit", "\u0916\u093e\u0924\u093e", "\u0909\u0927\u093e\u0930"],
  [AI_INTENTS.CREATE_CUSTOMER]: ["customer", "grahak", "create", "add", "naya", "\u0917\u094d\u0930\u093e\u0939\u0915", "\u0928\u092f\u093e"],
  [AI_INTENTS.SET_PAYMENT]: ["cash", "upi", "udhar", "payment", "paid", "\u0928\u0915\u0926", "\u0909\u0927\u093e\u0930", "\u092d\u0941\u0917\u0924\u093e\u0928"],
  [AI_INTENTS.APPLY_DISCOUNT]: ["discount", "chhoot", "off", "\u091b\u0942\u091f", "\u0921\u093f\u0938\u094d\u0915\u093e\u0909\u0902\u091f"],
  [AI_INTENTS.CONFIRM_BILL]: ["confirm", "final", "save", "pakka", "banao", "bana do"],
  [AI_INTENTS.CANCEL_BILL]: ["cancel", "radd", "cancelled"],
  [AI_INTENTS.UPDATE_PRODUCT_PRICE]: ["price", "rate", "daam", "dam", "kimat", "keemat"],
  [AI_INTENTS.ADJUST_STOCK]: ["stock", "inventory", "adjust", "correction", "damage", "kharab"],
  [AI_INTENTS.DELETE_PRODUCT]: ["delete", "remove", "hata", "mitado", "mita do"],
  [AI_INTENTS.EXPORT_DATA]: ["export", "download", "csv", "pdf"],
});

const OWNER_INTENTS = new Set([
  AI_INTENTS.CANCEL_BILL,
  AI_INTENTS.UPDATE_PRODUCT_PRICE,
  AI_INTENTS.ADJUST_STOCK,
  AI_INTENTS.DELETE_PRODUCT,
  AI_INTENTS.EXPORT_DATA,
]);
const CONFIRM_INTENTS = new Set([
  AI_INTENTS.CREATE_CUSTOMER,
  AI_INTENTS.SET_PAYMENT,
  AI_INTENTS.APPLY_DISCOUNT,
  AI_INTENTS.CONFIRM_BILL,
]);
const CATALOG_REQUIRED_INTENTS = new Set([
  AI_INTENTS.ADD_ITEMS,
  AI_INTENTS.REMOVE_ITEM,
  AI_INTENTS.UPDATE_QUANTITY,
]);
const ITEM_REQUIRED_INTENTS = new Set([
  AI_INTENTS.ADD_ITEMS,
  AI_INTENTS.UPDATE_QUANTITY,
]);
const PRODUCT_REFERENCE_REQUIRED_INTENTS = new Set([
  AI_INTENTS.ADD_ITEMS,
  AI_INTENTS.REMOVE_ITEM,
  AI_INTENTS.UPDATE_QUANTITY,
  AI_INTENTS.UPDATE_PRODUCT_PRICE,
  AI_INTENTS.ADJUST_STOCK,
  AI_INTENTS.DELETE_PRODUCT,
]);
const QUANTITY_UNIT_INTENTS = new Set([
  AI_INTENTS.ADD_ITEMS,
  AI_INTENTS.UPDATE_QUANTITY,
]);
const TARGET_ALIASES = Object.freeze({
  daily: ["daily", "today", "aaj", "\u0906\u091c"],
  today: ["today", "aaj", "\u0906\u091c"],
  yesterday: ["yesterday", "kal", "\u0915\u0932"],
  last: ["last", "pichla", "pichli", "\u092a\u093f\u091b\u0932\u093e", "\u092a\u093f\u091b\u0932\u0940"],
});

// A structured command can be fully grounded while its free-form provider
// message still invents an outcome (for example, "bill saved" or "stock is
// now 10"). Parsing never executes an action, so every user-facing sentence is
// server-owned and describes only the verified proposal.
const VERIFIED_COMMAND_MESSAGES = Object.freeze({
  [AI_INTENTS.SEARCH_PRODUCT]: "Search command verified. Review the matching products.",
  [AI_INTENTS.ADD_ITEMS]: "Item and quantity verified. Review before adding to the bill.",
  [AI_INTENTS.REMOVE_ITEM]: "Item removal command verified. Review before applying it.",
  [AI_INTENTS.UPDATE_QUANTITY]: "Quantity change verified. Review before applying it.",
  [AI_INTENTS.SET_CUSTOMER]: "Customer details verified. Review before selecting the customer.",
  [AI_INTENTS.OPEN_REPORTS]: "Report request verified. Opening the selected report is safe.",
  [AI_INTENTS.OPEN_INVENTORY]: "Inventory request verified. Opening inventory is safe.",
  [AI_INTENTS.SHOW_KHATA]: "Khata request verified. Opening customer credit records is safe.",
  [AI_INTENTS.CREATE_CUSTOMER]: "Customer details verified. Confirm before creating the customer.",
  [AI_INTENTS.SET_PAYMENT]: "Payment details verified. Confirm the amounts before applying them.",
  [AI_INTENTS.APPLY_DISCOUNT]: "Discount value verified. Confirm before applying it.",
  [AI_INTENTS.CONFIRM_BILL]: "Bill confirmation command verified. Review the bill total before saving.",
  [AI_INTENTS.CANCEL_BILL]: "Cancellation target verified. Owner confirmation is still required.",
  [AI_INTENTS.UPDATE_PRODUCT_PRICE]: "Price change details verified. Owner confirmation is still required.",
  [AI_INTENTS.ADJUST_STOCK]: "Stock adjustment details verified. Owner confirmation is still required.",
  [AI_INTENTS.DELETE_PRODUCT]: "Product deletion target verified. Owner confirmation is still required.",
  [AI_INTENTS.EXPORT_DATA]: "Export request verified. Owner confirmation is still required.",
});

const SERVER_CLARIFICATION = "Please repeat one exact action using the item, customer, quantity, and amount shown in the app.";

function verifiedCommandMessage(intent) {
  return VERIFIED_COMMAND_MESSAGES[intent]
    ?? "Command details verified. Review them before continuing.";
}

const UNIT_EVIDENCE = Object.freeze({
  kg: ["kg", "kilo", "kilogram", "\u0915\u093f\u0932\u094b"],
  g: ["g", "gram", "grams", "\u0917\u094d\u0930\u093e\u092e"],
  ltr: ["ltr", "litre", "liter", "\u0932\u0940\u091f\u0930"],
  ml: ["ml", "millilitre", "milliliter", "\u092e\u093f\u0932\u0940\u0932\u0940\u091f\u0930"],
  piece: ["piece", "pieces", "pcs", "pc", "nag", "\u092a\u0940\u0938", "\u0928\u0917"],
  pcs: ["piece", "pieces", "pcs", "pc", "nag", "\u092a\u0940\u0938", "\u0928\u0917"],
  packet: ["packet", "pack", "pkt", "\u092a\u0948\u0915\u0947\u091f"],
  box: ["box", "dabba", "\u092c\u0949\u0915\u094d\u0938", "\u0921\u092c\u094d\u092c\u093e"],
  dozen: ["dozen", "darjan", "\u0926\u0930\u094d\u091c\u0928"],
});

export function normalizeEvidenceText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-IN")
    // Devanagari vowel signs are Unicode marks, not letters. Dropping them
    // changes दो into द and चीनी into च न, destroying the exact evidence we
    // need to distinguish Hindi quantities and catalogue aliases.
    .replace(/[^\p{L}\p{M}\p{N}.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAliases(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeGroundingCatalog(rows = []) {
  const byId = new Map();
  for (const row of rows.slice(0, 2_000)) {
    const id = String(row?.id ?? row?.productId ?? "").trim();
    const name = String(row?.name ?? row?.productName ?? "").trim();
    if (!id || !name) continue;
    const aliases = parseAliases(row?.aliases ?? row?.aliasesJson)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .slice(0, 30);
    byId.set(id, { id, name, aliases });
  }
  return [...byId.values()];
}

function evidenceNumbers(transcript) {
  const normalized = normalizeEvidenceText(transcript);
  const values = new Set();
  for (const match of normalized.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/g)) values.add(Number(match[1]));
  for (const match of normalized.matchAll(/\d+(?:\.\d+)?/g)) values.add(Number(match[0]));
  for (const word of normalized.split(" ")) {
    if (NUMBER_WORDS.has(word)) values.add(NUMBER_WORDS.get(word));
  }
  return values;
}

function hasNumberEvidence(value, numbers) {
  if (value === null || value === undefined) return true;
  const expected = Number(value);
  if (!Number.isFinite(expected)) return false;
  return [...numbers].some((number) => Math.abs(number - expected) <= 0.0001);
}

function phraseIsSupported(phrase, transcript) {
  const normalized = normalizeEvidenceText(phrase);
  if (!normalized) return false;
  if (transcript.includes(normalized)) return true;
  const tokens = normalized.split(" ").filter((token) => token.length >= 2);
  return tokens.length > 0 && tokens.every((token) => transcript.split(" ").includes(token));
}

function matchCatalogProduct(query, transcript, catalog) {
  const normalizedQuery = normalizeEvidenceText(query);
  const matches = [];
  for (const product of catalog) {
    const terms = [product.name, ...product.aliases].map(normalizeEvidenceText).filter(Boolean);
    const queryMatches = terms.some((term) => term === normalizedQuery || (term.length >= 3 && normalizedQuery.includes(term)) || (normalizedQuery.length >= 3 && term.includes(normalizedQuery)));
    if (!queryMatches) continue;
    const spokenMatch = terms.some((term) => phraseIsSupported(term, transcript));
    if (spokenMatch) matches.push(product);
  }
  // A shared alias such as "oil" is evidence that the user named a family, not
  // evidence for whichever SKU happens to be first in the database. Only an
  // unambiguous tenant-catalogue match may ground a product mutation.
  return matches.length === 1 ? matches[0] : null;
}

function minimumConfidence(intent) {
  if (OWNER_INTENTS.has(intent)) return 0.9;
  if (CONFIRM_INTENTS.has(intent)) return 0.8;
  return 0.65;
}

function addReason(reasons, code, critical = true) {
  if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, critical });
}

export function groundAiCommand(command, { transcript, catalog = [] } = {}) {
  const normalizedTranscript = normalizeEvidenceText(transcript);
  const numbers = evidenceNumbers(transcript);
  const normalizedCatalog = normalizeGroundingCatalog(catalog);
  const reasons = [];
  const matchedProductIds = new Set();

  if (ITEM_REQUIRED_INTENTS.has(command.intent) && !(command.items?.length > 0)) {
    addReason(reasons, "ITEMS_REQUIRED_FOR_INTENT");
  }

  for (const item of command.items ?? []) {
    const directEvidence = phraseIsSupported(item.query, normalizedTranscript);
    const catalogMatch = matchCatalogProduct(item.query, normalizedTranscript, normalizedCatalog);
    if (catalogMatch) matchedProductIds.add(catalogMatch.id);
    if (!directEvidence && !catalogMatch) addReason(reasons, "ITEM_NOT_IN_TRANSCRIPT");
    if (QUANTITY_UNIT_INTENTS.has(command.intent) && !hasNumberEvidence(item.quantity, numbers)) {
      addReason(reasons, "ITEM_QUANTITY_NOT_IN_TRANSCRIPT");
    }
    if (CATALOG_REQUIRED_INTENTS.has(command.intent) && !catalogMatch) {
      addReason(reasons, normalizedCatalog.length > 0 ? "ITEM_NOT_MATCHED_TO_CATALOG" : "CATALOG_EMPTY_OR_UNAVAILABLE");
    }
    const unitTerms = UNIT_EVIDENCE[item.unit];
    if (QUANTITY_UNIT_INTENTS.has(command.intent)
      && item.unit !== "unknown"
      && unitTerms
      && !unitTerms.some((term) => phraseIsSupported(term, normalizedTranscript))) {
      addReason(reasons, "ITEM_UNIT_NOT_IN_TRANSCRIPT");
    }
  }

  if (command.target) {
    const normalizedTarget = normalizeEvidenceText(command.target);
    const aliasEvidence = (TARGET_ALIASES[normalizedTarget] ?? [])
      .some((term) => phraseIsSupported(term, normalizedTranscript));
    const catalogEvidence = matchCatalogProduct(command.target, normalizedTranscript, normalizedCatalog);
    if (!phraseIsSupported(command.target, normalizedTranscript) && !aliasEvidence && !catalogEvidence) {
      addReason(reasons, "TARGET_NOT_IN_TRANSCRIPT");
    }
    if (catalogEvidence) matchedProductIds.add(catalogEvidence.id);
  }

  // Repeating a name from the transcript proves only that the user said it; it
  // does not prove that the product exists in this tenant. Every command that
  // can change a product or a bill line must resolve one unambiguous catalogue
  // row. Search remains exempt because looking for an absent product is valid.
  const catalogRequired = PRODUCT_REFERENCE_REQUIRED_INTENTS.has(command.intent);
  if (catalogRequired && matchedProductIds.size === 0) {
    addReason(
      reasons,
      normalizedCatalog.length > 0 ? "PRODUCT_NOT_MATCHED_TO_CATALOG" : "CATALOG_EMPTY_OR_UNAVAILABLE",
    );
  }

  if ((command.intent === AI_INTENTS.SET_CUSTOMER || command.intent === AI_INTENTS.CREATE_CUSTOMER)
    && !command.customer?.name
    && !command.customer?.mobile) {
    addReason(reasons, "CUSTOMER_DETAILS_REQUIRED_FOR_INTENT");
  }
  if (command.intent === AI_INTENTS.SET_PAYMENT
    && command.payment?.cash === null
    && command.payment?.upi === null
    && command.payment?.remaining === null) {
    addReason(reasons, "PAYMENT_DETAILS_REQUIRED_FOR_INTENT");
  }
  if (command.intent === AI_INTENTS.SET_PAYMENT && !command.payment) {
    addReason(reasons, "PAYMENT_DETAILS_REQUIRED_FOR_INTENT");
  }
  if (command.intent === AI_INTENTS.APPLY_DISCOUNT && command.discount === null) {
    addReason(reasons, "DISCOUNT_REQUIRED_FOR_INTENT");
  }

  if (command.customer?.name && !phraseIsSupported(command.customer.name, normalizedTranscript)) addReason(reasons, "CUSTOMER_NAME_NOT_IN_TRANSCRIPT");
  if (command.customer?.mobile && !String(transcript ?? "").replace(/\D/g, "").includes(command.customer.mobile)) addReason(reasons, "CUSTOMER_MOBILE_NOT_IN_TRANSCRIPT");
  if (command.payment?.cash !== null && !hasNumberEvidence(command.payment?.cash, numbers)) addReason(reasons, "CASH_AMOUNT_NOT_IN_TRANSCRIPT");
  if (command.payment?.upi !== null && !hasNumberEvidence(command.payment?.upi, numbers)) addReason(reasons, "UPI_AMOUNT_NOT_IN_TRANSCRIPT");
  if (command.payment?.remaining === "udhar" && !["udhar", "credit", "baki", "baaki", "\u0909\u0927\u093e\u0930", "\u092c\u093e\u0915\u0940"].some((term) => normalizedTranscript.includes(normalizeEvidenceText(term)))) {
    addReason(reasons, "UDHAR_NOT_IN_TRANSCRIPT");
  }
  if (command.discount !== null && !hasNumberEvidence(command.discount, numbers)) addReason(reasons, "DISCOUNT_NOT_IN_TRANSCRIPT");

  const requiredKeywords = INTENT_EVIDENCE[command.intent];
  if (requiredKeywords && !requiredKeywords.some((word) => normalizedTranscript.includes(normalizeEvidenceText(word)))) {
    addReason(reasons, "INTENT_NOT_SUPPORTED_BY_TRANSCRIPT");
  }

  const criticalReasons = reasons.filter((reason) => reason.critical);
  const evidenceConfidence = criticalReasons.length > 0
    ? Math.max(0, 0.45 - (criticalReasons.length - 1) * 0.15)
    : reasons.length > 0
      ? 0.75
      : 1;
  const effectiveConfidence = Math.min(Number(command.confidence) || 0, evidenceConfidence);
  const threshold = minimumConfidence(command.intent);
  const allowed = command.intent !== AI_INTENTS.UNKNOWN
    && criticalReasons.length === 0
    && !command.clarificationNeeded
    && effectiveConfidence >= threshold;

  const safeCommand = {
    ...command,
    confidence: effectiveConfidence,
    needsConfirmation: command.needsConfirmation || !allowed,
    clarificationNeeded: command.clarificationNeeded || !allowed,
    clarificationQuestion: command.clarificationNeeded || !allowed
      ? SERVER_CLARIFICATION
      : null,
    messageToUser: allowed
      ? verifiedCommandMessage(command.intent)
      : "I could not verify every detail from your words. Please review or rephrase the command.",
  };

  return {
    command: safeCommand,
    allowed,
    safety: {
      grounded: criticalReasons.length === 0,
      effectiveConfidence,
      minimumConfidence: threshold,
      reasons: reasons.map((reason) => reason.code),
      matchedProductIds: [...matchedProductIds].slice(0, 50),
      requiresManualFallback: !allowed,
      providerProseAccepted: false,
      catalogRequired,
    },
  };
}
