import { z } from "zod";

export const activateDeviceSchema = z.object({
  deviceId: z.string().min(3).max(128),
  deviceName: z.string().max(120).optional(),
  platform: z.string().max(50).optional(),
  fingerprintHash: z.string().max(255).optional(),
});

export const heartbeatSchema = z.object({
  deviceId: z.string().min(3).max(128),
});

export const licenseQuerySchema = z.object({
  deviceId: z.string().min(3).max(128).optional(),
});
