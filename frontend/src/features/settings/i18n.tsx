import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { billingEn, billingHi } from "./translations/billing";
import { customersEn, customersHi } from "./translations/customers";
import { productsEn, productsHi } from "./translations/products";
import { shellEn, shellHi } from "./translations/shell";

export type AppLanguage = "en" | "hi";

const LANGUAGE_STORAGE_KEY = "kirana-os:ui-language:v1";

const en = { ...shellEn, ...billingEn, ...productsEn, ...customersEn };

// The English dictionary is the key catalog, so a new key only has to be declared
// once. `hi` is checked against it below, which is what makes a missing Hindi
// string a build failure instead of an English word surfacing mid-bill.
export type TranslationKey = keyof typeof en;

const translations: Record<AppLanguage, Record<TranslationKey, string>> = {
  en,
  hi: { ...shellHi, ...billingHi, ...productsHi, ...customersHi },
};

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

export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = language === "hi" ? "hi" : "en";
    if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => setLanguageState(nextLanguage), []);
  const t = useCallback(
    (key: TranslationKey, vars?: TranslationVars) => interpolate(translations[language][key] ?? translations.en[key], vars),
    [language],
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

/** Exposed for the dictionary-completeness test; not for runtime lookups. */
export const translationDictionaries = translations;
