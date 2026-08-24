import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/features/core/products/pages/components/ProductFormPanel.tsx",
  "utf8",
);

describe("mobile product form touch contract", () => {
  it("is a full-height phone task with a keyboard-safe, safe-area footer", () => {
    expect(source).toContain('data-mobile-task-panel="product-form"');
    expect(source).toContain("h-[100dvh] w-full max-w-[100vw]");
    expect(source).toContain("env(safe-area-inset-bottom)");
    expect(source).toContain("interactive-widget=resizes-content");
  });

  it("keeps every compact interactive control at least 44px tall", () => {
    const compactHeightLines = source
      .split(/\r?\n/)
      .filter((line) => /\bh-(?:8|9|10)\b/.test(line));

    // The only remaining compact boxes are display-only: an icon tile and the
    // read-only variant stock total. Inputs, selects and buttons use h-11 (44px).
    expect(compactHeightLines).toHaveLength(2);
    expect(compactHeightLines.some((line) => line.includes("<span"))).toBe(true);
    expect(compactHeightLines.some((line) => line.includes('data-testid="variant-grid-stock-total"'))).toBe(false);
    expect(compactHeightLines.some((line) => line.includes('className="flex h-10'))).toBe(true);
    expect(compactHeightLines.some((line) => /<(?:Input|SelectTrigger|Button|button|select)\b/.test(line))).toBe(false);
  });

  it("gives small text actions an invisible 44px hit area", () => {
    expect(source).toContain('className="tap-target text-[var(--brand)]/60');
    expect(source).toContain('className="tap-target inline-flex items-center');
    expect(source).toContain('className="tap-target mt-1 text-[11px]');
    expect(source).toContain('className="mb-3 flex min-h-11 cursor-pointer');
  });
});
