import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeCurrentDevice, displayDeviceName } from "@/lib/device-identity";

const identity = readFileSync("src/lib/device-identity.ts", "utf8");
const http = readFileSync("src/lib/api/http.ts", "utf8");
const authApi = readFileSync("src/features/core/auth/api.ts", "utf8");
const authContext = readFileSync("src/features/core/auth/AuthContext.tsx", "utf8");
const loginPage = readFileSync("src/features/core/auth/pages/LoginPage.tsx", "utf8");
const devicesPage = readFileSync("src/features/core/devices/pages/DevicesPage.tsx", "utf8");
const removedPage = readFileSync("src/features/core/devices/pages/DeviceRemovedPage.tsx", "utf8");
const routes = readFileSync("src/app/routes.tsx", "utf8");
const license = readFileSync("src/features/core/devices/license.ts", "utf8");
const devicesApi = readFileSync("src/features/core/devices/api.ts", "utf8");

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
    // The label moved into the dictionary; the button it names is what this
    // pins, so the key stands in for the English that used to be inline.
    expect(loginPage).toContain('t("auth.removeAndContinue")');
    expect(loginPage).toContain("ownerPin");
  });

  it("preserves unsynced records when a revoked device reconnects", () => {
    expect(authContext).toContain("offlineDB.getPendingCount()");
    expect(authContext).toContain('setLocation("/device-removed")');
    expect(removedPage).toContain("offlineDB.getPendingEvents()");
    expect(removedPage).toContain("Export unsynced data");
    expect(routes).toContain('path="/device-removed"');
  });

  // Pinned on translation keys, not English: this page reads its copy from the
  // dictionary now, so the literal strings are no longer in the source.
  it("keeps destructive device actions owner-verified and staff-safe", () => {
    expect(devicesPage).toContain('user?.role === "owner" || user?.role === "admin"');
    expect(devicesPage).toContain("visibleCached");
    expect(devicesPage).toContain("devices.confirm.pinPlaceholder");
    expect(devicesPage).toContain("logoutDevice");
    expect(devicesPage).toContain("devices.action.logout");
    expect(devicesPage).toContain("devices.action.logoutAndRemove");
    expect(devicesPage).not.toContain("Add device");
  });

  it("registers each terminal under a name that describes the machine, not the viewer", () => {
    // Every terminal used to register itself as the literal "This device", so the
    // fleet listed the whole shop under one name that was false on all but one row.
    expect(authContext).toContain("const deviceName = describeCurrentDevice();");
    expect(authContext).not.toContain('"This device"');
    expect(devicesApi).toContain("deviceName.trim() || describeCurrentDevice()");
    expect(license).not.toContain('"This device"');

    expect(displayDeviceName("Counter 2", false)).toBe("Counter 2");
    expect(displayDeviceName("This device", false)).toBe("Shop terminal");
    expect(displayDeviceName("", false, "Registered device")).toBe("Registered device");
    expect(displayDeviceName("this device", true)).not.toMatch(/^this device$/i);
    expect(describeCurrentDevice()).not.toMatch(/^(this|my|current) device$/i);
  });

  it("does not claim a new device is active before server activation succeeds", () => {
    expect(license).toContain('"pending_activation"');
    expect(license).toContain("markCurrentDeviceActivated");
    const activateRequest = authContext.indexOf("await activateDevice(");
    const markActive = authContext.indexOf("await markCurrentDeviceActivated(");
    expect(activateRequest).toBeGreaterThan(-1);
    expect(markActive).toBeGreaterThan(activateRequest);
  });
});
