import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownerPinSchema } from "@/features/core/settings/owner-pin-form";
import { setOwnerPin } from "@/features/core/auth/api";
import type { Translate } from "@/features/core/settings/i18n";

const api = vi.hoisted(() => ({ request: vi.fn(), forget: vi.fn() }));
vi.mock("@/lib/api/http", () => ({ apiRequest: api.request }));
vi.mock("@/lib/storage/device-unlock-storage", () => ({ clearDeviceUnlock: api.forget }));
beforeEach(() => { api.request.mockReset().mockResolvedValue({ success: true }); api.forget.mockReset(); });

describe("Security owner-PIN form", () => {
  const schema = ownerPinSchema(((key: string) => key) as Translate);
  it("accepts a four-digit PIN independently of the login password", () => {
    expect(schema.parse({ currentPassword: "Owner@Password", pin: "2468", confirmPin: "2468" }).pin).toBe("2468");
  });
  it.each(["123", "12345", "abcd", "12 4", "１２３４"])("rejects an invalid PIN: %s", (pin) => {
    expect(schema.safeParse({ currentPassword: "Owner@Password", pin, confirmPin: pin }).success).toBe(false);
  });
  it("requires the current password and matching confirmation", () => {
    expect(schema.safeParse({ currentPassword: "", pin: "2468", confirmPin: "2468" }).success).toBe(false);
    expect(schema.safeParse({ currentPassword: "Password", pin: "2468", confirmPin: "1234" }).success).toBe(false);
  });
  it("sends the PIN and password proof to the PIN endpoint, never password change", async () => {
    await setOwnerPin("2468", "Owner@Password");
    expect(api.request).toHaveBeenCalledWith("/auth/pin/set", expect.objectContaining({ method: "POST", cache: "no-store", body: JSON.stringify({ pin: "2468", currentPassword: "Owner@Password" }) }));
    expect(api.forget).toHaveBeenCalledOnce();
    const page = readFileSync("src/features/core/settings/pages/SecuritySettingsPage.tsx", "utf8");
    expect(page).toContain("setOwnerPin(data.pin, data.currentPassword)");
    expect(page).not.toContain("useChangePassword");
    expect(page).not.toContain('register("newPassword")');
  });
  it("does not claim success or remove enrollment on rejected/unconfirmed changes", async () => {
    api.request.mockRejectedValueOnce(new Error("Wrong password"));
    await expect(setOwnerPin("2468", "wrong")).rejects.toThrow("Wrong password");
    api.request.mockResolvedValueOnce({ success: false });
    await expect(setOwnerPin("2468", "password")).rejects.toThrow("did not confirm");
    expect(api.forget).not.toHaveBeenCalled();
  });
});
