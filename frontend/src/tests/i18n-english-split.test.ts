import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EN_CRITICAL_MODULES, englishCriticalTranslations } from "@/features/core/settings/translations/english-critical";
import { EN_DEFERRED_MODULES, englishDeferredTranslations } from "@/features/core/settings/translations/english-deferred";
import { EN_CLOUD_MODULES, englishCloudTranslations } from "@/features/core/settings/translations/english-cloud";
import { EN_MODULES, englishTranslations } from "@/features/core/settings/translations/english";
import { SHOP_CREDIT_WORD, SHOP_TENDER_WORD } from "@/features/core/settings/shop-credit";

const i18nSource = readFileSync("src/features/core/settings/i18n.tsx", "utf8");

/**
 * English is the catalogue that is ALWAYS present, so every key ever added grew
 * the startup download for every shop in every language. Translating suppliers
 * and orders added ~250 keys and pushed the raw startup budget past its ceiling
 * with the gzip line 2.2 kB from its own — so English is now split the way Hindi
 * already was.
 *
 * These cases protect the split, because breaking it is silent: a value import
 * of the deferred half in i18n.tsx typechecks, passes every other test, and
 * quietly puts nine tables back in the shell. Only `bundle:check` would notice,
 * and only once it had already grown past the line again.
 */
describe("English critical/deferred split", () => {
  it("keeps the deferred half out of the startup chunk", () => {
    // The one assertion that actually defends the budget. `import type` is erased;
    // a plain `import` is not.
    expect(i18nSource).toContain('import type { englishDeferredTranslations } from "./translations/english-deferred";');
    expect(i18nSource).not.toMatch(/^import \{[^}]*englishDeferredTranslations/m);
    // translations/english.ts composes all three tiers, so importing it here would
    // be the same mistake wearing a different name.
    expect(i18nSource).not.toContain('from "./translations/english"');
    // The cloud tier is held to the same rule, and to a stricter one below: a value
    // import would put it in the shell AND back into the offline precache.
    expect(i18nSource).toContain('import type { englishCloudTranslations } from "./translations/english-cloud";');
    expect(i18nSource).not.toMatch(/^import \{[^}]*englishCloudTranslations/m);
  });

  it("covers the boot path with the half that ships in the shell", () => {
    // Same pair, same evidence as the Hindi split: routes.tsx warms DashboardPage
    // and BillingPage, and shell.ts holds the dashboard/nav/page/chrome keys.
    expect(Object.keys(EN_CRITICAL_MODULES).sort()).toEqual(["billing", "shell"]);
  });

  it("puts every registered module in exactly one tier", () => {
    const critical = Object.keys(EN_CRITICAL_MODULES);
    const deferred = Object.keys(EN_DEFERRED_MODULES);
    const cloud = Object.keys(EN_CLOUD_MODULES);
    const tiers = [critical, deferred, cloud];
    for (const [at, tier] of tiers.entries()) {
      const others = tiers.filter((_, index) => index !== at).flat();
      expect(tier.filter((name) => others.includes(name))).toEqual([]);
    }
    expect([...critical, ...deferred, ...cloud].sort()).toEqual(Object.keys(EN_MODULES).sort());
  });

  it("admits a table to the cloud tier only if no offline screen reads its keys", () => {
    // This is the whole safety argument for not precaching that tier, and it is
    // the one thing a human gets wrong: the test is not "does this feature need
    // the cloud" but "can any offline screen read one of these keys". accounting
    // and assistant both look cloud-only and are NOT — Layout.tsx reads
    // accounting.* for the nav, BillingAssistantStrip reads assistant.* on the
    // billing screen — so each would render a raw key on an offline till.
    const source = (path: string) => readFileSync(path, "utf8");
    const reach = ["src/components/layout/Layout.tsx", "src/components/layout/MobileAppChrome.tsx", "src/app/routes.tsx"];
    for (const table of Object.keys(EN_CLOUD_MODULES)) {
      for (const path of reach) {
        // routes.tsx may only name the prefix inside a cloudPage() lazy import.
        const offending = new RegExp(`["'\`]${table}\\.[A-Za-z0-9_.]+["'\`]`);
        expect(offending.test(source(path)), `${path} reads ${table}.* copy`).toBe(false);
      }
    }
  });

  it("recombines into the same dictionary the app used to hold in one object", () => {
    expect(englishTranslations).toEqual({ ...englishCriticalTranslations, ...englishDeferredTranslations, ...englishCloudTranslations });
  });

  it("keeps the credit word in the half the till can reach", () => {
    // The till renders the tender word inside a `billing.*` string, and the
    // printed receipt resolves it with no React at all. Either one landing in the
    // deferred half would show a bare "{credit}" slot at first paint — on the
    // highest-frequency screen in the product, and then on paper.
    for (const map of [SHOP_CREDIT_WORD, SHOP_TENDER_WORD]) {
      for (const key of Object.values(map)) {
        expect(key in englishCriticalTranslations, key).toBe(true);
      }
    }
  });

  it("resolves a key whose table has not landed yet without crashing", () => {
    // The one behaviour change: `en[key]` can be absent for one round trip. It
    // must degrade to the key, never to `undefined` — `interpolate` calls
    // `.replace` on whatever it is handed, so undefined is a white screen.
    expect(i18nSource).toContain("hindiValue ?? en[key] ?? key");
  });

  it("fetches the deferred half for every shop, not only English ones", () => {
    // Hindi shops need it too: it is the fallback under every gap in their own
    // table, including the whole window before their chunk lands.
    expect(i18nSource).toMatch(/^void loadDeferredEnglish\(\);$/m);
    expect(i18nSource).toContain("setEnglishTier((tier) => tier + 1)");
  });

  it("actually moves the bulk of the catalogue off the startup path", () => {
    const size = (table: Record<string, string>) =>
      Object.entries(table).reduce((total, [key, value]) => total + key.length + value.length, 0);
    expect(size(englishCriticalTranslations) / size(englishTranslations)).toBeLessThan(0.5);
  });
});
