// Device-local public credential only; never part of a synced shop or backup.
export const DEVICE_UNLOCK_KEY = "kiranaos.security.biometricCredential.v2";
export const LEGACY_DEVICE_UNLOCK_KEY = "kiranaos.security.biometricCredential.v1";

export function clearDeviceUnlock(): void {
  if (typeof window === "undefined") return;
  for (const key of [DEVICE_UNLOCK_KEY, LEGACY_DEVICE_UNLOCK_KEY]) {
    try { window.localStorage.removeItem(key); } catch { /* denied storage cannot unlock */ }
  }
}
