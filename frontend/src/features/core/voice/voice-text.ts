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

  // Everything between eleven and ninety-nine, which this table simply did not
  // have. Hindi numerals are irregular — twenty-six is chhabbis, not bees-chhe —
  // so there is nothing to derive them from; they have to be listed.
  //
  // Their absence was not a missing nicety. A shop dictating "Tata Salt chhabbis
  // rupaye" had the number read as an ordinary word, so it fell through into the
  // product NAME and the price was lost — and the prices a counter says out loud
  // are overwhelmingly in exactly this range.
  //
  // Spellings that are also common Hindi words are left out on purpose: tera
  // (yours), bara (big) and sola would each cost more in corrupted names than
  // they earn. The full forms terah, barah and solah carry those numbers.
  eleven: 11, gyarah: 11, ग्यारह: 11,
  twelve: 12, barah: 12, baarah: 12, बारह: 12,
  thirteen: 13, terah: 13, तेरह: 13,
  fourteen: 14, chaudah: 14, चौदह: 14,
  fifteen: 15, pandrah: 15, पंद्रह: 15, पन्द्रह: 15,
  sixteen: 16, solah: 16, सोलह: 16,
  seventeen: 17, satrah: 17, सत्रह: 17,
  eighteen: 18, atharah: 18, अठारह: 18,
  nineteen: 19, unnis: 19, उन्नीस: 19,
  ikkis: 21, इक्कीस: 21,
  bais: 22, baees: 22, बाईस: 22,
  teis: 23, तेईस: 23,
  chaubis: 24, chaubees: 24, चौबीस: 24,
  pachis: 25, pachees: 25, pachchis: 25, पच्चीस: 25,
  chhabbis: 26, chabbis: 26, छब्बीस: 26,
  sattais: 27, सत्ताईस: 27,
  atthais: 28, अट्ठाईस: 28,
  untis: 29, उनतीस: 29,
  ikattis: 31, इकतीस: 31,
  battis: 32, बत्तीस: 32,
  taintis: 33, तैंतीस: 33,
  chauntis: 34, चौंतीस: 34,
  paintis: 35, पैंतीस: 35,
  chhattis: 36, छत्तीस: 36,
  saintis: 37, सैंतीस: 37,
  adtis: 38, अड़तीस: 38,
  untalis: 39, उनतालीस: 39,
  iktalis: 41, इकतालीस: 41,
  bayalis: 42, बयालीस: 42,
  taintalis: 43, तैंतालीस: 43,
  chavalis: 44, चवालीस: 44,
  paintalis: 45, पैंतालीस: 45,
  chhiyalis: 46, छियालीस: 46,
  saintalis: 47, सैंतालीस: 47,
  adtalis: 48, अड़तालीस: 48,
  unchas: 49, उनचास: 49,
  ikyavan: 51, इक्यावन: 51,
  bavan: 52, बावन: 52,
  tirpan: 53, तिरपन: 53,
  chauvan: 54, चौवन: 54,
  pachpan: 55, पचपन: 55,
  chhappan: 56, छप्पन: 56,
  satavan: 57, सत्तावन: 57,
  atthavan: 58, अट्ठावन: 58,
  unsath: 59, उनसठ: 59,
  sixty: 60, saath: 60, sath: 60, साठ: 60,
  iksath: 61, इकसठ: 61,
  basath: 62, बासठ: 62,
  tirsath: 63, तिरसठ: 63,
  chausath: 64, चौंसठ: 64,
  painsath: 65, पैंसठ: 65,
  chhiyasath: 66, छियासठ: 66,
  sarsath: 67, सड़सठ: 67,
  arsath: 68, अड़सठ: 68,
  unhattar: 69, उनहत्तर: 69,
  seventy: 70, sattar: 70, सत्तर: 70,
  ikhattar: 71, इकहत्तर: 71,
  bahattar: 72, बहत्तर: 72,
  tihattar: 73, तिहत्तर: 73,
  chauhattar: 74, चौहत्तर: 74,
  pachhattar: 75, pachattar: 75, पचहत्तर: 75,
  chhihattar: 76, छिहत्तर: 76,
  satattar: 77, सतहत्तर: 77,
  athattar: 78, अठहत्तर: 78,
  unasi: 79, उन्यासी: 79,
  eighty: 80, assi: 80, अस्सी: 80,
  ikyasi: 81, इक्यासी: 81,
  bayasi: 82, बयासी: 82,
  tirasi: 83, तिरासी: 83,
  chaurasi: 84, चौरासी: 84,
  pachasi: 85, पचासी: 85,
  chhiyasi: 86, छियासी: 86,
  satasi: 87, सत्तासी: 87,
  athasi: 88, अट्ठासी: 88,
  navasi: 89, नवासी: 89,
  ninety: 90, nabbe: 90, नब्बे: 90,
  ikyanve: 91, इक्यानवे: 91,
  banve: 92, बानवे: 92,
  tiranve: 93, तिरानवे: 93,
  chauranve: 94, चौरानवे: 94,
  panchanve: 95, पंचानवे: 95,
  chhiyanve: 96, छियानवे: 96,
  sattanve: 97, सत्तानवे: 97,
  atthanve: 98, अट्ठानवे: 98,
  ninyanve: 99, निन्यानवे: 99,
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
