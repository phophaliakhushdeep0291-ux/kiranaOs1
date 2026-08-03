import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/core/voice/VoiceAssistant.tsx", "utf8");

describe("floating voice assistant", () => {
  it("can be moved and keeps its saved screen position", () => {
    expect(source).toContain("VOICE_ASSISTANT_POSITION_KEY");
    expect(source).toContain("readStoredAssistantPosition");
    expect(source).toContain("saveAssistantPosition");
    expect(source).toContain("handleMovePointerDown");
    expect(source).toContain("requestAnimationFrame");
  });

  it("has an explicit drag handle without stealing the mic button click", () => {
    expect(source).toContain("Move voice assistant");
    expect(source).toContain("GripVertical");
    expect(source).toContain("setPointerCapture");
    expect(source).toContain("Voice assistant");
  });

  it("lets the closed mic itself move while preserving click-to-open", () => {
    expect(source).toContain('data-voice-mic="true"');
    expect(source).toContain("distance < 5");
    expect(source).toContain("suppressMicClickRef");
    expect(source).toContain("onPointerDown={handleMovePointerDown}");
    expect(source).toContain("touch-none");
    expect(source).toContain('window.addEventListener("pointercancel"');
  });

  it("stays compact and blended until the owner hovers or focuses it", () => {
    expect(source).toContain("assistantIsIdle");
    expect(source).toContain("opacity-75 hover:opacity-100 focus-within:opacity-100");
    expect(source).toContain("border-[var(--brand-border)] bg-white text-[var(--brand)]");
    expect(source).toContain("h-11 w-11");
    expect(source).toContain("max-h-[min(calc(100dvh-120px),620px)]");
    expect(source).toContain("sr-only");
    expect(source).toContain("hover:bg-[var(--brand)] hover:text-white");
  });

  it("keeps clear of the mobile bottom navigation by default", () => {
    expect(source).toContain("MOBILE_BOTTOM_NAV_OFFSET");
    expect(source).toContain("getFloatingBottomOffset");
    expect(source).toContain("window.innerWidth < 1024");
    expect(source).toContain("window.innerHeight - safeHeight - getFloatingBottomOffset()");
  });
});
