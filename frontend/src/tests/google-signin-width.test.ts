import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The sign-in card was pushed off the right of a real phone because Google's
 * button was rendered at a hardcoded 320px. Google renders into an iframe at
 * exactly the width it is handed — the iframe does not shrink to fit — so on a
 * 360px Android viewport the card plus padding exceeded the screen and
 * "Forgot password" was clipped mid-word.
 *
 * Nothing caught it: the component returns null without a `CLIENT_ID`, which is
 * every local and CI environment, so the four-width overflow QA measured a page
 * where the button did not exist. These are source contracts because the bug
 * only reproduces where Google actually loads.
 */

const source = readFileSync("src/features/core/auth/GoogleSignInButton.tsx", "utf8");

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

  it("keeps a hard guard on the container as well as the measurement", () => {
    expect(source).toContain("min-w-0");
    expect(source).toContain("overflow-x-clip");
  });
});
