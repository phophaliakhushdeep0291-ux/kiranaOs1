import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("OwnerPinModal source contract", () => {
  const source = readFileSync("src/components/security/OwnerPinModal.tsx", "utf8");
  const dialogSource = readFileSync("src/components/ui/dialog.tsx", "utf8");

  it("uses a masked PIN field and does not persist PIN data", () => {
    expect(source).toContain('type="password"');
    expect(source).toContain("autoComplete=\"off\"");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("window.prompt");
  });

  it("supports reason capture and object-based confirmation payload", () => {
    expect(source).toContain("reasonRequired");
    expect(source).toContain("onConfirm({ ownerPin: cleanPin, reason: cleanReason })");
  });

  it("keeps approval dialogs above slide panels on mobile", () => {
    expect(dialogSource.match(/z-\[100\]/g)).toHaveLength(2);
    expect(dialogSource).not.toContain("z-50 grid");
  });
});
