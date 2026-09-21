import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { englishCriticalTranslations } from "./translations/english-critical";
// TYPE ONLY, and that is the entire point of the split. A value import here puts
// nine secondary-screen tables back into the startup chunk every merchant
// downloads; a type import is erased and still gives `TranslationKey` every key.
import type { englishDeferredTranslations } from "./translations/english-deferred";
// TYPE ONLY, for the same reason. This tier is loaded only when an `onlineOnly`
// route opens; see loadCloudTranslations below and english-cloud.ts.
import type { englishCloudTranslations } from "./translations/english-cloud";

export type AppLanguage = "en" | "hi";

const LANGUAGE_STORAGE_KEY = "kirana-os:ui-language:v1";

/**
 * The complete key catalogue as a TYPE; only the boot half is a value.
 *
 * Every key in the product is still in this union, so a screen cannot call `t()`
 * with a key nobody wrote. What changed is that the STRINGS for the deferred and
 * cloud tiers arrive after mount instead of inside the startup download.
 */
type EnglishCatalogue = typeof englishCriticalTranslations
  & typeof englishDeferredTranslations
  & typeof englishCloudTranslations;

// `EN_MODULES` and the complete `englishTranslations` moved to
// translations/english.ts. Both statically import the deferred half, so importing
// either from here would undo the split — the same rule hindi.ts already carries.
// Tests and tooling take them from there.

/**
 * What `t()` actually reads. Starts as the boot half and absorbs the rest.
 *
 * Mutable, unlike the frozen object this replaced, because the deferred tables
 * land after the module has already been evaluated. Every write is an
 * `Object.assign` of a whole table, so a key is either absent or final — a
 * half-written string is not a state this can be in.
 */
const en: Partial<Record<string, string>> = { ...englishCriticalTranslations };

let englishDeferredRequest: Promise<boolean> | null = null;

/**
 * Fetch the rest of the English catalogue.
 *
 * Kicked off at module scope below, before the first render. Nothing waits on it:
 * the screens it serves are all behind lazy route chunks that are themselves a
 * network request away, so in practice it has landed long before one of them can
 * render. A failed fetch is swallowed for the same reason the Hindi one is — a
 * chunk that will not load must not stop the counter from selling.
 */
export function loadDeferredEnglish(): Promise<boolean> {
  if (!englishDeferredRequest) {
    englishDeferredRequest = import("./translations/english-deferred")
      .then((module) => {
        Object.assign(en, module.englishDeferredTranslations);
        return true;
      })
      .catch(() => false);
  }
  return englishDeferredRequest;
}

export type TranslationKey = keyof EnglishCatalogue;

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

/**
 * Notified whenever a Hindi stage lands, so the provider does not have to know
 * how many stages there are or when they are requested.
 *
 * The provider used to await each stage by name, which was fine while both were
 * requested at boot. The cloud tier broke that: it is requested when the owner
 * opens an administration screen, so an effect that awaited it by name would
 * request it for every Hindi shop at mount — defeating the point of keeping it out
 * of the install — while an effect that did not would leave `hindi` state pointing
 * at the object from before it landed, and a Hindi counter would read those
 * screens in English. A subscription applies a stage that arrives without asking
 * for one that has not.
 */
const hindiStageListeners = new Set<(dictionary: PartialDictionary) => void>();

/** Merge a stage into the session dictionary without dropping an earlier one. */
function absorbHindiStage(table: PartialDictionary): PartialDictionary {
  hindiDictionary = { ...(hindiDictionary ?? {}), ...table };
  for (const listener of hindiStageListeners) listener(hindiDictionary);
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

let cloudRequest: Promise<boolean> | null = null;

/**
 * Fetch the tables only an `onlineOnly` route can render.
 *
 * Unlike the deferred halves this is NOT kicked off at module scope, and that is
 * the whole point: these tables are the only ones in the catalogue that no
 * offline screen can reach, so precaching them made every shop pay at install
 * time for copy it could never display. routes.tsx ties this to the lazy import
 * of each cloud page, so React's Suspense holds the loading state until the
 * strings are in — a cloud route can therefore never render a raw key, which a
 * bare on-mount fetch could not promise. See english-cloud.ts for which tables
 * qualify and which two were rejected for leaking into core copy.
 *
 * BOTH languages land together. The alternative — Hindi only when the stored
 * preference is Hindi — needs a second request and a re-render on every language
 * switch, to save ~6.8 kB gzip on an administration screen that is already
 * online by definition. Not worth the edge case.
 *
 * A failed fetch is swallowed like the others: `resolve` degrades to the key, and
 * a chunk that will not load must not stop the counter from selling.
 */
export function loadCloudTranslations(): Promise<boolean> {
  if (!cloudRequest) {
    cloudRequest = Promise.all([
      import("./translations/english-cloud").then((module) => {
        Object.assign(en, module.englishCloudTranslations);
      }),
      import("./translations/hindi-cloud").then((module) => {
        absorbHindiStage(module.hindiCloudTranslations);
      }),
    ])
      .then(() => true)
      .catch(() => false);
  }
  return cloudRequest;
}

/**
 * Every Hindi table, all three tiers, for the completeness test and tooling.
 *
 * Not for the app: it pulls the cloud tier, which the running app fetches only
 * when a cloud route opens. It exists because `absorbHindiStage` rebuilds the
 * dictionary object on each stage, so the reference `loadHindiDictionary()`
 * resolved with does not grow when a later tier lands — a caller that wants the
 * whole catalogue has to read it after the last one.
 */
export async function loadCompleteHindiDictionary(): Promise<PartialDictionary | null> {
  const [full] = await Promise.all([loadHindiDictionary(), loadCloudTranslations()]);
  return full ? hindiDictionary : null;
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

/**
 * Hindi if it has landed, else English, else the key itself.
 *
 * That last step is new and is the one cost of splitting English. It is reachable
 * only for a deferred key read before its chunk arrives — a window that opens at
 * module scope and closes on one cached request, while every screen those keys
 * belong to sits behind a lazy route chunk that has not been fetched yet either.
 *
 * It returns the key rather than an empty string deliberately: a blank label is
 * indistinguishable from a working screen with nothing to say, and would be found
 * by a shopkeeper. A visible `orders.detail.grandTotal` is found in review.
 */
function resolve(
  language: AppLanguage,
  hindi: PartialDictionary | null,
  key: TranslationKey,
  vars?: TranslationVars,
): string {
  const hindiValue = language === "hi" ? hindi?.[key] : undefined;
  return interpolate(hindiValue ?? en[key] ?? key, vars);
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
// Every shop, not just English ones: this half is the fallback under every gap in
// the Hindi table, so a Hindi counter needs it exactly as much.
void loadDeferredEnglish();

export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage);
  const [hindi, setHindi] = useState<PartialDictionary | null>(hindiDictionary);
  // `en` is mutated in place when the deferred half lands, so React has no reason
  // to re-render on its own. This counter is the nudge — without it a screen that
  // mounted during the fetch would keep whatever it first rendered.
  const [englishTier, setEnglishTier] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void loadDeferredEnglish().then((loaded) => {
      if (loaded && !cancelled) setEnglishTier((tier) => tier + 1);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = language === "hi" ? "hi" : "en";
    if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  // Every stage is applied, in the order it lands. The guard is the language and
  // NOT "do we already have a dictionary": the critical half satisfies that test
  // on its own, and an effect that stopped there would leave a Hindi shop
  // permanently reading English on every screen outside billing.
  //
  // Each stage resolves to a freshly built object, so React sees a new identity
  // and re-renders; a stage that fails resolves null and is skipped, leaving
  // whatever did arrive in place.
  //
  // The two boot stages are awaited by name because this effect is also what
  // REQUESTS them on a switch into Hindi. The subscription covers the stages this
  // effect must not request — today the cloud tier, which is fetched only when an
  // administration screen opens. Subscribe before awaiting, so a stage that lands
  // between the two lines is not missed.
  useEffect(() => {
    if (language !== "hi") return;
    let cancelled = false;
    const apply = (dictionary: PartialDictionary | null) => {
      if (!cancelled && dictionary) setHindi(dictionary);
    };
    hindiStageListeners.add(apply);
    void loadCriticalHindiDictionary().then(apply);
    void loadHindiDictionary().then(apply);
    return () => {
      cancelled = true;
      hindiStageListeners.delete(apply);
    };
  }, [language]);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => setLanguageState(nextLanguage), []);
  // English is the complete catalogue and the fallback in every gap: before the
  // Hindi chunk lands, and if its fetch failed. A screen never renders a raw key.
  const t = useCallback(
    (key: TranslationKey, vars?: TranslationVars) => resolve(language, hindi, key, vars),
    // `englishTier` is not read in the body on purpose: it exists to give this
    // callback a new identity once the deferred strings are in `en`.
    [language, hindi, englishTier],
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
  t: (key, vars) => resolve("en", null, key, vars),
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
/**
 * The boot half only, for the one runtime caller that needs an English string
 * outside React (`shop-billing.receiptCreditWordEnglish`). Everything it reads is
 * a `billing.*` key, which is why the credit words were moved into that table.
 *
 * Tests and tooling want the WHOLE catalogue and must import
 * `englishTranslations` from translations/english.ts instead.
 */
export const englishCritical = englishCriticalTranslations;

/**
 * Loads and returns the Hindi tables. For tests and preloading, not render paths.
 *
 * `loadCriticalHindiDictionary` is the boot half (shell + billing) and is what the
 * entry blocks on; `loadHindiDictionary` resolves the complete dictionary.
 */
export { loadCriticalHindiDictionary, loadHindiDictionary };
