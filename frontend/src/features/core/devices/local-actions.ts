import { dexieDB } from "@/lib/offline/db";
import { nowIso } from "@/lib/offline/context";
import { emitLocalDataChanged } from "@/lib/offline/instant-cache";
import { activateDevice, removeDevice } from "@/features/core/devices/api";
import {
  listCachedDevices,
  markCurrentDeviceActivated,
  writeOfflineLicenseToken,
  type DeviceRegistration,
} from "@/features/core/devices/license";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Register the current browser only after the device service accepts it. */
export async function addDeviceLocalFirst(deviceName: string): Promise<DeviceRegistration> {
  const name = deviceName.trim();
  if (name.length < 2) throw new Error("Enter a device name before adding.");
  const response = await activateDevice(name);
  if (response.license) await writeOfflineLicenseToken(response.license, "backend-activation");
  return markCurrentDeviceActivated(name);
}

/**
 * Device removal is security-sensitive and cannot be queued offline. The local
 * fallback list changes only after the backend has revoked the device/session.
 */
export async function removeDeviceLocalFirst(deviceId: string, ownerPin: string): Promise<DeviceRegistration> {
  if (!/^\d{4}$/.test(ownerPin.trim())) throw new Error("Owner PIN is required to remove a device.");
  const devices = await listCachedDevices();
  const target = devices.find((device) => device.id === deviceId || device.device_id === deviceId);
  if (!target) throw new Error("Device not found in the saved device list.");

  await removeDevice(target.device_id, ownerPin, { removeCurrentDevice: target.is_current_device });

  const now = nowIso();
  const cached = await dexieDB.device_license_cache.get(target.id).catch(() => undefined);
  if (cached) {
    const payload = record(cached.payload);
    await dexieDB.device_license_cache.put({
      ...cached,
      status: "removed",
      payload: { ...payload, status: "removed", removed_at: now, owner_action_required: false },
      updated_at: now,
      deleted_at: now,
      sync_status: "synced",
    }).catch(() => undefined);
    emitLocalDataChanged();
  }
  return {
    ...target,
    status: "removed",
    sync_status: "synced",
    removed_at: now,
    owner_action_required: false,
  };
}
