/**
 * The back-and-forth that turns dictation into a saveable product.
 *
 * A shopkeeper does not recite a form. They say the couple of things they have
 * in their head — "Tata Salt, twenty six rupees" — and stop. Something then has
 * to ask for the rest, one question at a time, and know when to stop asking:
 * five questions is a feature, fifteen is an interrogation the shop will abandon
 * halfway through, leaving a half-built product on screen.
 *
 * So only two fields are actually required (the form's own schema says so: a
 * name and a selling price are the only things without a default), three more
 * are worth one question each, and everything else is left to the form. Anything
 * on this list can still be filled by simply saying it at any point.
 */
import type { TranslationKey } from "@/features/core/settings/i18n";
import type { ProductFormData } from "./pages/product-form-state";
import { mergeDraftIntoProductForm } from "./pages/product-form-state";
import { normalizeProductVoiceText, type ProductVoiceField, type ProductVoiceFields } from "./product-voice-parser";

/**
 * What gets asked, in order.
 *
 * name and sellingPrice are the two the form cannot save without. The other
 * three are the ones a shop nearly always knows at the moment it is adding
 * stock, and each is worth exactly one question. Category and unit are
 * deliberately absent — both already default sensibly from the trade, so asking
 * would spend a question to confirm an answer we already have.
 */
export const PRODUCT_VOICE_PROMPT_ORDER: ProductVoiceField[] = [
  "name",
  "sellingPrice",
  "mrp",
  "costPrice",
  "stockQuantity",
];

/** The two the product form's schema refuses to save without. */
const REQUIRED_FIELDS: ProductVoiceField[] = ["name", "sellingPrice"];

/** One translation key per question, so the wording lives in the dictionaries. */
export const PRODUCT_VOICE_PROMPT_KEYS: Record<ProductVoiceField, TranslationKey> = {
  name: "products.voice.ask.name",
  sellingPrice: "products.voice.ask.sellingPrice",
  mrp: "products.voice.ask.mrp",
  costPrice: "products.voice.ask.costPrice",
  stockQuantity: "products.voice.ask.stockQuantity",
  category: "products.voice.ask.category",
  brand: "products.voice.ask.brand",
  unit: "products.voice.ask.unit",
  packSize: "products.voice.ask.packSize",
  barcode: "products.voice.ask.barcode",
  hsn: "products.voice.ask.hsn",
  aliases: "products.voice.ask.aliases",
  gstRate: "products.voice.ask.gstRate",
  minimumSellingPrice: "products.voice.ask.minimumSellingPrice",
  retailPrice: "products.voice.ask.retailPrice",
  wholesalePrice: "products.voice.ask.wholesalePrice",
  lowStockAlert: "products.voice.ask.lowStockAlert",
};

export type ProductVoiceControl = "skip" | "stop" | "save" | "none";

const SKIP_WORDS = new Set([
  "skip",
  "next",
  "pass",
  "chhodo",
  "chodo",
  "aage",
  "छोड़ो",
  "छोड़",
  "आगे",
  "अगला",
]);

const STOP_WORDS = new Set(["stop", "cancel", "quit", "band", "bas", "बस", "रुको", "बंद", "रोको"]);

const SAVE_WORDS = new Set(["save", "done", "finish", "ok", "theek", "sahi", "सेव", "बचाओ", "हो गया", "ठीक"]);

/**
 * Whether a reply is a command about the conversation rather than an answer to it.
 *
 * Checked on the WHOLE utterance, not on any word inside it: "save" appearing in
 * "sarson ka tel save" is part of a sentence, while "save" alone is an
 * instruction. Anything longer than the command itself is treated as an answer,
 * which is the safe direction to be wrong in — a misread answer is visible and
 * editable, a misread "stop" ends the session and loses the thread.
 */
export function readVoiceControlWord(spoken: string): ProductVoiceControl {
  const text = normalizeProductVoiceText(spoken);
  if (!text) return "none";
  if (SKIP_WORDS.has(text)) return "skip";
  if (STOP_WORDS.has(text)) return "stop";
  if (SAVE_WORDS.has(text)) return "save";
  return "none";
}

function hasName(values: Pick<ProductFormData, "name">) {
  return String(values.name ?? "").trim().length > 0;
}

function hasPositive(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0;
}

/** Whether the form already holds a real answer for this field. */
export function isProductVoiceFieldAnswered(values: ProductFormData, field: ProductVoiceField): boolean {
  if (field === "name") return hasName(values);
  if (field === "sellingPrice") return hasPositive(values.sellingPrice);
  if (field === "mrp") return hasPositive(values.mrp);
  if (field === "costPrice") return hasPositive(values.costPrice);
  if (field === "stockQuantity") return hasPositive(values.stockQuantity);
  return false;
}

/**
 * The next thing to ask for, or null when there is nothing left worth asking.
 *
 * `handled` carries the fields this session has already put a question to. It is
 * what makes "skip" work, and what stops a legitimately zero answer — no opening
 * stock, no MRP on an unbranded sack — from being asked forever.
 */
export function nextProductVoiceField(
  values: ProductFormData,
  handled: ReadonlySet<ProductVoiceField>,
): ProductVoiceField | null {
  for (const field of PRODUCT_VOICE_PROMPT_ORDER) {
    if (handled.has(field)) continue;
    if (isProductVoiceFieldAnswered(values, field)) continue;
    return field;
  }
  // A required field that was skipped still has to be asked again — the form
  // cannot save without it, so letting the conversation end here would just move
  // the failure to the Save button.
  for (const field of REQUIRED_FIELDS) {
    if (!isProductVoiceFieldAnswered(values, field)) return field;
  }
  return null;
}

/** Whether the form would survive its own schema right now. */
export function isProductReadyToSave(values: ProductFormData): boolean {
  return REQUIRED_FIELDS.every((field) => isProductVoiceFieldAnswered(values, field));
}

/**
 * Pack sizes the product form's own picker offers.
 *
 * A shop can say "pack of 2 boxes" and mean it, but the form measures a pack in
 * one of these; writing "box" into the field would leave the picker showing an
 * empty selection that the shop then has to fix by hand. Better to keep the
 * number and let the unit fall back to the form's existing choice.
 */
const FORM_PACK_MEASURES = new Set(["piece", "tablet", "gram", "kg", "ml", "litre"]);

/**
 * Fold everything voice understood into the form.
 *
 * Reuses the same merge the floating assistant's product draft goes through, so
 * a field behaves identically whether it arrived by dictation here or by command
 * from the assistant, and there is only one place where a new field has to be
 * taught how to land.
 */
export function applyProductVoiceFields(values: ProductFormData, fields: ProductVoiceFields): ProductFormData {
  const safe: ProductVoiceFields = { ...fields };
  if (safe.packSizeUnit && !FORM_PACK_MEASURES.has(safe.packSizeUnit)) delete safe.packSizeUnit;
  return mergeDraftIntoProductForm(values, safe);
}
