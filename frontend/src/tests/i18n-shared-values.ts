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
  // The product name. A brand is not translated.
  "Artha",
  // Protocol name in the webhook delivery table. Nobody writes it in Devanagari.
  "HTTP",
  // Order-channel badges. Both are read as Latin acronyms at a counter, the same
  // way UPI and GST above are.
  "POS",
  "API",
  // Two GST registration identifiers, shown as placeholder text on the e-way
  // transport form. Both are printed in Latin on the documents themselves.
  "GSTIN / TRANSIN",
  // The same identifier on its own, labelling the field on the supplier form. A
  // shopkeeper is copying it off a printed bill, where it is in Latin.
  "GSTIN",
  // Bank and payment identifiers on the store profile. A shopkeeper is copying
  // these off a passbook or a UPI app, where they are printed in Latin — a
  // Devanagari label would make the field harder to match, not easier.
  "UPI ID",
  "IFSC",
  // Field label on the webhook form. The scheme is typed in Latin either way.
  "HTTPS URL",
  "MRP",
  "MRP (₹)",
  "WhatsApp",
  "SMS",
  // Numeric and format-only values: nothing in them is a word.
  "0.00",
  "₹ 0",
  "{tier} · ",
  "{action} · {amount}",
  // The till's credit tender, which is a bare slot in both catalogues. The word
  // that fills it is the shop's own — "Udhar", "Tab", "मरीज़ का खाता" — and it is
  // translated where it is defined (`billing.credit.*`, `billing.tender.*`),
  // picked per business type by settings/shop-credit.ts. There is nothing left
  // in these three to translate.
  "{credit}",
  "{credit}: {amount}",
  // The supplier count, which is a number and the trade's own word for who it
  // buys from — "12 distributors", "12 डिस्ट्रीब्यूटर". The word is translated
  // where it is defined (`suppliers.word.*`); nothing else is left in these.
  "1 {supplier}",
  "{count} {supplier}",
  // Already Devanagari/Hinglish in the English catalogue, because that is what the
  // screen says in both languages.
  "namak, salt, साल्ट",
]);
