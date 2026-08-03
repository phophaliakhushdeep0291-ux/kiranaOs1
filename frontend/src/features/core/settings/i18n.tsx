import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { billingEn } from "./translations/billing";
import { customersEn } from "./translations/customers";
import { productsEn } from "./translations/products";
import { shellEn } from "./translations/shell";

export type AppLanguage = "en" | "hi";

const LANGUAGE_STORAGE_KEY = "kirana-os:ui-language:v1";

const en = { ...shellEn, ...billingEn, ...productsEn, ...customersEn };

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

function getInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";
  const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return raw === "hi" ? "hi" : "en";
}

// Start the fetch before the first render when the shop is already on Hindi, so a
// Hindi counter does not watch its billing screen render in English and then swap.
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
