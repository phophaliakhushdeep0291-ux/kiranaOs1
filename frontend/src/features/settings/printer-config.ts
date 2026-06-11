import { offlineDB } from "@/lib/offline/db";
import type { ReceiptPaperSize } from "@/features/receipts/receipt-print";

/**
 * Printer configuration lives inside the synced settings blob
 * (kirana:settings-prefs:v1 -> .printer) so it is offline-first and rides the
 * same debounced Shop.settingsJson sync as the rest of Settings. A printer is
 * physical/per-device, so connection details are advisory; the browser print
 * path always works as a universal fallback for a PWA.
 */
export type PrinterConnection = "browser" | "bluetooth" | "usb" | "network";

export interface PrinterConfig {
  connection: PrinterConnection;
  deviceName: string;
  networkAddress: string;
  paperSize: ReceiptPaperSize;
  autoPrint: boolean;
  copies: number;
  cashDrawer: boolean;
  showGst: boolean;
  footerText: string;
}

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  connection: "browser",
  deviceName: "Browser / system printer",
  networkAddress: "",
  paperSize: "80mm",
  autoPrint: true,
  copies: 1,
  cashDrawer: false,
  showGst: true,
  footerText: "Thank you for shopping with us.",
};

export const PRINTER_CONNECTION_LABELS: Record<PrinterConnection, string> = {
  browser: "Browser / system dialog",
  bluetooth: "Bluetooth thermal",
  usb: "USB thermal",
  network: "Network (LAN/IP)",
};

const PREFS_KEY = "kirana:settings-prefs:v1";

let cache: PrinterConfig = { ...DEFAULT_PRINTER_CONFIG };

/** Last-known printer config, readable synchronously from the print path. */
export function getPrinterConfigSync(): PrinterConfig {
  return cache;
}

/** Keep the sync cache in step after the Settings page saves a change. */
export function setPrinterConfigCache(config: Partial<PrinterConfig>) {
  cache = { ...DEFAULT_PRINTER_CONFIG, ...config };
}

/** Hydrate the cache from the offline settings blob (call once on app/page load). */
export async function loadPrinterConfig(): Promise<PrinterConfig> {
  try {
    const prefs = await offlineDB.getSetting<{ printer?: Partial<PrinterConfig> }>(PREFS_KEY);
    cache = { ...DEFAULT_PRINTER_CONFIG, ...(prefs?.printer ?? {}) };
  } catch {
    /* keep whatever is cached */
  }
  return cache;
}
