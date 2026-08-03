import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("business profile bootstrap wiring", () => {
  it("sends the selected preset during registration", () => {
    const register = readFileSync("src/features/core/auth/pages/RegisterPage.tsx", "utf8");
    expect(register).toContain("businessType: selectedType");
  });

  it("locks the profile selector using server bootstrap state", () => {
    const profile = readFileSync("src/features/core/settings/pages/StoreProfilePage.tsx", "utf8");
    expect(profile).toContain("getShopBootstrap");
    expect(profile).toContain("disabled={businessTypeLocked}");
    expect(profile).toContain("Request Business Type Change");
  });
});
