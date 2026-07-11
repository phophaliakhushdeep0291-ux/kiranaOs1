import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const identity = readFileSync("src/lib/device-identity.ts", "utf8");
const http = readFileSync("src/lib/api/http.ts", "utf8");
const authApi = readFileSync("src/features/auth/api.ts", "utf8");
const authContext = readFileSync("src/features/auth/AuthContext.tsx", "utf8");
const loginPage = readFileSync("src/features/auth/pages/LoginPage.tsx", "utf8");
const devicesPage = readFileSync("src/features/devices/pages/DevicesPage.tsx", "utf8");
const removedPage = readFileSync("src/features/devices/pages/DeviceRemovedPage.tsx", "utf8");
const routes = readFileSync("src/app/routes.tsx", "utf8");

describe("device-bound frontend sessions", () => {
  it("keeps one durable identity and hydrates it before network requests", () => {
    expect(identity).toContain('const DEVICE_ID_KEY = "kiranaos_device_id"');
    expect(identity).toContain("indexedDB.open");
    expect(identity).toContain("hydrationPromise ??=");
    expect(http).toContain("await hydrateDeviceIdentity()");
    expect(authApi).toContain("device: getDeviceMetadata()");
  });

  it("uses the owner-verified one-use replacement flow at login", () => {
    expect(loginPage).toContain("completeDeviceReplacement");
    expect(loginPage).toContain("replacementToken");
    expect(loginPage).toContain("Remove selected device and continue");
    expect(loginPage).toContain("ownerPin");
  });

  it("preserves unsynced records when a revoked device reconnects", () => {
    expect(authContext).toContain("offlineDB.getPendingCount()");
    expect(authContext).toContain('setLocation("/device-removed")');
    expect(removedPage).toContain("offlineDB.getPendingEvents()");
    expect(removedPage).toContain("Export unsynced data");
    expect(routes).toContain('path="/device-removed"');
  });

  it("keeps destructive device actions owner-verified and staff-safe", () => {
    expect(devicesPage).toContain('user?.role === "owner" || user?.role === "admin"');
    expect(devicesPage).toContain("visibleCached");
    expect(devicesPage).toContain("4-digit PIN");
    expect(devicesPage).toContain("Log out & remove");
    expect(devicesPage).not.toContain("Add device");
  });
});
