import { describe, expect, it } from "vitest";
import { englishTranslations, loadHindiDictionary } from "@/features/settings/i18n";

/**
 * The Hindi table is typed as `Record<keyof typeof <domain>En, string>`, so a
 * missing key is normally a compile error. These tests cover what the type
 * system cannot see: that the lazily-loaded chunk really resolves, that no
 * Hindi value was left as its English placeholder, and that interpolation slots
 * survive translation — a dropped `{amount}` silently prints the wrong receipt.
 */
describe("Hindi dictionary completeness", () => {
  it("resolves the lazily loaded chunk", async () => {
    const hindi = await loadHindiDictionary();
    expect(hindi).not.toBeNull();
  });

  it("covers every English key", async () => {
    const hindi = await loadHindiDictionary();
    const missing = Object.keys(englishTranslations).filter((key) => !hindi?.[key as keyof typeof englishTranslations]);
    expect(missing).toEqual([]);
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

  it("does not leave billing, products or customer strings untranslated", async () => {
    const hindi = await loadHindiDictionary();
    // A handful of values are intentionally identical: brand names, tax
    // abbreviations, channel names and numeric placeholders read the same in
    // both languages, so translating them would make the screen worse.
    const intentionallyShared = new Set([
      "English", "Hindi / Hinglish", "Fast POS", "Advanced", "UPI", "GST", "MRP",
      "WhatsApp", "SMS", "0.00", "₹ 0", "10 या 5%", "namak, salt, साल्ट",
      "KOS-XXXX-XXXX-XXXX", "GST रेट", "SKU / बारकोड", "उधार (₹)",
      // Pure format strings: every word in them is a placeholder or punctuation,
      // so there is nothing to translate.
      "{tier} · ", "{action} · {amount}",
      // "MRP" is the same abbreviation in Hindi; only the ₹ symbol accompanies it.
      "MRP (₹)",
    ]);

    const untranslated = Object.entries(englishTranslations)
      .filter(([key]) => /^(billing|products|customers)\./.test(key))
      .filter(([key, english]) => {
        const translated = hindi?.[key as keyof typeof englishTranslations];
        return translated === english && !intentionallyShared.has(english);
      })
      .map(([key, english]) => `${key} = "${english}"`);

    expect(untranslated).toEqual([]);
  });
});
