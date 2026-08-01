import { describe, expect, it } from "vitest";
import {
  isSensitiveSyncKey,
  sanitizeSyncDiagnostic,
  sanitizeSyncRecord,
} from "@/features/sync/sensitive-data";

describe("sync diagnostic secret redaction", () => {
  it("removes credentials recursively but keeps proof that a PIN was provided", () => {
    const sanitized = sanitizeSyncDiagnostic({
      ownerPin: "1234",
      ownerPinProvided: true,
      payload: {
        owner_pin: "4321",
        accessToken: "secret-access-token",
        customer: { name: "Mohan" },
      },
      conflict: {
        local_snapshot: { password: "do-not-render", reason: "Duplicate bill" },
      },
    });

    expect(sanitized).toEqual({
      ownerPinProvided: true,
      payload: { customer: { name: "Mohan" } },
      conflict: { local_snapshot: { reason: "Duplicate bill" } },
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/1234|4321|secret-access-token|do-not-render/);
  });

  it("recognizes common credential fields without hiding ownerPinProvided", () => {
    expect(isSensitiveSyncKey("ownerPin")).toBe(true);
    expect(isSensitiveSyncKey("owner_pin")).toBe(true);
    expect(isSensitiveSyncKey("refresh_token")).toBe(true);
    expect(isSensitiveSyncKey("ownerPinProvided")).toBe(false);
  });

  it("returns a record only for object snapshots", () => {
    expect(sanitizeSyncRecord({ ownerPin: "1234", reason: "QA" })).toEqual({ reason: "QA" });
    expect(sanitizeSyncRecord("not a snapshot")).toBeNull();
  });
});
