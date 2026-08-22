import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/core/bills/pages/BillsPage.tsx", "utf8");

describe("billing history hook safety", () => {
  it("keeps the record normalizer hook-free so memoized selectors can call it", () => {
    const helper = source.match(/function asRecord\([\s\S]*?\n\}/)?.[0] ?? "";

    expect(helper).toContain("function asRecord");
    expect(helper).not.toMatch(/\buse[A-Z][A-Za-z0-9_]*\s*\(/);
  });

  it("does not mount desktop KPI charts inside zero-sized mobile containers", () => {
    expect(source).toContain('window.matchMedia("(min-width: 1024px)")');
    expect(source).toContain("{showChart ? (");
  });
});
