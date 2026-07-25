import { z } from "zod";

export const activateDeviceSchema = z.object({
  deviceId: z.string().min(3).max(128),
  deviceName: z.string().max(120).optional(),
  platform: z.string().max(50).optional(),
  fingerprintHash: z.string().max(255).optional(),
});

export const heartbeatSchema = z.object({
  deviceId: z.string().min(3).max(128).optional(),
});

export const deviceHealthSchema = z.object({
  printerStatus: z.enum(["ready", "offline", "error", "not_configured"]).optional(),
  printerName: z.string().max(200).optional(),
  scannerStatus: z.enum(["connected", "disconnected", "not_configured"]).optional(),
  online: z.boolean().optional(),
  networkType: z.string().max(40).optional(),
  dbStatus: z.enum(["ok", "degraded", "error"]).optional(),
  storageUsedMb: z.number().nonnegative().max(100_000_000).optional(),
  storageQuotaMb: z.number().nonnegative().max(100_000_000).optional(),
  appVersion: z.string().max(60).optional(),
  os: z.string().max(120).optional(),
  browser: z.string().max(200).optional(),
  batteryLevel: z.number().int().min(0).max(100).optional(),
  batteryCharging: z.boolean().optional(),
  ramUsedMb: z.number().nonnegative().max(10_000_000).optional(),
  ramLimitMb: z.number().nonnegative().max(10_000_000).optional(),
  cpuPercent: z.number().min(0).max(100).optional(),
  extra: z.record(z.any()).optional(),
});

export const logoutDeviceSchema = z.object({
  deviceId: z.string().min(3).max(128),
  currentDeviceId: z.string().min(3).max(128).optional(),
  deviceLimitToken: z.string().min(16).optional(),
});

export const licenseQuerySchema = z.object({
  deviceId: z.string().min(3).max(128).optional(),
});

export const renameDeviceSchema = z.object({
  deviceName: z.string().trim().min(1).max(120),
});
