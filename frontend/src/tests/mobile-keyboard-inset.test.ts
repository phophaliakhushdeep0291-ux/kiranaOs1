import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const hookSource = readFileSync(new URL("../hooks/use-keyboard-inset.ts", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../features/core/products/pages/components/ProductFormPanel.tsx", import.meta.url), "utf8");

/**
 * A full-screen panel sized with `100dvh` does not shrink when the on-screen
 * keyboard opens, because `dvh` tracks browser chrome and not the keyboard. The
 * add-product panel pins its Save button to its own bottom edge, so before this
 * was handled the button sat roughly 360px underneath the keyboard on a 375x812
 * phone — measured — for the whole time any field was focused.
 */
describe("mobile keyboard handling for full-screen panels", () => {
  it("asks the browser to resize the layout viewport when the keyboard opens", () => {
    // The declarative half of the fix. Chrome honours this, which shrinks `dvh`
    // for every full-screen panel in the app at once rather than one at a time.
    expect(indexHtml).toContain("interactive-widget=resizes-content");
  });

  it("measures the covered strip from the visual viewport, including its scroll offset", () => {
    // iOS scrolls the VISUAL viewport to keep the focused field above the
    // keyboard. Ignoring offsetTop under-measures the covered strip by exactly
    // that scroll, which leaves the action row hidden on the platform the
    // fallback exists for.
    expect(hookSource).toContain("window.innerHeight - viewport.height - viewport.offsetTop");
    expect(hookSource).toContain("visualViewport");
    for (const event of ["resize", "scroll"]) {
      expect(hookSource).toContain(`viewport.addEventListener("${event}", update)`);
      expect(hookSource).toContain(`viewport.removeEventListener("${event}", update)`);
    }
  });

  it("ignores chrome-sized changes so the panel does not resize while scrolling", () => {
    // An address bar sliding away is tens of pixels, not a keyboard. Reacting to
    // it would resize the panel under the reader's thumb on every scroll.
    expect(hookSource).toContain("covered > 80");
  });

  it("reports zero when there is no keyboard, so desktop sizing is never overridden", () => {
    // The panel's lg: height comes from a class. An inline height applied
    // unconditionally would win over it and break the desktop layout, so the
    // hook must return 0 rather than a small number when nothing is covered.
    expect(hookSource).toContain("useState(0)");
    expect(hookSource).toContain("if (!viewport) return");
  });

  it("only shrinks the add-product panel while a keyboard is actually up", () => {
    expect(panelSource).toContain("useKeyboardInset");
    expect(panelSource).toContain("keyboardInset > 0 ? { width, height: `calc(100dvh - ${keyboardInset}px)` } : { width }");
  });
});
