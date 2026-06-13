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

export interface ActiveDeviceDto {
  deviceId: string;
  deviceName?: string | null;
  platform?: string | null;
  lastSeenAt?: string | null;
  current?: boolean;
  userId?: string | null;
  userName?: string | null;
  userRole?: string | null;
  sessionCount?: number;
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

export function listActiveDevices(currentDeviceId = getOfflineScope().device_id) {
  return apiRequest<{ activeDevices: ActiveDeviceDto[] }>(
    `/devices/active?currentDeviceId=${encodeURIComponent(currentDeviceId)}`,
  );
}

export function activateDevice(deviceName: string, deviceId = getOfflineScope().device_id) {
  return apiRequest<{ device: DeviceDto; license?: OfflineLicenseToken }>("/devices/activate", {
    method: "POST",
    body: JSON.stringify({
      deviceId,
      deviceName: deviceName.trim() || "This device",
      platform: platformName(),
    }),
  });
}

export function logoutDevice(deviceId: string, options: { deviceLimitToken?: string; currentDeviceId?: string } = {}) {
  return apiRequest<{ success: boolean; activeDevices?: ActiveDeviceDto[]; revokedSessions?: number }>("/devices/logout-device", {
    method: "POST",
    body: JSON.stringify({
      deviceId,
      currentDeviceId: options.currentDeviceId ?? getOfflineScope().device_id,
      deviceLimitToken: options.deviceLimitToken,
    }),
    skipAuth: Boolean(options.deviceLimitToken),
    skipRefresh: Boolean(options.deviceLimitToken),
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
