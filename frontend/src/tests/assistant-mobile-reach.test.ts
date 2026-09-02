import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Can a shopkeeper actually reach the assistant on a phone?
 *
 * This is a regression test for a bug that every other kind of test passed. The
 * mic button was in the DOM, visible, correctly sized, and present at a 375px
 * emulated viewport — and absent on a real phone, because the panel was `h-full`
 * inside `fixed inset-0`. That measures the LAYOUT viewport, which on iOS Safari
 * and Android Chrome extends behind the URL bar, so the composer and the mic in
 * it sat below the glass.
 *
 * Emulators do not reproduce it. The classes are therefore pinned here, using
 * the conventions the rest of the app already settled on: 100dvh for a
 * full-height mobile panel, and env(safe-area-inset-bottom) on anything anchored
 * to the bottom edge.
 */
const panel = readFileSync("src/features/core/assistant/AssistantPanel.tsx", "utf8");
const launcher = readFileSync("src/features/core/assistant/AssistantLauncher.tsx", "utf8");
const tillAssistant = readFileSync("src/features/core/billing/pages/components/BillingAssistantStrip.tsx", "utf8");
const voiceAssistant = readFileSync("src/features/core/voice/VoiceAssistant.tsx", "utf8");

describe("the assistant is reachable on a phone", () => {
  it("sizes the panel to the visible viewport, not the layout one", () => {
    expect(panel).toContain("h-[100dvh]");
    // h-full is what put the composer behind the browser chrome.
    expect(panel).not.toMatch(/className="flex h-full w-full flex-col/);
  });

  it("keeps the composer clear of the home indicator", () => {
    expect(panel).toContain("env(safe-area-inset-bottom)");
  });

  it("still has a mic to reach", () => {
    expect(panel).toContain('aria-label={mic === "listening" ? t("assistant.listening") : t("assistant.speak")}');
  });

  it("floats the launcher above the mobile nav rather than a guessed offset", () => {
    // The app publishes this: nav height + a gap + the safe-area inset. A fixed
    // bottom-20 was 80px of guess that ignored the inset entirely.
    expect(launcher).toContain("var(--app-mobile-bottom-nav-clearance)");
    expect(launcher).not.toContain("bottom-20");
  });

  it("keeps bounded quality feedback reachable on the full assistant, till fallback, and voice parser", () => {
    for (const surface of [panel, tillAssistant, voiceAssistant]) {
      expect(surface).toContain('"correct", "misunderstood", "unsafe"');
      expect(surface).toContain("submitAiFeedback");
      expect(surface).toContain("assistant.feedback.question");
    }
  });
});
