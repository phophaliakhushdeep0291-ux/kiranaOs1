import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which language a shop starts in, and whether its choice survives a reload.
 *
 * `getInitialLanguage` is read at module scope (main.tsx waits on the Hindi chunk
 * before mounting when it returns "hi"), so each case re-imports the module with a
 * fresh localStorage rather than mutating a cached one.
 */
const STORAGE_KEY = "kirana-os:ui-language:v1";

function withStoredLanguage(value: string | null) {
  const store = new Map<string, string>();
  if (value !== null) store.set(STORAGE_KEY, value);
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, next: string) => void store.set(key, next),
    removeItem: (key: string) => void store.delete(key),
  };
  // `window` and not just `localStorage`: getInitialLanguage guards on
  // `typeof window === "undefined"` for SSR, so a bare localStorage stub leaves it on
  // the server path and every case returns the default — which would have made the
  // English assertions below pass for the wrong reason.
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("localStorage", localStorage);
  return store;
}

async function freshInitialLanguage() {
  vi.resetModules();
  const module = await import("@/features/core/settings/i18n");
  return module.getInitialLanguage();
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("default UI language", () => {
  it("starts a brand-new shop in Hindi", async () => {
    // The counters this runs on are Hindi-speaking. English was only ever the default
    // because it happened to be the language the app was written in.
    withStoredLanguage(null);
    expect(await freshInitialLanguage()).toBe("hi");
  });

  it("keeps English for a shop that chose it", async () => {
    // The provider writes the preference on mount, so every existing install has one.
    // Changing the default must not flip a counter that has been working in English.
    withStoredLanguage("en");
    expect(await freshInitialLanguage()).toBe("en");
  });

  it("keeps Hindi for a shop that chose it", async () => {
    withStoredLanguage("hi");
    expect(await freshInitialLanguage()).toBe("hi");
  });

  it("falls back to Hindi when the stored value is corrupt", async () => {
    withStoredLanguage("klingon");
    expect(await freshInitialLanguage()).toBe("hi");
  });

  it("persists a switch to English across a reload", async () => {
    // The switch writes through localStorage, which is the only thing that survives a
    // reload — this is the assertion that a shopkeeper's choice is not session-scoped.
    const store = withStoredLanguage(null);
    expect(await freshInitialLanguage()).toBe("hi");

    // What AppLanguageProvider's effect does when setLanguage("en") is tapped.
    store.set(STORAGE_KEY, "en");

    expect(await freshInitialLanguage()).toBe("en");
  });
});

describe("Hindi arrives before the first paint", () => {
  it("waits for the Hindi chunk in the entry rather than gating the provider", () => {
    // A provider-level gate would blank an app that had already painted; waiting in the
    // entry only extends a page that is blank anyway. The race keeps a slow chunk on
    // shop wifi from holding the till hostage — English is a complete dictionary.
    const entry = readFileSync("src/main.tsx", "utf8");
    expect(entry).toContain("getInitialLanguage() === \"hi\"");
    expect(entry).toContain("Promise.race");
  });

  it("blocks first paint on the critical half only", () => {
    // Hindi is the DEFAULT, so this wait is on the first-ever load of every new shop
    // with a cold cache. Blocking it on the whole dictionary meant holding a blank
    // screen for settings, inventory, reports and the trade tables — none of which
    // the boot path renders. Waiting on the full loader here would silently restore
    // that; the deferred half must never be on the critical path.
    const entry = readFileSync("src/main.tsx", "utf8");
    expect(entry).toContain("loadCriticalHindiDictionary()");
    expect(entry).not.toMatch(/\bloadHindiDictionary\(\)/);
  });

  it("keeps Hindi out of the startup download", () => {
    // The whole point of the lazy table: an English counter never pays for ~290 kB of
    // Devanagari. A static import here would silently undo that.
    const i18n = readFileSync("src/features/core/settings/i18n.tsx", "utf8");
    expect(i18n).toContain('import("./translations/hindi-critical")');
    expect(i18n).toContain('import("./translations/hindi-deferred")');
    expect(i18n).not.toMatch(/^import .*translations\/hindi(-critical|-deferred)?";$/m);
  });

  it("pins the two halves to separate chunks", () => {
    // The split only exists in the bundle if Rollup keeps the halves apart. The
    // object form of manualChunks assigns the named module AND its imports, so a
    // single pin on translations/hindi would merge them back and quietly undo the
    // whole change while every other test still passed.
    const viteConfig = readFileSync("vite.config.ts", "utf8");
    expect(viteConfig).toContain('"i18n-hindi-critical": ["./src/features/core/settings/translations/hindi-critical"]');
    expect(viteConfig).toContain('"i18n-hindi": ["./src/features/core/settings/translations/hindi-deferred"]');
  });
});
