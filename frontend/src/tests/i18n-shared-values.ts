/**
 * English values that Hindi legitimately repeats.
 *
 * The completeness test treats `hi === en` as an untranslated string, because that is
 * exactly how one hides: it satisfies the type, it is not missing, and it reads as
 * English at the counter. These are the real exceptions — a brand name, a tax
 * abbreviation, a string made only of placeholders — and each one has to earn its
 * place. A companion test fails if an entry here no longer matches any such pair, so
 * the list cannot outlive the strings it excused.
 *
 * Adding to this list is not the way to make a failing test pass. Translating is.
 */
export const SHARED_TRANSLATION_VALUES = new Set<string>([
  // Language names, shown in the switcher in their own language.
  "English",
  "Hindi / Hinglish",
  // Already Devanagari on the English side: a language named in its own script
  // is the same string in both catalogues, so it can never differ.
  "हिन्दी (Hindi)",
  // Mode name shopkeepers say in English.
  "Advanced",
  // Payment rails and tax terms used in English on every Indian receipt.
  "UPI",
  "GST",
  "MRP",
  "MRP (₹)",
  "WhatsApp",
  "SMS",
  // Numeric and format-only values: nothing in them is a word.
  "0.00",
  "₹ 0",
  "{tier} · ",
  "{action} · {amount}",
  // Already Devanagari/Hinglish in the English catalogue, because that is what the
  // screen says in both languages.
  "namak, salt, साल्ट",
]);
