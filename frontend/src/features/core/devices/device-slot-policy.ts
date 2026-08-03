export const DEVICE_SLOT_OCCUPYING_STATUSES = ["active", "logged_out", "blocked"] as const;

export function normalizeDeviceStatus(status: unknown) {
  const normalized = typeof status === "string" && status.trim()
    ? status.trim().toLowerCase()
    : "active";
  return normalized === "removed" ? "revoked" : normalized;
}

export function deviceStatusOccupiesSlot(status: unknown) {
  return DEVICE_SLOT_OCCUPYING_STATUSES.includes(
    normalizeDeviceStatus(status) as (typeof DEVICE_SLOT_OCCUPYING_STATUSES)[number],
  );
}

export function countSlotOccupyingDevices(devices: ReadonlyArray<{ status?: unknown }>) {
  return devices.reduce((count, device) => count + (deviceStatusOccupiesSlot(device.status) ? 1 : 0), 0);
}
