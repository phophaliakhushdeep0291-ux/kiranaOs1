import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EN_MODULES } from "@/features/core/settings/translations/english";
import { HI_CRITICAL_MODULES, hindiCriticalTranslations } from "@/features/core/settings/translations/hindi-critical";
import { HI_DEFERRED_MODULES, hindiDeferredTranslations } from "@/features/core/settings/translations/hindi-deferred";
import { HI_CLOUD_MODULES, hindiCloudTranslations } from "@/features/core/settings/translations/hindi-cloud";
import { EN_CLOUD_MODULES } from "@/features/core/settings/translations/english-cloud";
import { HI_MODULES, hindiTranslations } from "@/features/core/settings/translations/hindi";

/**
 * Hindi is the default language and main.tsx blocks the first paint on the
 * CRITICAL half of its dictionary, so what lives in which half is a startup
 * budget, not a filing decision.
 *
 * The completeness test next door proves the two halves still add up to a full
 * dictionary. These cases protect the split itself: that the boot screens are
 * translated by the half that blocks paint, that nothing is in both halves, and
 * that a new module cannot be added without landing in exactly one of them.
 *
 * The failure this prevents is quiet. Move `billing.*` into the deferred half and
 * every existing test still passes — the dictionary is complete, the keys all
 * resolve — while a Hindi counter's billing screen renders in English for a round
 * trip on every cold start.
 */
describe("Hindi critical/deferred split", () => {
  it("translates the boot path in the half that blocks first paint", () => {
    // routes.tsx warms DashboardPage and BillingPage as "the two highest-frequency
    // workspaces", and shell holds the dashboard/nav/page/chrome keys. That pair is
    // the boot path, so it is what the blocking half has to cover.
    expect(Object.keys(HI_CRITICAL_MODULES).sort()).toEqual(["billing", "shell"]);
  });

  it("keeps every English key of a critical module in the critical half", () => {
    // Guards the per-key edge the module list above cannot see: a `billing.` string
    // added to English and answered in the deferred table would still typecheck and
    // still be "complete", but would be English at first paint.
    const missing: string[] = [];
    for (const [moduleName, table] of Object.entries(HI_CRITICAL_MODULES)) {
      const english = EN_MODULES[moduleName as keyof typeof EN_MODULES];
      for (const key of Object.keys(english)) {
        if (!(key in table)) missing.push(`${moduleName}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("puts every registered module in exactly one tier", () => {
    const critical = Object.keys(HI_CRITICAL_MODULES);
    const deferred = Object.keys(HI_DEFERRED_MODULES);
    const cloud = Object.keys(HI_CLOUD_MODULES);
    const tiers = [critical, deferred, cloud];
    for (const [at, tier] of tiers.entries()) {
      const others = tiers.filter((_, index) => index !== at).flat();
      expect(tier.filter((name) => others.includes(name))).toEqual([]);
    }
    const all = [...critical, ...deferred, ...cloud].sort();
    expect(all).toEqual(Object.keys(HI_MODULES).sort());
    expect(all).toEqual(Object.keys(EN_MODULES).sort());
  });

  it("splits the cloud tier identically on both sides", () => {
    // A table moved out of the deferred half on one side only would leave a
    // cloud screen half-translated, and the completeness test could not see it:
    // it walks EN_MODULES, which still contains the table either way.
    expect(Object.keys(HI_CLOUD_MODULES).sort()).toEqual(Object.keys(EN_CLOUD_MODULES).sort());
  });

  it("recombines into the same dictionary the app used to load in one chunk", () => {
    expect(hindiTranslations).toEqual({ ...hindiCriticalTranslations, ...hindiDeferredTranslations, ...hindiCloudTranslations });
  });

  it("keeps the deferred half off the critical path", () => {
    // The whole point of the split: the blocking half must stay materially smaller
    // than the dictionary it was carved out of. Measured in characters rather than
    // bytes so the assertion does not depend on the bundler, but Devanagari is 3
    // bytes per character in UTF-8, so the ratio is the one that ships.
    const size = (table: Record<string, string>) =>
      Object.entries(table).reduce((total, [key, value]) => total + key.length + value.length, 0);
    const criticalShare = size(hindiCriticalTranslations) / size(hindiTranslations);
    expect(criticalShare).toBeLessThan(0.5);
  });

  it("applies both halves in the provider, not just the one that arrives first", () => {
    // The effect guard is the subtle half of this change. `if (language !== "hi"
    // || hindi) return` was correct when one chunk held everything and became a bug
    // the moment there were two: the critical half satisfies `hindi`, so the
    // deferred half would never be requested and every screen outside billing would
    // read English forever.
    const source = readFileSync("src/features/core/settings/i18n.tsx", "utf8");
    expect(source).toContain("void loadCriticalHindiDictionary().then(apply)");
    expect(source).toContain("void loadHindiDictionary().then(apply)");
    expect(source).not.toMatch(/if \(language !== "hi" \|\| hindi\) return;/);
  });

  it("applies a Hindi stage the provider is not allowed to request", () => {
    // The cloud tier lands when an administration screen opens, not at boot, so
    // the provider cannot await it by name — doing so would request it for every
    // Hindi shop and undo the reason it is kept out of the offline install. But
    // `absorbHindiStage` rebuilds the dictionary object, so without a subscription
    // `hindi` state keeps pointing at the one from before the tier landed and a
    // Hindi counter reads every assurance and devices screen in English. The
    // English fallback makes that failure quiet: no raw keys, just the wrong
    // language on one group of screens.
    const source = readFileSync("src/features/core/settings/i18n.tsx", "utf8");
    expect(source).toContain("const hindiStageListeners = new Set<");
    expect(source).toContain("for (const listener of hindiStageListeners) listener(hindiDictionary);");
    expect(source).toContain("hindiStageListeners.add(apply)");
    expect(source).toContain("hindiStageListeners.delete(apply)");
    // The provider must NOT call the cloud loader: that is what makes it on-demand.
    expect(source).not.toMatch(/void loadCloudTranslations\(\)\.then\(apply\)/);
  });
});
