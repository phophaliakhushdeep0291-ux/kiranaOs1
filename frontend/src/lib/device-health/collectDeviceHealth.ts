import { getDeviceMetadata } from "@/lib/device-identity";
import { getPrinterConfigSync } from "@/features/settings/printer-config";
import { checkHardwareBridge } from "@/features/hardware/local-hardware-bridge";
import { offlineDB } from "@/lib/offline/db";

// Gathers the runtime health signals for Diagnostics §4. Every probe is
// best-effort and self-contained so this never throws — the server computes the
// overall status/score from whatever fields are present.
export interface DeviceHealthPayload {
  online: boolean;
  networkType?: string;
  printerStatus: "ready" | "offline" | "error" | "not_configured";
  printerName?: string;
  scannerStatus: "not_configured";
  dbStatus: "ok" | "error";
  storageUsedMb?: number;
  storageQuotaMb?: number;
  appVersion?: string;
  os?: string;
  browser?: string;
  batteryLevel?: number;
  batteryCharging?: boolean;
  ramUsedMb?: number;
  ramLimitMb?: number;
}

interface NavigatorConnection {
  effectiveType?: string;
}
interface BatteryManager {
  level: number;
  charging: boolean;
}
interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
}

const BYTES_PER_MB = 1_048_576;
const toMb = (bytes?: number) => (typeof bytes === "number" && Number.isFinite(bytes) ? Math.round(bytes / BYTES_PER_MB) : undefined);

// Only the configured local hardware bridge exposes a health probe. Browser/system
// printing has no queryable status, so it reports as "not_configured".
async function probePrinter(): Promise<{ status: DeviceHealthPayload["printerStatus"]; name?: string }> {
  try {
    const cfg = getPrinterConfigSync();
    if (cfg.connection !== "bridge" || !cfg.bridgeUrl) return { status: "not_configured" };
    const health = await checkHardwareBridge(cfg.bridgeUrl);
    return { status: health.ok ? "ready" : "error", name: health.deviceName };
  } catch {
    return { status: "offline" };
  }
}

async function probeStorage(): Promise<{ usedMb?: number; quotaMb?: number }> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return {};
    const estimate = await navigator.storage.estimate();
    return { usedMb: toMb(estimate.usage), quotaMb: toMb(estimate.quota) };
  } catch {
    return {};
  }
}

async function probeBattery(): Promise<{ level?: number; charging?: boolean }> {
  try {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }).getBattery;
    if (!getBattery) return {};
    const battery = await getBattery.call(navigator);
    return { level: Math.round(battery.level * 100), charging: battery.charging };
  } catch {
    return {};
  }
}

async function probeDb(): Promise<"ok" | "error"> {
  try {
    await offlineDB.getPendingCount();
    return "ok";
  } catch {
    return "error";
  }
}

function probeRam(): { usedMb?: number; limitMb?: number } {
  const perf = typeof performance !== "undefined" ? (performance as PerformanceWithMemory) : undefined;
  return { usedMb: toMb(perf?.memory?.usedJSHeapSize), limitMb: toMb(perf?.memory?.jsHeapSizeLimit) };
}

export async function collectDeviceHealth(): Promise<DeviceHealthPayload> {
  let meta: Partial<ReturnType<typeof getDeviceMetadata>> = {};
  try {
    meta = getDeviceMetadata();
  } catch {
    // Best effort — non-browser/test contexts fall back to defaults.
  }

  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const connection = typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: NavigatorConnection }).connection : undefined;

  const [printer, storage, battery, dbStatus] = await Promise.all([probePrinter(), probeStorage(), probeBattery(), probeDb()]);
  const ram = probeRam();

  return {
    online,
    networkType: connection?.effectiveType,
    printerStatus: printer.status,
    printerName: printer.name,
    scannerStatus: "not_configured",
    dbStatus,
    storageUsedMb: storage.usedMb,
    storageQuotaMb: storage.quotaMb,
    appVersion: meta.appVersion ?? String(import.meta.env.VITE_APP_VERSION ?? "web"),
    os: meta.operatingSystem,
    browser: meta.browser,
    batteryLevel: battery.level,
    batteryCharging: battery.charging,
    ramUsedMb: ram.usedMb,
    ramLimitMb: ram.limitMb,
  };
}
