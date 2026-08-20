import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("billing sensitive approval handoff", () => {
  it("uses the PIN entered for the current confirm attempt instead of the previous render", () => {
    const page = fs.readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");

    expect(page).toContain("approvalOverride?: NonNullable<typeof sensitiveApproval>");
    expect(page).toContain("const effectiveSensitiveApproval = approvalOverride ?? sensitiveApproval");
    expect(page).toContain("billingSensitiveApprovalCovers(sensitiveActions, effectiveSensitiveApproval)");
    expect(page).toContain("ownerPin: sensitiveActions.length > 0 ? effectiveSensitiveApproval?.ownerPin : undefined");
    expect(page).toContain("handleConfirm(nextType, undefined, approval)");
    expect(page).not.toContain("setTimeout(() => handleConfirm(nextType), 0)");
  });
});
