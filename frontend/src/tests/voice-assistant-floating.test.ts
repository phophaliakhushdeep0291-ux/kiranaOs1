import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/voice/VoiceAssistant.tsx", "utf8");

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

  it("stays compact and blended until the owner hovers or focuses it", () => {
    expect(source).toContain("assistantIsIdle");
    expect(source).toContain("opacity-[0.38] hover:opacity-100 focus-within:opacity-100");
    expect(source).toContain("bg-background/25 text-muted-foreground/45");
    expect(source).toContain("h-10 w-10");
    expect(source).toContain("sr-only");
    expect(source).toContain("hover:bg-sidebar hover:text-sidebar-foreground");
  });
});
