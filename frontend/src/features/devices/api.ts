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
  deviceType?: string | null;
  platform?: string | null;
  operatingSystem?: string | null;
  browser?: string | null;
  registeredAt?: string;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
  lastSyncAt?: string | null;
  lastUserName?: string | null;
  isCurrentDevice?: boolean;
  isOnline?: boolean;
  activity?: "online" | "recent" | "offline";
}

export interface DeviceManagementSnapshot {
  plan: { code: string; name?: string; deviceLimit: number };
  devicesUsed: number;
  remainingSlots: number;
  overLimit: boolean;
  devices: DeviceDto[];
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
  return apiRequest<DeviceManagementSnapshot>("/devices");
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

export function logoutDevice(deviceId: string, ownerPin: string, currentDeviceId = getOfflineScope().device_id) {
  return apiRequest<{ success: boolean; activeDevices?: ActiveDeviceDto[]; revokedSessions?: number }>("/devices/logout-device", {
    method: "POST",
    body: JSON.stringify({
      deviceId,
      currentDeviceId,
    }),
    ownerPin,
  });
}

export function completeDeviceReplacement(input: { replacementToken: string; targetDeviceId: string; ownerPin: string }) {
  return apiRequest<import("@/types/api").AuthResponse>("/auth/device-replacement/complete", {
    method: "POST",
    body: JSON.stringify(input),
    skipAuth: true,
    skipRefresh: true,
  });
}

export function removeDevice(deviceId: string, ownerPin: string, options: { removeCurrentDevice?: boolean } = {}) {
  return apiRequest<DeviceDto & { removedCurrentDevice?: boolean }>(`/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    body: JSON.stringify({ removeCurrentDevice: options.removeCurrentDevice === true }),
    ownerPin,
  });
}

export function renameDevice(deviceId: string, deviceName: string) {
  return apiRequest<DeviceDto>(`/devices/${encodeURIComponent(deviceId)}`, {
    method: "PATCH",
    body: JSON.stringify({ deviceName }),
  });
}

export function blockDevice(deviceId: string, ownerPin: string) {
  return apiRequest<DeviceDto>(`/devices/${encodeURIComponent(deviceId)}/block`, { method: "POST", body: "{}", ownerPin });
}

export function reactivateDevice(deviceId: string, ownerPin: string) {
  return apiRequest<DeviceDto>(`/devices/${encodeURIComponent(deviceId)}/reactivate`, { method: "POST", body: "{}", ownerPin });
}

export function getCurrentDevice() {
  return apiRequest<DeviceDto>("/devices/current");
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
