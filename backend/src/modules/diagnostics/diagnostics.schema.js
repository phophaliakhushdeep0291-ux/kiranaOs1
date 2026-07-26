import { z } from "zod";

const optionalString = (max) => z.string().trim().max(max).optional();

/**
 * errorReportSchema — payload accepted from the frontend global error capture.
 *
 * `source` is intentionally NOT accepted from the client: the ingest endpoint
 * always stamps source="frontend", so a caller can never forge backend/worker
 * events into another shop's grouping. Unknown keys are dropped by zod's default
 * object parsing.
 */
export const errorReportSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  stack: z.string().max(20000).optional(),
  errorCode: optionalString(120),
  endpoint: optionalString(300),
  functionName: optionalString(200),
  fileName: optionalString(400),
  lineNumber: z.number().int().nonnegative().max(10_000_000).optional(),
  appVersion: optionalString(60),
  os: optionalString(120),
  browser: optionalString(300),
  networkStatus: z.enum(["online", "offline"]).optional(),
  onlineMode: z.boolean().optional(),
  memoryUsageMb: z.number().nonnegative().max(1_000_000).optional(),
  route: optionalString(300),
});

/**
 * supportRequestSchema — the "Report Issue" payload. The user types only
 * `description`; everything else is auto-collected context that the server
 * sanitizes and size-caps before persisting. `screenshot` is an optional
 * data-URL the server uploads best-effort to object storage.
 */
export const supportRequestSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  page: optionalString(300),
  appVersion: optionalString(60),
  context: z.record(z.any()).optional(),
  screenshot: z.string().max(4_500_000).optional(),
});

/**
 * assistantSchema — a natural-language troubleshooting question. The assistant
 * reads the shop's real diagnostics to answer it (§5); the user types only this.
 */
export const assistantSchema = z.object({
  question: z.string().trim().min(1).max(500),
});
