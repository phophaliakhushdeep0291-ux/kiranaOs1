import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { productsEn } from "@/features/core/settings/translations/products";
import { productsHi } from "@/features/core/settings/translations/products.hi";
import { customersEn } from "@/features/core/settings/translations/customers";
import { customersHi } from "@/features/core/settings/translations/customers.hi";
import {
  PRODUCT_VOICE_DISPLAY_KEYS,
  PRODUCT_VOICE_PROMPT_KEYS,
} from "@/features/core/products/product-voice-session";
import {
  CUSTOMER_VOICE_DISPLAY_KEYS,
  CUSTOMER_VOICE_PROMPT_KEYS,
} from "@/features/core/customers/customer-voice-session";

/**
 * Asking in Hinglish while speaking something a voice can pronounce.
 *
 * The parser has understood Hinglish from the start — naam, chhodo, theek,
 * chhabbis — but the app only ever asked back in English or in textbook
 * Devanagari. A counter reads Roman fastest, so that is what the bar now shows.
 *
 * The spoken half cannot follow it there. Speech synthesis is handed
 * `lang = "hi-IN"` (voice-recognition.ts), and a hi-IN voice reading Roman text
 * produces something between an accent and nonsense, while it pronounces
 * Devanagari correctly. So the two halves are deliberately different strings:
 * ask.* is spoken, say.* is shown.
 *
 * In English both resolve to the same sentence, so a shop working in English
 * sees no change at all.
 */

const devanagari = (text: string) =>
  [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code >= 0x900 && code <= 0x97f;
  });

/** The one line that is both spoken and shown, so the only one with a twin. */
const CONVERSATION_LINES: [string, string][] = [["ready", "sayReady"]];

/**
 * Everything on the strip a shop reads while it is talking.
 *
 * None of these is spoken — only ask.* and ready reach the speech engine — so
 * none has a Devanagari twin to keep. Half a bar in Hinglish and half in
 * Devanagari read as unfinished, so it now runs in one register from the button
 * at the top to the controls hint at the bottom.
 */
const SHOWN_BAR_LINES = [
  "start",
  "listening",
  "starting",
  "stop",
  "speakToggle",
  "heard",
  "notUnderstood",
  "unsupported",
  "hint",
  "controls",
  "filled",
  "sayReady",
];

describe.each([
  ["products", productsEn as Record<string, string>, productsHi as Record<string, string>, PRODUCT_VOICE_PROMPT_KEYS, PRODUCT_VOICE_DISPLAY_KEYS],
  ["customers", customersEn as Record<string, string>, customersHi as Record<string, string>, CUSTOMER_VOICE_PROMPT_KEYS, CUSTOMER_VOICE_DISPLAY_KEYS],
] as const)("%s voice prompts", (domain, en, hi, spokenKeys, shownKeys) => {
  const fields = Object.keys(spokenKeys);

  it("has a shown line for every field that has a spoken one", () => {
    expect(Object.keys(shownKeys)).toEqual(fields);
    for (const field of fields) {
      const shown = (shownKeys as Record<string, string>)[field];
      expect(en[shown], `${shown} missing from the English dictionary`).toBeTruthy();
      expect(hi[shown], `${shown} missing from the Hindi dictionary`).toBeTruthy();
    }
  });

  it("shows Hinglish and speaks Devanagari", () => {
    for (const field of fields) {
      const spoken = hi[(spokenKeys as Record<string, string>)[field]];
      const shown = hi[(shownKeys as Record<string, string>)[field]];
      // A field whose question is the same in both scripts (a bare "HSN code?")
      // has nothing to transliterate, so only the spoken side is required to
      // carry Devanagari where its own English differs from it.
      if (devanagari(spoken)) expect(devanagari(shown), `${field} is shown in Devanagari`).toBe(false);
    }
  });

  it("leaves an English shop exactly as it was", () => {
    for (const field of fields) {
      expect(en[(shownKeys as Record<string, string>)[field]]).toBe(en[(spokenKeys as Record<string, string>)[field]]);
    }
    for (const [spoken, shown] of CONVERSATION_LINES) {
      expect(en[`${domain}.voice.${shown}`]).toBe(en[`${domain}.voice.${spoken}`]);
    }
  });

  it("reads in Hinglish the whole way down the bar", () => {
    for (const key of SHOWN_BAR_LINES) {
      const line = hi[`${domain}.voice.${key}`];
      expect(line, `${domain}.voice.${key} missing`).toBeTruthy();
      expect(devanagari(line), `${domain}.voice.${key} should read in Roman`).toBe(false);
    }
    // The closing line is the one thing that is also spoken, and that half stays
    // in Devanagari so a hi-IN voice can pronounce it.
    expect(devanagari(hi[`${domain}.voice.ready`]), `${domain}.voice.ready is spoken`).toBe(true);
  });
});

describe("the bars are wired to the right half", () => {
  it.each([
    ["src/features/core/products/pages/components/ProductVoiceDictation.tsx", "PRODUCT"],
    ["src/features/core/customers/pages/components/CustomerVoiceDictation.tsx", "CUSTOMER"],
  ])("%s speaks the ask and shows the say", (file, prefix) => {
    const source = readFileSync(file, "utf8");
    // Spoken: the app-language question.
    expect(source).toContain(`promptFor: (field) => t(${prefix}_VOICE_PROMPT_KEYS[field])`);
    // Shown: the Hinglish one.
    expect(source).toContain(`t(${prefix}_VOICE_DISPLAY_KEYS[dictation.pending])`);
    expect(source).not.toContain(`t(${prefix}_VOICE_PROMPT_KEYS[dictation.pending])`);
  });

  it("shows the Hinglish closing line without changing what is spoken", () => {
    const hook = readFileSync("src/features/core/voice/use-voice-dictation.ts", "utf8");
    // The closing line is both spoken and written into the note, and those are
    // now two different strings.
    expect(hook).toContain("if (!field) setNote(readyNote ?? line);");
    expect(hook).toContain("const line = field ? promptFor(field) : readyPrompt;");
    const product = readFileSync("src/features/core/products/pages/components/ProductVoiceDictation.tsx", "utf8");
    expect(product).toContain('readyPrompt: t("products.voice.ready")');
    expect(product).toContain('readyNote: t("products.voice.sayReady")');
  });
});
