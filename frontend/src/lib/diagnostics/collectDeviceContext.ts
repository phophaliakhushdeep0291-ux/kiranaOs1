import { getDeviceMetadata } from "@/lib/device-identity";

// Snapshot of the device/runtime attached to error reports and support requests
// (Diagnostics §1 fields + §4 device context). All fields are best-effort — this
// must never throw, since it runs inside error handlers.
export interface DiagnosticsDeviceContext {
  appVersion: string;
  os?: string;
  browser?: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  deviceType?: string;
  networkStatus: "online" | "offline";
  onlineMode: boolean;
  memoryUsageMb?: number;
  route?: string;
  screen?: string;
  language?: string;
  timeZone?: string;
}

// `performance.memory` is a non-standard Chrome-only extension.
interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize?: number };
}

export function collectDeviceContext(): DiagnosticsDeviceContext {
  let meta: Partial<ReturnType<typeof getDeviceMetadata>> = {};
  try {
    meta = getDeviceMetadata();
  } catch {
    // Best-effort: non-browser/test contexts fall back to defaults below.
  }

  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const perf = typeof performance !== "undefined" ? (performance as PerformanceWithMemory) : undefined;
  const usedHeap = perf?.memory?.usedJSHeapSize;

  return {
    appVersion: meta.appVersion ?? String(import.meta.env.VITE_APP_VERSION ?? "web"),
    os: meta.operatingSystem,
    browser: meta.browser,
    deviceId: meta.deviceId,
    deviceName: meta.deviceName,
    platform: meta.platform,
    deviceType: meta.deviceType,
    networkStatus: online ? "online" : "offline",
    onlineMode: online,
    memoryUsageMb: typeof usedHeap === "number" ? Math.round(usedHeap / 1048576) : undefined,
    route: typeof location !== "undefined" ? location.pathname : undefined,
    screen: typeof window !== "undefined" && window.screen ? `${window.screen.width}x${window.screen.height}` : undefined,
    language: typeof navigator !== "undefined" ? navigator.language : undefined,
    timeZone: safeTimeZone(),
  };
}

function safeTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
