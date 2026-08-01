import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

/**
 * Terser's `booleans_as_integers` rewrites `x === true` into `1 == x` and
 * `x === false` into `0 == x` — every strict boolean check becomes LOOSE
 * equality in the shipped bundle only.
 *
 * That is not a cosmetic difference here. This app reads booleans back out of
 * untrusted persisted/synced JSON (the billing draft, held bills,
 * Shop.settingsJson) and guards them with `=== true` precisely so a stored 1 or
 * "1" is rejected. Under the flag those guards accept it, and a bill flag that
 * stays a number fails the Zod schema and blocks the counter from saving.
 *
 * The trap is that NO test can catch the regression by executing code: vitest
 * runs unminified source, so behaviour diverges only in production. The guard
 * therefore has to assert on the build configuration itself.
 */
describe("minifier boolean semantics", () => {
  it("keeps terser's booleans_as_integers disabled", () => {
    const enabled = /booleans_as_integers\s*:\s*true/.test(viteConfig);
    expect(
      enabled,
      "booleans_as_integers turns `x === true` into `1 == x`, so a persisted 1/\"1\" " +
        "silently passes strict boolean guards in production only. Do not re-enable it " +
        "to reclaim bundle size — raise the budget instead.",
    ).toBe(false);
  });

  it("documents why, so the flag is not re-added while chasing bundle size", () => {
    expect(viteConfig).toContain("booleans_as_integers");
    expect(viteConfig).toMatch(/booleans_as_integers MUST stay off/i);
  });

  it("pins the strict-equality semantics the guards depend on", () => {
    // What the flag would have changed, asserted on plain values: `1` is the
    // value that actually reached the bill schema and blocked saving.
    for (const poisoned of [1, "1"]) {
      expect(poisoned === true).toBe(false); // strict — what the source means
      // eslint-disable-next-line eqeqeq
      expect(1 == poisoned).toBe(true); // loose — what the flag compiled it to
    }
  });
});
