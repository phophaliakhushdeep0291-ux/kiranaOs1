import { describe, expect, it } from "vitest";
import { EN_MODULES, englishTranslations, loadHindiDictionary } from "@/features/core/settings/i18n";
import { HI_MODULES } from "@/features/core/settings/translations/hindi";
import { SHARED_TRANSLATION_VALUES } from "./i18n-shared-values";

/**
 * The Hindi table is typed as `Record<keyof typeof <domain>En, string>`, so a missing
 * key is normally a compile error. These tests cover what the type system cannot see:
 * that the lazily-loaded chunk really resolves, that every REGISTERED module is on
 * both sides, that no Hindi value was left as its English placeholder, and that
 * interpolation slots survive translation — a dropped `{amount}` prints a wrong receipt.
 */
describe("Hindi dictionary completeness", () => {
  it("resolves the lazily loaded chunk", async () => {
    const hindi = await loadHindiDictionary();
    expect(hindi).not.toBeNull();
  });

  it("registers the same modules on both sides", () => {
    // A module can be spread into the English catalogue and forgotten in hindi.ts.
    // The spread still typechecks, and the app ships English strings mid-bill.
    expect(Object.keys(HI_MODULES).sort()).toEqual(Object.keys(EN_MODULES).sort());
  });

  it("accounts for every English key in exactly one registered module", () => {
    // Guards the duplication between the spread that types TranslationKey and the
    // EN_MODULES map the rest of these tests walk: a module in one and not the other
    // would make "every registered module" quietly mean "every module I remembered".
    const fromModules = new Set(Object.values(EN_MODULES).flatMap((table) => Object.keys(table)));
    const missing = Object.keys(englishTranslations).filter((key) => !fromModules.has(key));
    expect(missing).toEqual([]);
  });

  it("covers every English key in every registered module", async () => {
    const hindi = await loadHindiDictionary();
    const missing: string[] = [];
    for (const [moduleName, table] of Object.entries(EN_MODULES)) {
      for (const key of Object.keys(table)) {
        const translated = hindi?.[key as keyof typeof englishTranslations];
        // Empty and whitespace-only count as missing: both render as a blank label,
        // which is worse than the English word it was meant to replace.
        if (!translated || translated.trim() === "") missing.push(`${moduleName}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("leaves no string untranslated in any registered module", async () => {
    const hindi = await loadHindiDictionary();

    // A Hindi value identical to its English one is how an untranslated string hides:
    // it satisfies the type, it satisfies "not missing", and it reads as English on a
    // Hindi counter. Anything genuinely identical in both languages — brand names, tax
    // abbreviations, pure format strings — is listed explicitly in i18n-shared-values.
    const untranslated: string[] = [];
    for (const [moduleName, table] of Object.entries(EN_MODULES)) {
      for (const [key, english] of Object.entries(table)) {
        const translated = hindi?.[key as keyof typeof englishTranslations];
        if (translated === english && !SHARED_TRANSLATION_VALUES.has(english)) {
          untranslated.push(`${moduleName}: ${key} = "${english}"`);
        }
      }
    }
    expect(untranslated).toEqual([]);
  });

  it("keeps the shared-value allowlist honest", async () => {
    // An allowlist that outlives the strings it excused silently weakens the test
    // above. Every entry must still be a real English value that Hindi repeats.
    const hindi = await loadHindiDictionary();
    const stale = [...SHARED_TRANSLATION_VALUES].filter((value) => {
      const keys = Object.entries(englishTranslations).filter(([, english]) => english === value);
      if (keys.length === 0) return true;
      return !keys.some(([key]) => hindi?.[key as keyof typeof englishTranslations] === value);
    });
    expect(stale).toEqual([]);
  });

  it("keeps every interpolation placeholder", async () => {
    const hindi = await loadHindiDictionary();
    const slots = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();

    const drifted: string[] = [];
    for (const [key, english] of Object.entries(englishTranslations)) {
      const translated = hindi?.[key as keyof typeof englishTranslations];
      if (!translated) continue;
      const expected = slots(english);
      if (expected.length === 0) continue;
      if (JSON.stringify(slots(translated)) !== JSON.stringify(expected)) {
        drifted.push(`${key}: expected ${expected.join(",")} got ${slots(translated).join(",") || "none"}`);
      }
    }
    expect(drifted).toEqual([]);
  });
});
