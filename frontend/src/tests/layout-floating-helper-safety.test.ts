import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");

describe("layout floating helper safety", () => {
  it("defines the billing-screen guard in Layout before either helper uses it", () => {
    const definition = layout.indexOf('const floatingHelpersAllowed = cleanPath(loc) !== "/billing"');
    const voiceUse = layout.indexOf('floatingHelpersAllowed && <VoiceAssistant />');
    const assistantUse = layout.indexOf('floatingHelpersAllowed && <AssistantLauncher />');

    expect(definition).toBeGreaterThan(-1);
    expect(voiceUse).toBeGreaterThan(definition);
    expect(assistantUse).toBeGreaterThan(definition);
  });
});
