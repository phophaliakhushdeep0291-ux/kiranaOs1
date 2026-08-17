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
import { shopTypesEn } from "./translations/shop-types";
import { workflowsEn } from "./translations/workflows";

export type AppLanguage = "en" | "hi";

const LANGUAGE_STORAGE_KEY = "kirana-os:ui-language:v1";

const en = { ...shellEn, ...billingEn, ...productsEn, ...customersEn, ...restaurantEn, ...reportsEn, ...manufacturingEn, ...inventoryEn, ...settingsPagesEn, ...shopTypesEn, ...workflowsEn };

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
  shopTypes: shopTypesEn,
  workflows: workflowsEn,
} as const;

// The English dictionary is the key catalog, so a new key only has to be declared
// once. Each Hindi table is typed against its English counterpart, which is what
// makes a missing Hindi string a build failure instead of an English word
// surfacing mid-bill.
export type TranslationKey = keyof typeof en;

type Dictionary = Record<TranslationKey, string>;

// Only English is in the startup download. Hindi is ~40 kB of Devanagari (3 bytes
// per character) that an English counter never reads, so it is fetched on demand
// and cached here for the rest of the session. The load is kicked off at module
// scope — before the first render — whenever the stored preference is already
// Hindi, so a Hindi shop does not watch its billing screen swap languages.
let hindiDictionary: Dictionary | null = null;
let hindiRequest: Promise<Dictionary | null> | null = null;

function loadHindiDictionary(): Promise<Dictionary | null> {
  if (!hindiRequest) {
    hindiRequest = import("./translations/hindi")
      .then((module) => {
        hindiDictionary = module.hindiTranslations;
        return hindiDictionary;
      })
      // A failed chunk fetch must not blank the counter: English is a complete
      // dictionary, so falling back to it keeps every screen readable.
      .catch(() => null);
  }
  return hindiRequest;
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
// main.tsx additionally waits on this before mounting React — see the note there.
if (getInitialLanguage() === "hi") void loadHindiDictionary();

export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage);
  const [hindi, setHindi] = useState<Dictionary | null>(hindiDictionary);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = language === "hi" ? "hi" : "en";
    if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    if (language !== "hi" || hindi) return;
    let cancelled = false;
    void loadHindiDictionary().then((dictionary) => {
      if (!cancelled && dictionary) setHindi(dictionary);
    });
    return () => { cancelled = true; };
  }, [language, hindi]);

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

export function useAppLanguage() {
  const context = useContext(AppLanguageContext);
  if (!context) throw new Error("useAppLanguage must be used inside AppLanguageProvider");
  return context;
}

/**
 * Translator type for components that receive `t` as a prop instead of reading
 * the context directly (presentational children of an already-translated page).
 */
export type Translate = AppLanguageContextValue["t"];

/** English catalogue, exposed for the dictionary-completeness test. */
export const englishTranslations = en;

/** Loads and returns the Hindi table. For tests and preloading, not render paths. */
export { loadHindiDictionary };
