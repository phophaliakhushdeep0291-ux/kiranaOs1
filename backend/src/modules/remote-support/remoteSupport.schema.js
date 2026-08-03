import { z } from "zod";
import { COMMAND_SCOPES, COMMAND_STATUS, COMMAND_TYPES, MAX_SESSION_TTL_MINUTES } from "./commands.catalog.js";

const optionalString = (max) => z.string().trim().max(max).optional();

/** Owner grants remote access. Scope defaults to the read-only tier. */
export const createSessionSchema = z.object({
  scope: z.enum([COMMAND_SCOPES.DIAGNOSE, COMMAND_SCOPES.REPAIR]).optional(),
  deviceId: optionalString(200),
  reason: optionalString(500),
  expiresInMinutes: z.number().int().positive().max(MAX_SESSION_TTL_MINUTES).optional(),
});

/** Operator exchanges the owner's spoken code for a session. */
export const redeemCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from the shop owner's screen"),
});

/**
 * `type` is constrained to the catalog at the edge as well as in the service, so
 * an unknown command is rejected with a clear validation error rather than a 400
 * from deeper in the stack.
 */
export const dispatchCommandSchema = z.object({
  sessionId: z.string().trim().min(1).max(100),
  type: z.enum(COMMAND_TYPES),
  deviceId: optionalString(200),
  reason: optionalString(500),
  params: z.record(z.unknown()).optional(),
});

/** Device reports the outcome of a command it was handed. */
export const commandResultSchema = z.object({
  status: z.enum([COMMAND_STATUS.APPLIED, COMMAND_STATUS.FAILED]),
  result: z.record(z.unknown()).optional(),
  error: optionalString(1000),
});

export const sessionIdParamSchema = z.object({
  sessionId: z.string().trim().min(1).max(100),
});

/** Owner switches unattended fixes on or off for the whole shop. */
export const autoFixSettingsSchema = z.object({
  enabled: z.boolean(),
});
