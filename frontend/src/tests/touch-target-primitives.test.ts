import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared touch-target primitives", () => {
  it("keeps every button size at least 44px high and icon buttons 44px wide", () => {
    const source = readFileSync("src/components/ui/button.tsx", "utf8");
    expect(source).toContain('default: "min-h-11');
    expect(source).toContain('sm: "min-h-11');
    expect(source).toContain('icon: "h-11 w-11 min-h-11 min-w-11"');
  });

  it("keeps text inputs and select triggers at least 44px high", () => {
    expect(readFileSync("src/components/ui/input.tsx", "utf8")).toContain("min-h-11");
    expect(readFileSync("src/components/ui/select.tsx", "utf8")).toContain("h-11 min-h-11");
  });

  it("keeps the mobile home target at 44px", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.mobile-brand-mark\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*flex:\s*0 0 44px;/s);
  });
});
