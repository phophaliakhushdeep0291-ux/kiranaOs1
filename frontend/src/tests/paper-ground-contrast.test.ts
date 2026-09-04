import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The ground is warm on purpose, and warmth costs contrast.
 *
 * A till is read at arm's length under a shop's tube light, so the page is
 * unbleached paper rather than screen white. But every hardcoded grey in this
 * app was chosen against white, and moving the ground down moves all of them
 * closer to the floor at once — silently, because nothing renders a contrast
 * check.
 *
 * It has already happened once. The ground shipped at #faf8f4, which put
 * `#64748b` — the most used text colour in the codebase, 307 occurrences — at
 * 4.486:1, just under the 4.5 required for normal text. It reads fine and fails
 * the standard, which is the worst combination.
 *
 * This test is the guard. It is deliberately written against the *darkest
 * body grey actually in use* rather than a token, because the greys are
 * literals scattered across 90 files and the ground is the one thing that can
 * move them all.
 */

const css = readFileSync("src/index.css", "utf8");

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channel = (pair: string) => {
    const v = Number.parseInt(pair, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(h.slice(0, 2)) + 0.7152 * channel(h.slice(2, 4)) + 0.0722 * channel(h.slice(4, 6));
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The mobile ground, read from the stylesheet rather than restated here. */
function mobileGround(): string {
  const match = /--kirana-mobile-bg:\s*(#[0-9a-fA-F]{6})/.exec(css);
  if (!match) throw new Error("--kirana-mobile-bg is not a plain hex any more; update this guard");
  return match[1];
}

/** The most-used body grey in the app. If this clears, the lighter ones do too. */
const BODY_GREY = "#64748b";
const AA_NORMAL_TEXT = 4.5;

describe("the warm ground keeps body text legible", () => {
  it("leaves the most-used grey above the AA floor", () => {
    const ratio = contrast(BODY_GREY, mobileGround());
    expect(
      ratio,
      `#64748b measures ${ratio.toFixed(3)}:1 on ${mobileGround()}. Warming the ground further moves every hardcoded grey with it.`,
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("is still warm rather than white", () => {
    // The guard must not be satisfiable by giving up and painting the app white.
    const ground = mobileGround().replace("#", "");
    const [r, , b] = [ground.slice(0, 2), ground.slice(2, 4), ground.slice(4, 6)].map((p) => Number.parseInt(p, 16));
    expect(ground.toLowerCase(), "the ground should not be pure white").not.toBe("ffffff");
    expect(r, "paper is warm: red should sit above blue").toBeGreaterThan(b);
  });

  it("keeps the token and the mobile value telling the same story", () => {
    // --background is HSL tokens and --kirana-mobile-bg is a hex; they describe
    // the same paper and drifting apart is how one surface ends up cooler.
    expect(css).toContain("--background: 36 44% 98%;");
    expect(mobileGround().toLowerCase()).toBe("#fcfaf7");
  });
});
