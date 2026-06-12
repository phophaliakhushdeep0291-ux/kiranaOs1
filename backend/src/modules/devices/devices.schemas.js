import { z } from "zod";

export const activateDeviceSchema = z.object({
  deviceId: z.string().min(3).max(128),
  deviceName: z.string().max(120).optional(),
  platform: z.string().max(50).optional(),
  fingerprintHash: z.string().max(255).optional(),
  // Used only when an owner/admin explicitly activates a new browser/device and
  // the plan is already full. This lets the owner replace their oldest active
  // device instead of getting stuck behind stale device rows left by old logins.
  replaceOldestSelfDevice: z.boolean().optional().default(false),
});

export const heartbeatSchema = z.object({
  deviceId: z.string().min(3).max(128),
});

export const licenseQuerySchema = z.object({
  deviceId: z.string().min(3).max(128).optional(),
});
