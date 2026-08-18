// The complete English dictionary, composed from the two halves the runtime
// actually loads.
//
// This is the mirror of hindi.ts, and carries the same warning: nothing here may
// be imported statically from shell code. i18n.tsx deliberately imports only
// english-critical.ts as a value and takes the deferred half as a TYPE, which is
// what keeps ~250 keys of secondary-screen copy out of every merchant's startup
// download.
//
// It exists for the tests and for tooling — the things that need to see the
// whole catalogue at once and do not care what it costs to download.
import { EN_CRITICAL_MODULES, englishCriticalTranslations } from "./english-critical";
import { EN_DEFERRED_MODULES, englishDeferredTranslations } from "./english-deferred";

/** Every English string, both halves. Not for shell code. */
export const englishTranslations = { ...englishCriticalTranslations, ...englishDeferredTranslations };

/**
 * The same modules as HI_MODULES in hindi.ts, keyed identically. The completeness
 * test compares the two key-for-key, so a module added to one and forgotten in the
 * other fails a test rather than shipping English strings to a Hindi counter.
 */
export const EN_MODULES = {
  ...EN_CRITICAL_MODULES,
  ...EN_DEFERRED_MODULES,
} as const;
