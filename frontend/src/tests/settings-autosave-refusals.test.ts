import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Shop } from "@/types/api";

/**
 * The settings autosave kept a refused blob "pending" and resent it every 30
 * seconds for as long as the app stayed open. A view-only login hit that the
 * moment it changed its printer: the server refuses every write it makes.
 */
const session = vi.hoisted(() => ({ role: "owner" as string }));
vi.mock("@/lib/storage/auth-storage", () => ({ loadAuthSession: () => ({ user: { role: session.role } }) }));
import { ApiClientError } from "@/lib/api/http";
import { persistSettingsPrefs, type PersistSettingsDeps, type SettingsPrefs } from "@/features/core/settings/use-settings-prefs";

const saved = { id: "shop-1", name: "Shop", settingsJson: "{}" } as unknown as Shop;

function harness(save: PersistSettingsDeps["save"], next: SettingsPrefs) {
  const deps = {
    pending: { current: next as SettingsPrefs | null },
    save: vi.fn(save),
    onSaved: vi.fn(),
    storePending: vi.fn(async () => undefined),
  };
  return deps;
}

describe("the settings autosave", () => {
  beforeEach(() => { session.role = "owner"; });

  it("keeps a view-only login's change on the device and never sends it", async () => {
    session.role = "viewer";
    const next: SettingsPrefs = { printer: { paperWidth: "58mm" } };
    const deps = harness(async () => saved, next);

    expect(await persistSettingsPrefs(next, deps)).toBeNull();
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.pending.current).toBeNull();
    expect(deps.storePending).toHaveBeenCalledWith(null);
  });

  it("stops retrying once the server has refused the blob", async () => {
    for (const status of [400, 403, 409, 422]) {
      const next: SettingsPrefs = { gstMode: "inclusive" };
      const deps = harness(async () => { throw new ApiClientError("refused", status); }, next);

      expect(await persistSettingsPrefs(next, deps)).toBeNull();
      expect(deps.pending.current, `status ${status}`).toBeNull();
      expect(deps.storePending).toHaveBeenLastCalledWith(null);
    }
  });

  it("keeps the blob owed when the request never got a verdict", async () => {
    const failures: unknown[] = [new TypeError("Failed to fetch"), new ApiClientError("down", 503), new ApiClientError("expired", 401)];
    for (const failure of failures) {
      const next: SettingsPrefs = { lowStock: true };
      const deps = harness(async () => { throw failure; }, next);

      expect(await persistSettingsPrefs(next, deps)).toBeNull();
      expect(deps.pending.current).toBe(next);
      expect(deps.storePending).toHaveBeenLastCalledWith(next);
    }
  });

  it("never lets an older attempt put itself back over a newer change", async () => {
    const older: SettingsPrefs = { dailySummary: false };
    const newer: SettingsPrefs = { dailySummary: true };
    const deps = harness(async () => { throw new TypeError("Failed to fetch"); }, newer);

    await persistSettingsPrefs(older, deps);
    expect(deps.pending.current).toBe(newer);
    expect(deps.storePending).not.toHaveBeenCalled();
  });

  it("clears what it sent once the server has it", async () => {
    const next: SettingsPrefs = { promotions: false };
    const deps = harness(async () => saved, next);

    expect(await persistSettingsPrefs(next, deps)).toBe(saved);
    expect(deps.save).toHaveBeenCalledWith(JSON.stringify(next));
    expect(deps.onSaved).toHaveBeenCalledWith(saved);
    expect(deps.pending.current).toBeNull();
  });
});
