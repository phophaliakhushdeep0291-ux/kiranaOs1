import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { googleButtonWidth } from "@/features/core/auth/GoogleSignInButton";

/**
 * The sign-in card was pushed off the right of a real phone because Google's
 * button was rendered at a hardcoded 320px. Google renders into an iframe at
 * exactly the width it is handed — the iframe does not shrink to fit — so on a
 * 360px Android viewport the card plus padding exceeded the screen and
 * "Forgot password" was clipped mid-word.
 *
 * Nothing caught it: the component returns null without a `CLIENT_ID`, which is
 * every local and CI environment, so the four-width overflow QA measured a page
 * where the button did not exist. The bug only reproduces where Google actually
 * loads, and the preview deployment that would show it is behind Vercel's
 * deployment protection.
 *
 * So the width decision is tested directly, as arithmetic, and the containment
 * is asserted on the source. Between them they cover the two ways this can
 * regress: a wrong number, or a container that lets a wrong number matter.
 */

const source = readFileSync("src/features/core/auth/GoogleSignInButton.tsx", "utf8");

describe("the width handed to Google", () => {
  it("uses the space available rather than a fixed 320", () => {
    expect(googleButtonWidth(288)).toBe(288);
    expect(googleButtonWidth(344)).toBe(344);
  });

  it("never exceeds the container, which is the whole bug", () => {
    // A 360px phone, card and page padding taken off. The old hardcoded 320
    // was wider than this and pushed the card off screen.
    const availableOn360Phone = 296;
    expect(googleButtonWidth(availableOn360Phone)).toBeLessThanOrEqual(availableOn360Phone);
    expect(googleButtonWidth(availableOn360Phone)).toBeLessThan(320);
  });

  it("clamps to the range Google accepts", () => {
    // Outside 200–400 Google silently substitutes its own default, so an
    // unclamped measurement would be worse than the number it replaces.
    expect(googleButtonWidth(120)).toBe(200);
    expect(googleButtonWidth(1200)).toBe(400);
  });

  it("survives a container that has not been laid out yet", () => {
    // clientWidth is 0 before first paint, and NaN if anything upstream slips.
    expect(googleButtonWidth(0)).toBe(200);
    expect(googleButtonWidth(Number.NaN)).toBe(200);
    expect(googleButtonWidth(-40)).toBe(200);
  });

  it("returns whole pixels", () => {
    // Google takes a number; a fractional width from a flex container would be
    // rounded somewhere we do not control.
    expect(Number.isInteger(googleButtonWidth(287.6))).toBe(true);
    expect(googleButtonWidth(287.6)).toBe(288);
  });
});

describe("the Google button cannot widen the page", () => {
  it("no longer hardcodes a pixel width", () => {
    expect(source).not.toContain("width: 320");
  });

  it("measures the space it has been given", () => {
    expect(source).toContain("width: googleButtonWidth(host.clientWidth)");
  });

  it("clamps to the range Google actually accepts", () => {
    // Outside 200–400 Google silently substitutes its own default, so a
    // measurement that lands outside the range is worse than no measurement.
    expect(source).toContain("GOOGLE_BUTTON_MIN_WIDTH = 200");
    expect(source).toContain("GOOGLE_BUTTON_MAX_WIDTH = 400");
  });

  it("re-renders when the available width changes", () => {
    // The iframe keeps whatever width it was built with, so a rotation needs a
    // fresh render rather than a CSS rule.
    expect(source).toContain("ResizeObserver");
    expect(source).toContain("observer?.disconnect()");
  });

  it("keeps the container from contributing width of its own", () => {
    // Defensive, not a fix. Measured in a browser at 360px: `overflow-x-clip`
    // stops an oversized child *painting* outside the host, but the child's
    // layout box still extends, so this cannot rescue a width that is wrong.
    // The measurement above is what prevents the bug; these two only stop the
    // container adding to it.
    expect(source).toContain("min-w-0");
    expect(source).toContain("overflow-x-clip");
  });
});

describe("how this bug has to be detected", () => {
  it("records that scrollWidth cannot see it", () => {
    // `body { overflow-x: hidden }` means document.scrollWidth can never exceed
    // innerWidth — the page clips instead of scrolling. Every "no horizontal
    // overflow" check written that way passes unconditionally, which is why a
    // card running off a real phone went unnoticed. The detector that works is
    // element.getBoundingClientRect().right > innerWidth.
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toContain("overflow-x: hidden");
  });
});
