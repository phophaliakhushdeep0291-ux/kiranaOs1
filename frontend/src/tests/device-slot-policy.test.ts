import { describe, expect, it } from "vitest";
import { countSlotOccupyingDevices, deviceStatusOccupiesSlot, normalizeDeviceStatus } from "@/features/devices/device-slot-policy";

describe("device slot policy", () => {
  it("counts active, logged-out, and blocked devices while excluding revoked rows", () => {
    const devices = [
      { status: "active" },
      { status: "logged_out" },
      { status: "blocked" },
      { status: "revoked" },
      { status: "removed" },
    ];

    expect(countSlotOccupyingDevices(devices)).toBe(3);
    expect(deviceStatusOccupiesSlot("blocked")).toBe(true);
    expect(deviceStatusOccupiesSlot("revoked")).toBe(false);
  });

  it("normalizes legacy removed status without hiding unknown states", () => {
    expect(normalizeDeviceStatus("removed")).toBe("revoked");
    expect(normalizeDeviceStatus(" LOGGED_OUT ")).toBe("logged_out");
    expect(normalizeDeviceStatus("pending_review")).toBe("pending_review");
  });
});
