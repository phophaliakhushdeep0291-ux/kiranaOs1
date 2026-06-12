import { apiRequest } from "@/lib/api/http";
import { getOfflineScope } from "@/lib/offline/context";
import type { OfflineLicenseToken } from "@/features/devices/license";

export interface DeviceDto {
  id: string;
  device_id?: string;
  deviceId?: string;
  device_name?: string;
  deviceName?: string;
  status?: string;
  last_active_at?: string;
  lastActiveAt?: string;
  sync_status?: string;
}

function platformName() {
  if (typeof navigator === "undefined") return "web";
  const userAgent = navigator.userAgent || "web";
  if (/Windows/i.test(userAgent)) return "windows-web";
  if (/Android/i.test(userAgent)) return "android-web";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios-web";
  if (/Mac/i.test(userAgent)) return "mac-web";
  return "web";
}

export function listDevices() {
  return apiRequest<{ devices: DeviceDto[]; license?: OfflineLicenseToken }>("/devices");
}

export function activateDevice(deviceName: string, deviceId = getOfflineScope().device_id, options: { replaceOldestSelfDevice?: boolean } = {}) {
  return apiRequest<{ device: DeviceDto; license?: OfflineLicenseToken }>("/devices/activate", {
    method: "POST",
    body: JSON.stringify({
      deviceId,
      deviceName: deviceName.trim() || "This device",
      platform: platformName(),
      replaceOldestSelfDevice: options.replaceOldestSelfDevice === true,
    }),
  });
}

export function removeDevice(deviceId: string, ownerPin: string) {
  return apiRequest<{ success: boolean }>(`/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    ownerPin,
  });
}

export function getOfflineLicense(deviceId = getOfflineScope().device_id) {
  return apiRequest<{ license: OfflineLicenseToken }>(`/devices/license?deviceId=${encodeURIComponent(deviceId)}`);
}

export function heartbeatDevice(deviceId = getOfflineScope().device_id) {
  return apiRequest<DeviceDto>("/devices/heartbeat", {
    method: "POST",
    body: JSON.stringify({ deviceId }),
  });
}
