import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("keeps the shared dialog close affordance 44px at every breakpoint", () => {
    const source = readFileSync("src/components/ui/dialog.tsx", "utf8");
    expect(source).toContain("grid h-11 w-11 place-items-center");
    expect(source).not.toContain("sm:h-8 sm:w-8");
  });

  it("keeps the mobile home target at 44px", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.mobile-brand-mark\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*flex:\s*0 0 44px;/s);
  });

  it("keeps switches touch-safe without enlarging the visual track", () => {
    const source = readFileSync("src/components/ui/switch.tsx", "utf8");
    expect(source).toContain("inline-flex h-11 w-11");
    expect(source).toContain("before:h-5 before:w-9");
    expect(source).toContain("data-[state=checked]:before:bg-primary");
  });

  it("keeps toast actions and dismiss controls visible and touch-safe", () => {
    const source = readFileSync("src/components/ui/toast.tsx", "utf8");
    expect(source).toContain("inline-flex min-h-11 shrink-0");
    expect(source).toContain("grid h-11 w-11 place-items-center");
    expect(source).toContain("opacity-60");
  });

  it("keeps the sync diagnostics refresh action at 44px", () => {
    const source = readFileSync("src/features/core/sync/pages/SyncDiagnosticsSection.tsx", "utf8");
    expect(source).toContain('aria-label="Refresh sync diagnostics"');
    expect(source).toContain("grid h-11 w-11 shrink-0");
    expect(source).not.toContain("grid h-9 w-9 shrink-0");
  });

  it("never shrinks a control on width alone, because a wide screen is not a mouse", () => {
    // A counter POS is a 1024x768 or 1366x768 touchscreen, so every bare `lg:`
    // size reduction lands on a device driven by a finger. Pair the shrink with
    // `mouse:` (pointer: fine) so the dense layout stays a mouse-only optimisation.
    //
    // `sm:` is guarded for the same reason and bites sooner: it starts at 640px,
    // so every tablet in portrait — and the 768px POS — took the dense sizing.
    // The mobile QA matrix caught "Refresh reports" at 36px on a 768px screen
    // through exactly this route.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith(".tsx")) continue;
        for (const [index, line] of readFileSync(full, "utf8").split("\n").entries()) {
          // h-11 is 44px — shrinking to anything below it is what we are guarding.
          const match = line.match(/(?<!mouse:)\b(?:lg|sm):(?:min-)?[hw]-(?:[1-9]|10)\b/);
          if (match) offenders.push(`${full}:${index + 1} ${match[0]}`);
        }
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });

  it("defines the mouse variant the shrink guard depends on", () => {
    expect(readFileSync("src/index.css", "utf8")).toContain("@custom-variant mouse (@media (pointer: fine))");
  });
});
