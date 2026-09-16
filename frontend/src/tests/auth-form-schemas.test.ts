import { describe, expect, it } from "vitest";
import { loginSchema, recoverySchema, resetPasswordSchema } from "@/features/core/auth/form-schemas";

describe("authentication form validation", () => {
  it("rejects whitespace-only identifiers before making a login or recovery request", () => {
    expect(recoverySchema.safeParse({ identifier: "   " }).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: "   ", password: "secret" }).success).toBe(false);
  });

  it("normalizes pasted identifiers without changing passwords", () => {
    expect(loginSchema.parse({ identifier: "  owner@example.com  ", password: " secret " }))
      .toEqual({ identifier: "owner@example.com", password: " secret " });
    expect(recoverySchema.parse({ identifier: "  9876543210 " }).identifier).toBe("9876543210");
  });

  it("returns translatable validation keys", () => {
    const result = loginSchema.safeParse({ identifier: "", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message))
      .toEqual(["auth.identifierRequired", "auth.passwordRequired"]);
  });

  it("requires a matching confirmation and preserves the exact new password", () => {
    expect(resetPasswordSchema.safeParse({ newPassword: "abcde", confirmPassword: "abcde" }).success).toBe(false);
    const mismatch = resetPasswordSchema.safeParse({ newPassword: "abcdef", confirmPassword: "abcdeg" });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) expect(mismatch.error.issues[0]).toMatchObject({ path: ["confirmPassword"], message: "auth.passwordMismatch" });
    expect(resetPasswordSchema.parse({ newPassword: " secret ", confirmPassword: " secret " }).newPassword).toBe(" secret ");
  });
});
