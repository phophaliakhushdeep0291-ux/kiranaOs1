import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { billingEn } from "./translations/billing";
import { customersEn } from "./translations/customers";
import { productsEn } from "./translations/products";
import { reportsEn } from "./translations/reports";
import { restaurantEn } from "./translations/restaurant";
import { shellEn } from "./translations/shell";
import { manufacturingEn } from "./translations/manufacturing";
import { inventoryEn } from "./translations/inventory";
import { settingsPagesEn } from "./translations/settings-pages";

export type AppLanguage = "en" | "hi";

const LANGUAGE_STORAGE_KEY = "kirana-os:ui-language:v1";

const en = { ...shellEn, ...billingEn, ...productsEn, ...customersEn, ...restaurantEn, ...reportsEn, ...manufacturingEn, ...inventoryEn, ...settingsPagesEn };

/**
 * The registered modules, as data rather than only as a spread.
 *
 * The spread above is what gives `TranslationKey` its literal type; this map is what
 * lets the completeness test say "every registered module", so adding a module to the
 * app without adding it to the Hindi side fails a test instead of shipping an English
 * string mid-bill. `i18n-dictionary-completeness.test.ts` asserts the two agree.
 */
export const EN_MODULES = {
  shell: shellEn,
  billing: billingEn,
  products: productsEn,
  customers: customersEn,
  restaurant: restaurantEn,
  reports: reportsEn,
  manufacturing: manufacturingEn,
  inventory: inventoryEn,
  settingsPages: settingsPagesEn,
} as const;

// The English dictionary is the key catalog, so a new key only has to be declared
// once. Each Hindi table is typed against its English counterpart, which is what
// makes a missing Hindi string a build failure instead of an English word
// surfacing mid-bill.
export type TranslationKey = keyof typeof en;

type Dictionary = Record<TranslationKey, string>;
/** Hindi arrives in two stages, so the boot half is usable on its own. */
type PartialDictionary = Partial<Record<TranslationKey, string>>;

// Only English is in the startup download. Hindi is ~290 kB of Devanagari (3 bytes
// per character) that an English counter never reads, so it is fetched on demand
// and cached here for the rest of the session. The load is kicked off at module
// scope — before the first render — whenever the stored preference is already
// Hindi, so a Hindi shop does not watch its billing screen swap languages.
//
// It is fetched in TWO stages, because main.tsx blocks the mount on the first of
// them and Hindi is the default language: a brand-new shop with a cold cache was
// waiting on settings, inventory, reports and two trade tables before it could
// see a screen it had not asked for. Stage one is the shell and billing — the
// same pair routes.tsx warms as "the two highest-frequency workspaces". Stage two
// is everything else, merged in after mount.
//
// Both stages accumulate into one object. A key whose table has not landed yet
// falls back to English, which is complete and already in the shell.
let hindiDictionary: PartialDictionary | null = null;
let hindiCriticalRequest: Promise<PartialDictionary | null> | null = null;
let hindiFullRequest: Promise<PartialDictionary | null> | null = null;

/** Merge a stage into the session dictionary without dropping an earlier one. */
function absorbHindiStage(table: PartialDictionary): PartialDictionary {
  hindiDictionary = { ...(hindiDictionary ?? {}), ...table };
  return hindiDictionary;
}

/**
 * Stage one: the strings the first paint needs. This is what main.tsx waits on.
 */
function loadCriticalHindiDictionary(): Promise<PartialDictionary | null> {
  if (!hindiCriticalRequest) {
    hindiCriticalRequest = import("./translations/hindi-critical")
      .then((module) => absorbHindiStage(module.hindiCriticalTranslations))
      // A failed chunk fetch must not blank the counter: English is a complete
      // dictionary, so falling back to it keeps every screen readable.
      .catch(() => null);
  }
  return hindiCriticalRequest;
}

/**
 * Stage two, and the whole dictionary once it resolves. Requests both halves so
 * this is still "the complete Hindi table" for any caller that awaits it —
 * the provider after mount, and the completeness test.
 */
function loadHindiDictionary(): Promise<PartialDictionary | null> {
  if (!hindiFullRequest) {
    hindiFullRequest = Promise.all([
      loadCriticalHindiDictionary(),
      import("./translations/hindi-deferred")
        .then((module) => module.hindiDeferredTranslations)
        .catch(() => null),
    ])
      .then(([critical, deferred]) => {
        if (deferred) absorbHindiStage(deferred);
        // Null only when BOTH halves failed; a half-loaded dictionary is still
        // better than none, because the gaps fall through to English.
        return critical || deferred ? hindiDictionary : null;
      })
      .catch(() => null);
  }
  return hindiFullRequest;
}

/** Values substituted into `{placeholder}` slots in a translated string. */
export type TranslationVars = Record<string, string | number>;

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

interface AppLanguageContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (key: TranslationKey, vars?: TranslationVars) => string;
}

const AppLanguageContext = createContext<AppLanguageContextValue | null>(null);

/**
 * Hindi is what a new shop gets.
 *
 * The counters this runs on are Hindi-speaking; English was the default only because
 * it was the language the app happened to be written in. A STORED value always wins,
 * so a shop that has already chosen English keeps it — the provider writes the
 * preference on mount, so every existing install has one.
 */
export const DEFAULT_LANGUAGE: AppLanguage = "hi";

export function getInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (raw === "hi") return "hi";
  if (raw === "en") return "en";
  return DEFAULT_LANGUAGE;
}

// Start the fetch before the first render when the shop is already on Hindi, so a
// Hindi counter does not watch its billing screen render in English and then swap.
// main.tsx additionally waits on the CRITICAL half before mounting React — see the
// note there. The rest is requested in the same breath but nothing waits on it.
if (getInitialLanguage() === "hi") void loadHindiDictionary();

export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage);
  const [hindi, setHindi] = useState<PartialDictionary | null>(hindiDictionary);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = language === "hi" ? "hi" : "en";
    if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  // Both stages are applied, in the order they land. The guard is the language
  // and NOT "do we already have a dictionary": the critical half satisfies that
  // test on its own, and an effect that stopped there would leave a Hindi shop
  // permanently reading English on every screen outside billing.
  //
  // Each stage resolves to a freshly built object, so React sees a new identity
  // and re-renders; a stage that fails resolves null and is skipped, leaving
  // whatever did arrive in place.
  useEffect(() => {
    if (language !== "hi") return;
    let cancelled = false;
    const apply = (dictionary: PartialDictionary | null) => {
      if (!cancelled && dictionary) setHindi(dictionary);
    };
    void loadCriticalHindiDictionary().then(apply);
    void loadHindiDictionary().then(apply);
    return () => { cancelled = true; };
  }, [language]);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => setLanguageState(nextLanguage), []);
  // English is the complete catalogue and the fallback in every gap: before the
  // Hindi chunk lands, and if its fetch failed. A screen never renders a raw key.
  const t = useCallback(
    (key: TranslationKey, vars?: TranslationVars) =>
      interpolate((language === "hi" ? hindi?.[key] : undefined) ?? en[key], vars),
    [language, hindi],
  );
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <AppLanguageContext.Provider value={value}>{children}</AppLanguageContext.Provider>;
}

/**
 * English with no provider behind it, for the one case that used to be fatal.
 *
 * Built once at module scope: a new object per call would give every consumer a
 * fresh `t` on every render.
 */
const DETACHED: AppLanguageContextValue = {
  language: "en",
  setLanguage: () => {},
  t: (key, vars) => interpolate(en[key], vars),
};

export function useAppLanguage() {
  const context = useContext(AppLanguageContext);
  if (context) return context;

  // Loud in development, survivable in a shop.
  //
  // This threw in every environment until a translated `ToastClose` turned out
  // to be mounted beside the provider instead of inside it. The throw is correct
  // as a developer signal and was catastrophic as production behaviour: React
  // unmounted the root, so the counter went white mid-bill AND the sync timer —
  // which lives in a `useEffect` — was torn down with it, silently stopping
  // backup until someone reloaded.
  //
  // The fallback is the same trade main.tsx already makes when the Hindi chunk
  // is slow: English is the complete catalogue, and a screen in the wrong
  // language beats no screen at all. The provider nesting is enforced by test
  // instead, which is where that belongs.
  if (import.meta.env.DEV) {
    throw new Error("useAppLanguage must be used inside AppLanguageProvider");
  }
  return DETACHED;
}

/**
 * Translator type for components that receive `t` as a prop instead of reading
 * the context directly (presentational children of an already-translated page).
 */
export type Translate = AppLanguageContextValue["t"];

/** English catalogue, exposed for the dictionary-completeness test. */
export const englishTranslations = en;

/**
 * Loads and returns the Hindi tables. For tests and preloading, not render paths.
 *
 * `loadCriticalHindiDictionary` is the boot half (shell + billing) and is what the
 * entry blocks on; `loadHindiDictionary` resolves the complete dictionary.
 */
export { loadCriticalHindiDictionary, loadHindiDictionary };
