/**
 * Understanding a customer spoken as one ordinary sentence.
 *
 * Same design as the product parser — walk the tokens, consume what each field
 * claims, and take the name from what is left — because the old regex-per-field
 * reader failed the same way: "add customer Ramesh Kumar 9876543210 gst
 * 08AABCU9603R1ZM" filed a customer *named* "ramesh kumar 9876543210 gst
 * 08aabcu9603r1zm", and a Hindi sentence returned no name at all.
 *
 * Two things differ from products, and both matter:
 *
 * 1. A customer is a PERSON. The name and address are echoed back on screen and
 *    printed on bills, so they keep the capitalisation they were said with —
 *    matching happens on a normalised copy, output comes from the raw one.
 * 2. Addresses and notes contain digits ("12 Station Road") and ordinary words
 *    that are labels elsewhere ("bad customer"). Those two fields therefore run
 *    to the next LABEL rather than stopping at the first number.
 */
import {
  labelMatchesAt,
  normalizeSpokenText,
  sortedSpokenLabels,
  spokenNumber,
  startsAnyLabel,
  tokenizeSpoken,
  valueIndexAfter,
  CONNECTOR_WORDS,
  MONEY_WORDS,
  type SpokenLabel,
} from "@/features/core/voice/voice-text";
import { readSpokenDate } from "@/features/core/voice/spoken-date";
import { gstStateCode } from "@/lib/gstin";
import { isValidIndianCustomerMobile, normaliseCustomerMobile } from "./customer-reliability";

export type CustomerVoiceField =
  | "name"
  | "mobile"
  | "address"
  | "gstNumber"
  | "type"
  | "udharLimit"
  | "dueDate"
  | "promiseToPayDate"
  | "notes";

export type CustomerVoiceFields = {
  name?: string;
  mobile?: string;
  address?: string;
  gstNumber?: string;
  /** Derived from a valid GSTIN, which is the only place it can be known from. */
  stateCode?: string;
  type?: "regular" | "udhar";
  udharLimit?: number;
  dueDate?: string;
  promiseToPayDate?: string;
  notes?: string;
};

const FIELD_LABELS: Record<CustomerVoiceField, string[]> = {
  name: ["customer name", "party name", "name", "naam", "नाम", "ग्राहक का नाम"],
  mobile: [
    "mobile number",
    "phone number",
    "contact number",
    "mobile",
    "phone",
    "contact",
    "number",
    "mobail",
    "मोबाइल नंबर",
    "मोबाइल",
    "फोन",
    "नंबर",
  ],
  address: ["address", "pata", "एड्रेस", "पता", "ठिकाना"],
  gstNumber: ["gst number", "gstin", "gst", "जीएसटीआईएन", "जीएसटी"],
  udharLimit: [
    "udhar limit",
    "credit limit",
    "khata limit",
    "limit",
    "उधार सीमा",
    "उधार लिमिट",
    "क्रेडिट लिमिट",
    "सीमा",
    "लिमिट",
  ],
  dueDate: ["due date", "payment date", "due", "देय तारीख", "देय तिथि", "तारीख"],
  promiseToPayDate: [
    "promise to pay",
    "promise date",
    "promise",
    "vada",
    "वादा",
    "वादा तारीख",
  ],
  notes: ["notes", "note", "remark", "remarks", "नोट", "टिप्पणी"],
  // Not a labelled value — the words below decide it. Kept in the table so the
  // free-text fields know to stop when they reach one.
  type: ["udhar", "khata", "credit", "उधार", "खाता", "regular", "cash", "नकद"],
};

/** Free text: runs to the next label, digits and all. */
const TEXT_FIELDS = new Set<CustomerVoiceField>(["address", "notes"]);

/** Words that say this is a credit customer rather than a walk-in. */
const UDHAR_WORDS = new Set(["udhar", "khata", "credit", "उधार", "खाता", "उधारी"]);
const REGULAR_WORDS = new Set(["regular", "cash", "walkin", "नकद", "नियमित"]);

/** Opens a command without describing the customer — dropped from the name. */
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
  "customer",
  "customers",
  "party",
  "client",
  "naya",
  "nayi",
  "naye",
  "grahak",
  "gahak",
  "jodo",
  "daalo",
  "dalo",
  "banao",
  "नया",
  "नई",
  "नयी",
  "नए",
  "ग्राहक",
  "पार्टी",
  "जोड़ो",
  "जोड़",
  "जोड़ें",
  "डालो",
  "बनाओ",
]);

const SORTED_LABELS: SpokenLabel<CustomerVoiceField>[] = sortedSpokenLabels(FIELD_LABELS);

/** A GSTIN is unmistakable: 15 characters in one fixed shape. */
const GSTIN_SHAPE = /^\d{2}[a-z]{5}\d{4}[a-z][1-9a-z]z[0-9a-z]$/i;

/**
 * Whether a run of tokens can be read as one Indian mobile number.
 *
 * A recogniser breaks a dictated number wherever the speaker drew breath —
 * "98765 43210", sometimes "987 654 3210" — so digits are joined across up to
 * four tokens and the result is checked against the app's own validity rule
 * rather than a length guess.
 */
function readMobileAt(tokens: string[], start: number): { mobile: string; end: number } | null {
  let digits = "";
  for (let index = start; index < tokens.length && index < start + 4; index += 1) {
    if (!/^\d+$/.test(tokens[index])) break;
    digits += tokens[index];
    if (digits.length > 12) break;
    if (isValidIndianCustomerMobile(digits)) {
      return { mobile: normaliseCustomerMobile(digits), end: index };
    }
  }
  return null;
}

/**
 * Read every field a sentence states, and take the name from what is left over.
 *
 * Safe to call on a fragment as well as a whole sentence: "mobile 98765 43210"
 * on its own returns only the mobile, which is what lets the same parser serve
 * both one long sentence and a field-at-a-time conversation.
 */
export function parseSpokenCustomerFields(spoken: string): CustomerVoiceFields {
  const { norm, raw } = tokenizeSpoken(spoken);
  if (!norm.length) return {};

  const consumed = new Set<number>();
  const explicit = new Set<CustomerVoiceField>();
  const fields: CustomerVoiceFields = {};

  const claim = (from: number, to: number) => {
    for (let index = from; index <= to; index += 1) consumed.add(index);
  };

  // Pass 1 — labelled values.
  for (const { field, tokens: label } of SORTED_LABELS) {
    if (field === "type") continue;

    for (let index = 0; index < norm.length; index += 1) {
      if (!labelMatchesAt(norm, index, label, consumed)) continue;
      const labelEnd = index + label.length - 1;
      const valueAt = valueIndexAfter(norm, labelEnd + 1, consumed);
      if (valueAt >= norm.length || consumed.has(valueAt)) continue;
      const alreadyStated = explicit.has(field);

      if (field === "mobile") {
        const found = readMobileAt(norm, valueAt);
        if (!found) continue;
        if (!alreadyStated) {
          fields.mobile = found.mobile;
          explicit.add(field);
        }
        claim(index, found.end);
        continue;
      }

      if (field === "gstNumber") {
        if (!GSTIN_SHAPE.test(norm[valueAt])) continue;
        if (!alreadyStated) {
          assignGstin(fields, raw[valueAt]);
          explicit.add(field);
        }
        claim(index, valueAt);
        continue;
      }

      if (field === "udharLimit") {
        const value = spokenNumber(norm[valueAt]);
        if (value === undefined) continue;
        if (!alreadyStated) {
          fields.udharLimit = value;
          explicit.add(field);
        }
        claim(index, valueAt);
        if (MONEY_WORDS.has(norm[valueAt + 1] ?? "")) claim(valueAt + 1, valueAt + 1);
        if (MONEY_WORDS.has(norm[valueAt - 1] ?? "") && !consumed.has(valueAt - 1)) claim(valueAt - 1, valueAt - 1);
        continue;
      }

      if (field === "dueDate" || field === "promiseToPayDate") {
        const span = spanToNextLabel(norm, valueAt, consumed, 6);
        if (!span.length) continue;
        const date = readSpokenDate(raw.slice(valueAt, valueAt + span.length).join(" "));
        if (!date) continue;
        if (!alreadyStated) {
          if (field === "dueDate") fields.dueDate = date;
          else fields.promiseToPayDate = date;
          explicit.add(field);
        }
        claim(index, valueAt + span.length - 1);
        continue;
      }

      // name / address / notes — words, kept in the spelling they were said in.
      const limit = TEXT_FIELDS.has(field) ? 12 : 4;
      const span = TEXT_FIELDS.has(field)
        ? spanToNextLabel(norm, valueAt, consumed, limit)
        : spanOfWords(norm, valueAt, consumed, limit);
      if (!span.length) continue;
      claim(index, valueAt + span.length - 1);
      if (alreadyStated) continue;
      explicit.add(field);

      const value = raw.slice(valueAt, valueAt + span.length).join(" ");
      if (field === "address") fields.address = value;
      else if (field === "notes") fields.notes = value;
      else fields.name = value;
    }
  }

  // Pass 2 — values that need no label because their shape is unmistakable.
  if (fields.mobile === undefined) {
    for (let index = 0; index < norm.length; index += 1) {
      if (consumed.has(index)) continue;
      const found = readMobileAt(norm, index);
      if (!found) continue;
      fields.mobile = found.mobile;
      claim(index, found.end);
      break;
    }
  }
  if (fields.gstNumber === undefined) {
    for (let index = 0; index < norm.length; index += 1) {
      if (consumed.has(index) || !GSTIN_SHAPE.test(norm[index])) continue;
      assignGstin(fields, raw[index]);
      claim(index, index);
      break;
    }
  }

  // Pass 3 — udhar or walk-in. A stated credit limit settles it on its own:
  // nobody sets a limit on a customer who pays cash.
  const saidUdhar = norm.some((token, index) => UDHAR_WORDS.has(token) && !consumed.has(index));
  const saidRegular = norm.some((token, index) => REGULAR_WORDS.has(token) && !consumed.has(index));
  if (saidUdhar || fields.udharLimit !== undefined) fields.type = "udhar";
  else if (saidRegular) fields.type = "regular";
  norm.forEach((token, index) => {
    if (UDHAR_WORDS.has(token) || REGULAR_WORDS.has(token)) claim(index, index);
  });

  // Pass 4 — the name is the residue.
  if (fields.name === undefined) {
    const leftover: string[] = [];
    norm.forEach((token, index) => {
      if (consumed.has(index)) return;
      if (TRIGGER_WORDS.has(token) || CONNECTOR_WORDS.has(token) || MONEY_WORDS.has(token)) return;
      if (spokenNumber(token) !== undefined) return;
      leftover.push(raw[index]);
    });
    const name = leftover.join(" ").trim();
    // One stray syllable is a mishearing, not somebody's name.
    if (name.length >= 2) fields.name = name;
  }

  return fields;
}

function assignGstin(fields: CustomerVoiceFields, spoken: string) {
  const normalized = spoken.toUpperCase();
  fields.gstNumber = normalized;
  // Only a GSTIN that passes its own checksum can say which state it belongs to;
  // guessing from the first two digits of an invalid one would file the customer
  // under a state the tax return then disagrees with.
  const state = gstStateCode(normalized);
  if (state) fields.stateCode = state;
}

/** Plain words: stops at a number, a label, or a word that opens a command. */
function spanOfWords(tokens: string[], start: number, consumed: ReadonlySet<number>, limit: number) {
  const span: string[] = [];
  for (let index = start; index < tokens.length && span.length < limit; index += 1) {
    if (consumed.has(index)) break;
    const token = tokens[index];
    if (spokenNumber(token) !== undefined) break;
    if (MONEY_WORDS.has(token) || TRIGGER_WORDS.has(token) || CONNECTOR_WORDS.has(token)) break;
    if (startsAnyLabel(SORTED_LABELS, tokens, index, consumed)) break;
    span.push(token);
  }
  return span;
}

/**
 * Free text: runs until the next label, keeping digits and ordinary words.
 *
 * This is what an address needs — "12 Station Road" begins with a number, and
 * stopping at it would file the customer at "Station Road". It is also what a
 * note needs: "bad customer" has to survive intact, and the previous parser cut
 * it to "bad" because it stopped at the word "customer".
 */
function spanToNextLabel(tokens: string[], start: number, consumed: ReadonlySet<number>, limit: number) {
  const span: string[] = [];
  for (let index = start; index < tokens.length && span.length < limit; index += 1) {
    if (consumed.has(index)) break;
    if (startsAnyLabel(SORTED_LABELS, tokens, index, consumed)) break;
    span.push(tokens[index]);
  }
  return span;
}

/** Whether the sentence names a field out loud, rather than just holding values. */
export function statesACustomerFieldLabel(spoken: string): boolean {
  const tokens = normalizeSpokenText(spoken).split(" ").filter(Boolean);
  const none = new Set<number>();
  return tokens.some((_token, index) => startsAnyLabel(SORTED_LABELS, tokens, index, none));
}

/**
 * Read a reply given while one specific field is being asked for.
 *
 * A bare "9876543210" answering "mobile?" has no label to find, so the pending
 * field supplies it. A reply that DOES name a field is treated as a correction
 * and parsed in full, which is what lets someone answer "mobile?" with "no, the
 * address is 12 Station Road" and have it land in the right box.
 */
export function parseCustomerVoiceAnswer(field: CustomerVoiceField, spoken: string): CustomerVoiceFields {
  const parsed = parseSpokenCustomerFields(spoken);
  const named = Object.keys(parsed).filter((key) => key !== "name" && key !== "type");
  if (named.length > 0 && statesACustomerFieldLabel(spoken)) return parsed;

  const { norm, raw } = tokenizeSpoken(spoken);
  if (!norm.length) return {};

  if (field === "mobile") {
    for (let index = 0; index < norm.length; index += 1) {
      const found = readMobileAt(norm, index);
      if (found) return { mobile: found.mobile };
    }
    return {};
  }
  if (field === "udharLimit") {
    const at = norm.findIndex((token) => spokenNumber(token) !== undefined);
    if (at === -1) return {};
    return { udharLimit: spokenNumber(norm[at]), type: "udhar" };
  }
  if (field === "gstNumber") {
    const at = norm.findIndex((token) => GSTIN_SHAPE.test(token));
    if (at === -1) return {};
    const coded: CustomerVoiceFields = {};
    assignGstin(coded, raw[at]);
    return coded;
  }
  if (field === "dueDate" || field === "promiseToPayDate") {
    const date = readSpokenDate(raw.join(" "));
    if (!date) return {};
    return field === "dueDate" ? { dueDate: date } : { promiseToPayDate: date };
  }
  if (field === "type") {
    if (norm.some((token) => UDHAR_WORDS.has(token))) return { type: "udhar" };
    if (norm.some((token) => REGULAR_WORDS.has(token))) return { type: "regular" };
    return {};
  }

  // name / address / notes — everything said, minus the words that only open a
  // command. Digits stay, because a house number is part of an address.
  const words = raw.filter((_token, index) => !TRIGGER_WORDS.has(norm[index]) && !CONNECTOR_WORDS.has(norm[index]));
  const value = words.join(" ").trim();
  if (value.length < 2) return {};
  if (field === "address") return { address: value };
  if (field === "notes") return { notes: value };
  return { name: value };
}
