/**
 * A refused save has to stay on screen, not vanish with the toast.
 *
 * Save failures were reported ONLY through `toast(..., { variant: "destructive" })`, and
 * this app sets no `duration` on Radix's ToastProvider, so every toast — destructive
 * included — clears itself after five seconds. Press Save, look at the form rather than
 * the corner, and the panel just sits there having done nothing.
 *
 * That is worst for the refusals that carry an instruction. Changing how a stocked
 * product tracks pack-level inventory is refused with "Count this product's stock to
 * zero before changing how it tracks pack-level inventory. Sync that stock correction,
 * then change the packaging setup." — the one sentence saying what to do next. I lost it
 * three times while testing this app before realising the app was refusing me on purpose.
 *
 * Structural rather than rendered: this repo has no testing-library or jsdom, so the
 * wiring is pinned by reading the source, the same way the outbox scrub timing is.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const panel = read("../features/core/products/pages/components/ProductFormPanel.tsx");
const page = read("../features/core/products/pages/ProductsPage.tsx");

describe("a refused product save is shown in the panel", () => {
  it("renders the message as an alert the screen reader announces", () => {
    expect(panel).toContain("saveError?: string | null;");
    expect(panel).toMatch(/\{saveError && \(/);
    expect(panel).toContain('role="alert"');
  });

  it("puts it in the footer, beside the button that was pressed", () => {
    // Above the Cancel/Save row rather than at the top of a long scrolling panel: the
    // form is taller than the screen, so a banner at the top is a banner nobody sees.
    const footer = panel.slice(panel.indexOf("{/* Footer */}"));
    expect(footer).toMatch(/\{saveError && \(/);
    expect(footer.indexOf("{saveError && (")).toBeLessThan(footer.indexOf('type="submit"'));
  });

  it("records the failure on BOTH the create and the update path", () => {
    // Two mutations, two error handlers — an inline error wired to only one of them
    // leaves the other silent, which is the state this started from.
    expect(page.match(/setSaveError\(message\)/g) ?? []).toHaveLength(2);
    expect(page).toContain('const message = err instanceof Error ? err.message : t("products.toast.checkRequired");');
  });

  it("keeps the toast as well, for anyone watching the corner", () => {
    expect(page.match(/variant: "destructive"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("clears the message once the save works, and when the panel is closed", () => {
    // Three places: the create succeeded, the update succeeded, and the panel was
    // closed. Otherwise a stale refusal greets the next product the shop opens.
    expect(page.match(/setSaveError\(null\)/g) ?? []).toHaveLength(3);
    expect(page).toContain("if (!next) setSaveError(null);");
  });
});
