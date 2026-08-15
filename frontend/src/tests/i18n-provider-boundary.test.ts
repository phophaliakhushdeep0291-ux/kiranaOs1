import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Everything that calls `useAppLanguage` must render inside its provider.
 *
 * This is not a style rule. `<Toaster />` was mounted as a sibling of the
 * provider rather than a child of it, and the moment its close button became
 * translated, the first toast of the day threw during render. React unmounts the
 * whole root on a render throw, so a shopkeeper got a white screen mid-bill —
 * and the periodic sync, which is scheduled from a `useEffect`, was torn down
 * with the tree and stopped until someone reloaded. One misplaced element, both
 * symptoms.
 *
 * The hook now falls back to English in production rather than throwing, so this
 * can no longer take the app down. That makes the mistake quiet, which is why it
 * needs a test: a shop would just silently see English.
 */
const providers = readFileSync("src/app/providers.tsx", "utf8");

/** Byte range between an element's opening tag and its matching closing tag. */
function elementRange(source: string, tag: string) {
  const open = source.indexOf(`<${tag}`);
  const close = source.indexOf(`</${tag}>`);
  expect(open, `${tag} is not rendered in providers.tsx`).toBeGreaterThan(-1);
  expect(close, `${tag} has no closing tag`).toBeGreaterThan(open);
  return { open, close };
}

describe("app provider boundary", () => {
  it("keeps every translated shell component inside the language provider", () => {
    const language = elementRange(providers, "AppLanguageProvider");

    // The toast close button reads `t("chrome.dismissNotification")`, so the
    // Toaster has to be a descendant of the provider, not a sibling.
    const toaster = providers.indexOf("<Toaster");
    expect(toaster, "Toaster is not rendered").toBeGreaterThan(-1);
    expect(
      toaster > language.open && toaster < language.close,
      "<Toaster /> must render inside <AppLanguageProvider>: its close button is translated, and a provider-less render used to blank the app.",
    ).toBe(true);

    // The routed app itself, for the same reason and by a much wider margin.
    const children = providers.indexOf("{children}");
    expect(children > language.open && children < language.close).toBe(true);
  });

  it("falls back to English instead of throwing in a production build", () => {
    const i18n = readFileSync("src/features/core/settings/i18n.tsx", "utf8");
    // A bare `throw` on a missing provider is what made this fatal at a counter.
    expect(i18n).toContain("if (import.meta.env.DEV)");
    expect(i18n).toContain("return DETACHED;");
  });
});
