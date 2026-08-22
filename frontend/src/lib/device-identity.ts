export interface DeviceMetadata {
  deviceId: string;
  deviceName: string;
  deviceType: "desktop" | "laptop" | "mobile" | "tablet";
  operatingSystem: string;
  browser: string;
  platform: string;
  appVersion: string;
}

const DEVICE_ID_KEY = "kiranaos_device_id";
const LEGACY_DEVICE_ID_KEY = "kirana-os:device-id:v1";
const IDB_NAME = "kiranaos-device-identity";
const IDB_STORE = "identity";
let cachedDeviceId: string | null = null;
let hydrationPromise: Promise<string> | null = null;

function readRecoveryCopy(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DEVICE_ID_KEY)
      ?? window.localStorage.getItem(LEGACY_DEVICE_ID_KEY)
      ?? window.sessionStorage.getItem(DEVICE_ID_KEY)
      ?? window.sessionStorage.getItem(LEGACY_DEVICE_ID_KEY);
  } catch {
    return null;
  }
}

function writeRecoveryCopy(deviceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
    window.localStorage.setItem(LEGACY_DEVICE_ID_KEY, deviceId);
  } catch {
    try { window.sessionStorage.setItem(DEVICE_ID_KEY, deviceId); } catch { /* storage disabled */ }
  }
}

export function getPermanentDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  const existing = readRecoveryCopy();
  if (existing) {
    cachedDeviceId = existing;
    writeRecoveryCopy(existing);
    return existing;
  }
  cachedDeviceId = globalThis.crypto?.randomUUID?.() ?? `device_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  writeRecoveryCopy(cachedDeviceId);
  return cachedDeviceId;
}

/** IndexedDB is the durable primary copy; localStorage remains a synchronous recovery copy. */
export function hydrateDeviceIdentity(): Promise<string> {
  hydrationPromise ??= hydrateDeviceIdentityOnce();
  return hydrationPromise;
}

async function hydrateDeviceIdentityOnce(): Promise<string> {
  const recovery = getPermanentDeviceId();
  if (typeof indexedDB === "undefined") return recovery;
  try {
    const db = await openIdentityDb();
    const stored = await new Promise<string | null>((resolve, reject) => {
      const request = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(DEVICE_ID_KEY);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => reject(request.error);
    });
    const authoritative = stored || recovery;
    cachedDeviceId = authoritative;
    writeRecoveryCopy(authoritative);
    if (!stored) await putIndexedDbValue(db, authoritative);
    db.close();
    return authoritative;
  } catch {
    return recovery;
  }
}

function openIdentityDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putIndexedDbValue(db: IDBDatabase, deviceId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(deviceId, DEVICE_ID_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function getDeviceMetadata(): DeviceMetadata {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const operatingSystem = detectOperatingSystem(ua);
  const browser = detectBrowser(ua);
  const deviceType = detectDeviceType(ua);
  const deviceLabel = deviceType === "mobile" && operatingSystem === "iOS" ? "iPhone" : operatingSystem;
  return {
    deviceId: getPermanentDeviceId(),
    deviceName: `${browser} on ${deviceLabel}`,
    deviceType,
    operatingSystem,
    browser,
    platform: "web",
    appVersion: String(import.meta.env.VITE_APP_VERSION || "web"),
  };
}

/**
 * Names the terminal this browser runs on. A registered name must describe the
 * machine ("Chrome on Windows") and never the viewer: the fleet and device lists
 * show every terminal in the shop side by side, where "This device" is true of
 * exactly one row and a lie on all the others.
 */
export function describeCurrentDevice(): string {
  const { browser, operatingSystem, deviceName } = getDeviceMetadata();
  return browser === "Browser" && operatingSystem === "Unknown OS" ? "Shop terminal" : deviceName;
}

/** Stored names that describe whoever is looking instead of the machine. */
const VIEWER_RELATIVE_NAME = /^(this|my|current)\s+device$/i;

/**
 * Name to show for one device row. Terminals registered by older builds are all
 * stored as "This device", so fall back to something honest instead of repeating
 * that label down the whole list.
 */
export function displayDeviceName(
  storedName: string | null | undefined,
  isCurrentDevice: boolean,
  fallback = "Shop terminal",
): string {
  const stored = (storedName ?? "").trim();
  if (stored && !VIEWER_RELATIVE_NAME.test(stored)) return stored;
  return isCurrentDevice ? describeCurrentDevice() : fallback;
}

function detectOperatingSystem(ua: string): string {
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown OS";
}

function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  return "Browser";
}

function detectDeviceType(ua: string): DeviceMetadata["deviceType"] {
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Mobile|iPhone|iPod|Android/i.test(ua)) return "mobile";
  return "desktop";
}

void hydrateDeviceIdentity();
