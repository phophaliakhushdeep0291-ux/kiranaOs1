/**
 * The shared toolkit for reading a dictated form field.
 *
 * Products and customers are dictated the same way — a sentence with labels in
 * it ("cost 40", "mobile 98765…", "उधार सीमा 5000") — and both are read by
 * walking the tokens and CONSUMING the ones a field claims, so that whatever is
 * left over is the name. Only the vocabulary differs, so only the vocabulary
 * lives in the feature modules; the machinery lives here.
 *
 * Everything is bilingual because the mic already listens in hi-IN when the shop
 * works in Hindi (voice-recognition.ts), so Devanagari is what comes back.
 */

/** A token stream kept in both spellings: normalised for matching, raw for output. */
export type SpokenTokens = {
  /** Lowercased, digit-folded, punctuation-stripped. What labels match against. */
  norm: string[];
  /** The words as they were said. What a person's name or address is built from. */
  raw: string[];
};

const HINDI_DIGITS = "०१२३४५६७८९";

/**
 * Lowercase, fold Devanagari digits to ASCII, drop punctuation.
 *
 * Deliberately not billing's normalizeSearchText: that strips the decimal point
 * along with every other non-letter, which turns a spoken "45.50" into two
 * separate numbers. A parser that reads prices cannot afford that, so the dot
 * survives between digits and is stripped everywhere else.
 */
export function normalizeSpokenText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[०-९]/g, (digit) => String(HINDI_DIGITS.indexOf(digit)))
    .replace(/(\d)[.,](\d)/g, "$1․$2")
    .replace(/[^\p{L}\p{N}\p{M}․]+/gu, " ")
    .replace(/․/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a sentence into matched normalised and raw token streams.
 *
 * The two arrays stay index-aligned so a field can be MATCHED on the normalised
 * spelling and EMITTED in the original one. That distinction is not cosmetic for
 * people: a customer called Ramesh Kumar should not be filed as "ramesh kumar"
 * merely because matching happens in lower case.
 */
export function tokenizeSpoken(text: string): SpokenTokens {
  const raw = text
    .replace(/[^\p{L}\p{N}\p{M}.\-/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const norm = raw.map((token) => normalizeSpokenText(token));

  // A token that normalises to nothing (stray punctuation) would break the
  // index alignment the raw stream depends on, so it is dropped from both.
  const keep = norm.map((token, index) => (token ? index : -1)).filter((index) => index >= 0);
  return { norm: keep.map((index) => norm[index]), raw: keep.map((index) => raw[index]) };
}

/** Spoken numerals, for a recogniser that transcribes the word instead of the digit. */
export const NUMBER_WORDS: Record<string, number> = {
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
  das: 10,
  dus: 10,
  ten: 10,
  bees: 20,
  bis: 20,
  twenty: 20,
  tees: 30,
  thirty: 30,
  chalis: 40,
  chaalis: 40,
  forty: 40,
  pachas: 50,
  pachaas: 50,
  fifty: 50,
  sau: 100,
  hundred: 100,
  hazaar: 1000,
  hajar: 1000,
  thousand: 1000,
  aadha: 0.5,
  half: 0.5,
  // Fractions a counter says constantly for weight. billing-voice-parser has had
  // these for a while; this table did not, so the same shopkeeper saying
  // "डेढ़ किलो चीनी" was understood at the till but filed a PRODUCT literally named
  // "डेढ़ किलो चीनी" — the word fell through to the name because nothing read it as
  // a quantity. They also make readSpokenAmount right for free: "डेढ़ सौ" is 150.
  sava: 1.25, सवा: 1.25,
  dedh: 1.5, "डेढ़": 1.5, डेढ: 1.5,
  dhai: 2.5, ढाई: 2.5,
  paun: 0.75, पौन: 0.75,
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
  बीस: 20,
  तीस: 30,
  चालीस: 40,
  पचास: 50,
  सौ: 100,
  हजार: 1000,
  हज़ार: 1000,
  lakh: 100000,
  lakhs: 100000,
  lac: 100000,
  लाख: 100000,
  आधा: 0.5,
};

export function spokenNumber(token: string | undefined): number | undefined {
  if (!token) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
  return NUMBER_WORDS[token];
}

/**
 * Words that MULTIPLY the number in front of them rather than standing alone.
 *
 * "paanch sau" is five hundreds, not a five followed by a hundred. Read one
 * token at a time it comes back as 5, which is how a ₹500 MRP and a ₹5,000
 * credit limit were both being filed off by a factor of a hundred or a thousand.
 */
const AMOUNT_MULTIPLIERS: Record<string, number> = {
  sau: 100,
  hundred: 100,
  सौ: 100,
  hazaar: 1000,
  hazar: 1000,
  hajar: 1000,
  thousand: 1000,
  हजार: 1000,
  हज़ार: 1000,
  lakh: 100000,
  lakhs: 100000,
  lac: 100000,
  लाख: 100000,
};

export type SpokenAmount = { value: number; end: number };

/**
 * Read one amount, however many tokens a person spent saying it.
 *
 * Handles the two shapes Indian speech actually uses — "paanch sau" (500) and
 * "do sau pachas" (250) — and deliberately nothing looser than that. A trailing
 * part is only taken when it is SMALLER than the multiplier it follows, so
 * "udhar limit paanch hazaar" cannot reach past its own value and swallow the
 * next field's bare number.
 */
export function readSpokenAmount(tokens: string[], start: number): SpokenAmount | undefined {
  const base = spokenNumber(tokens[start]);
  if (base === undefined) return undefined;

  const multiplier = AMOUNT_MULTIPLIERS[tokens[start + 1] ?? ""];
  // A multiplier standing where the number should be is already its own value:
  // "sau" on its own is a hundred, and must not be multiplied by what follows.
  if (multiplier === undefined || AMOUNT_MULTIPLIERS[tokens[start] ?? ""] !== undefined) {
    return { value: base, end: start };
  }

  let value = base * multiplier;
  let end = start + 1;

  const tail = spokenNumber(tokens[end + 1]);
  if (tail !== undefined && tail < multiplier && AMOUNT_MULTIPLIERS[tokens[end + 1] ?? ""] === undefined) {
    value += tail;
    end += 1;
  }
  return { value, end };
}

/** Words that carry a price but are not part of it. */
export const MONEY_WORDS = new Set([
  "rs",
  "rupee",
  "rupees",
  "rupaye",
  "rupaya",
  "rupay",
  "रुपये",
  "रुपया",
  "रुपए",
  "र",
]);

export const PERCENT_WORDS = new Set(["percent", "percentage", "pct", "प्रतिशत", "फीसदी"]);

/** Said between a label and its value — "cost is 40", "daam hai 45". */
export const CONNECTOR_WORDS = new Set([
  "is",
  "of",
  "at",
  "for",
  "the",
  "a",
  "an",
  "hai",
  "he",
  "ka",
  "ke",
  "ki",
  "को",
  "है",
  "का",
  "के",
  "की",
  "में",
]);

/** One spoken label, pre-split into the tokens it has to match. */
export type SpokenLabel<TField extends string> = { field: TField; tokens: string[] };

/**
 * Flatten a vocabulary into match order: longest label first.
 *
 * That ordering is what keeps "cost price" from being read as the "price"
 * (selling) label, and "low stock" from being read as "stock". Ties break on the
 * first token's length so the more specific spelling still wins.
 */
export function sortedSpokenLabels<TField extends string>(
  vocabulary: Record<TField, string[]>,
): SpokenLabel<TField>[] {
  return (Object.entries(vocabulary) as Array<[TField, string[]]>)
    .flatMap(([field, labels]) => labels.map((label) => ({ field, tokens: label.split(" ") })))
    .sort((a, b) => b.tokens.length - a.tokens.length || b.tokens[0].length - a.tokens[0].length);
}

export function labelMatchesAt(
  tokens: string[],
  index: number,
  label: string[],
  consumed: ReadonlySet<number>,
) {
  if (index + label.length > tokens.length) return false;
  for (let offset = 0; offset < label.length; offset += 1) {
    if (consumed.has(index + offset)) return false;
    if (tokens[index + offset] !== label[offset]) return false;
  }
  return true;
}

export function startsAnyLabel<TField extends string>(
  labels: SpokenLabel<TField>[],
  tokens: string[],
  index: number,
  consumed: ReadonlySet<number>,
) {
  return labels.some((entry) => labelMatchesAt(tokens, index, entry.tokens, consumed));
}

/**
 * Where a label's value starts: the first token after it that is not filler.
 *
 * Only connector words are skipped, and never a number, so "cost is 40" reaches
 * the 40 while "cost 40 selling 45" cannot run past its own value into the next
 * field's.
 */
export function valueIndexAfter(tokens: string[], start: number, consumed: ReadonlySet<number>) {
  let index = start;
  while (index < tokens.length && !consumed.has(index) && CONNECTOR_WORDS.has(tokens[index])) {
    index += 1;
  }
  return index;
}

export function uniqueWords(words: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const key = word.toLocaleLowerCase("en-IN");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}
