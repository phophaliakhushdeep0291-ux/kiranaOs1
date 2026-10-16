const MICROPHONE_KEY = "kirana:microphone-input";
let sessionDevice: string | undefined;

export function selectedMicrophone(): string {
  if (sessionDevice !== undefined) return sessionDevice;
  try { return localStorage.getItem(MICROPHONE_KEY) || ""; } catch { return ""; }
}

export function selectMicrophone(deviceId: string): void {
  sessionDevice = deviceId;
  try { localStorage.setItem(MICROPHONE_KEY, deviceId); } catch { /* Session selection still works. */ }
}

export type MicrophoneFeedback = { deviceName: string; level: number | null; elapsedSeconds: number };

