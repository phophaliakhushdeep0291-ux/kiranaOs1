// The complete Hindi dictionary, composed from the two halves the runtime
// actually fetches: the boot-critical tables and the deferred ones.
//
// This module is no longer what the app loads first. main.tsx waits on
// hindi-critical alone so a Hindi counter — Hindi is the DEFAULT — is not held
// at a blank screen for tables it is not about to render; hindi-deferred
// follows once React has mounted. See hindi-critical.ts for the reasoning.
//
// It is still the whole dictionary, and still the thing the completeness test
// walks, which is why it composes the halves rather than re-importing the nine
// tables: one list of modules, split in one place, so a table cannot be dropped
// from the runtime and still pass a test that reads its own copy of the list.
//
// Nothing here may be imported statically from shell code — that would defeat
// the split and put the tables back into the startup download.
import { HI_CRITICAL_MODULES, hindiCriticalTranslations } from "./hindi-critical";
import { HI_DEFERRED_MODULES, hindiDeferredTranslations } from "./hindi-deferred";

export const hindiTranslations = { ...hindiCriticalTranslations, ...hindiDeferredTranslations };

/**
 * The same modules as EN_MODULES in i18n.tsx, keyed identically. The completeness
 * test compares the two key-for-key, so a module added to English and forgotten here
 * fails a test rather than shipping English strings to a Hindi counter.
 */
export const HI_MODULES = {
  ...HI_CRITICAL_MODULES,
  ...HI_DEFERRED_MODULES,
} as const;
