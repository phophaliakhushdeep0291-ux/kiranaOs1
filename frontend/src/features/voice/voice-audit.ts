import { writeAuditLog } from "@/features/audit-logs/local-actions";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import type { VoiceIntent } from "./voice-types";

export type VoiceCommandAuditResult = "success" | "failed";

export type VoiceCommandAuditInput = {
  commandText: string;
  intent: VoiceIntent;
  actionResult: VoiceCommandAuditResult;
  resultMessage?: string;
  userConfirmed?: boolean;
  pinConfirmed?: boolean;
  error?: unknown;
};

export type VoiceAuditContext = {
  tenant_id: string;
  store_id: string;
  device_id: string;
  user_id: string;
  timestamp: string;
};

export type VoiceCommandAuditPayload = {
  command_text: string;
  parsed_intent: Record<string, unknown>;
  action_preview: Record<string, unknown>;
  user_confirmed: boolean;
  action_result: VoiceCommandAuditResult;
  result_message: string | null;
  pin_required: boolean;
  pin_confirmed: boolean;
  device_id: string;
  user_id: string;
  tenant_id: string;
  store_id: string;
  timestamp: string;
  error_message?: string;
};

const SENSITIVE_VALUE = "[REDACTED]";

function safeReadStorageRecord(key: string): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readCurrentUserId(): string {
  const user = safeReadStorageRecord("user");
  const id = user?.id ?? user?.userId ?? user?.actorId;
  return typeof id === "string" && id.trim() ? id.trim() : "local-user";
}

export function readVoiceAuditContext(): VoiceAuditContext {
  const scope = getOfflineScope();
  return {
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    user_id: readCurrentUserId(),
    timestamp: nowIso(),
  };
}

export function redactSensitiveVoiceText(value: string): string {
  return value
    .replace(/\b(owner\s*pin|pin|otp|password|passcode)\s*(?:is|:|=)?\s*\d{3,12}\b/gi, `$1 ${SENSITIVE_VALUE}`)
    .replace(/\b\d{3,12}\s*(owner\s*pin|pin|otp|password|passcode)\b/gi, `${SENSITIVE_VALUE} $1`)
    .replace(/\b(pin|otp)\s+(confirm|confirmed)\s*\d{3,12}\b/gi, `$1 $2 ${SENSITIVE_VALUE}`);
}

function sanitizeAuditValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveVoiceText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item));
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[_\s-]/g, "");
    if (["pin", "ownerpin", "otp", "password", "passcode"].includes(normalizedKey)) {
      sanitized[key] = SENSITIVE_VALUE;
      continue;
    }
    sanitized[key] = sanitizeAuditValue(entry);
  }
  return sanitized;
}

function compactObject(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  );
}

export function buildVoiceActionPreview(intent: VoiceIntent): Record<string, unknown> {
  if (intent.action === "navigate") {
    return compactObject({ type: "navigation", route: intent.route, message: intent.message });
  }
  if (intent.action === "billing_command") {
    return compactObject({ type: "billing_draft", route: "/billing", requires_review: true, command: intent.billingCommand });
  }
  if (intent.action === "product_draft") {
    return compactObject({ type: "product_draft", route: "/products", requires_review: true, draft: intent.product });
  }
  if (intent.action === "customer_draft") {
    return compactObject({ type: "customer_draft", route: "/customers", requires_review: true, draft: intent.customer });
  }
  if (intent.action === "inventory_draft") {
    return compactObject({
      type: "inventory_draft",
      route: "/inventory",
      requires_review: true,
      pin_required: Boolean(intent.requiresOwnerPin),
      draft: intent.inventory,
    });
  }
  if (intent.action === "payment_draft") {
    return compactObject({ type: "payment_draft", route: "/udhar", requires_review: true, draft: intent.payment });
  }
  if (intent.action === "search") {
    return compactObject({ type: "search", route: intent.route, search: intent.search });
  }
  if (intent.action === "dashboard_summary") {
    return compactObject({ type: "dashboard_summary", route: "/dashboard" });
  }
  if (intent.action === "sync_count") {
    return compactObject({ type: "sync_count", route: intent.route ?? "/sync-status" });
  }
  return compactObject({ type: "unrecognized", message: intent.message });
}

export function sanitizeVoiceIntentForAudit(intent: VoiceIntent): Record<string, unknown> {
  const sanitized = sanitizeAuditValue({
    action: intent.action,
    route: intent.route,
    billingCommand: intent.billingCommand,
    product: intent.product,
    customer: intent.customer,
    inventory: intent.inventory,
    payment: intent.payment,
    search: intent.search,
    message: intent.message,
    requiresConfirmation: intent.requiresConfirmation,
    requiresOwnerPin: intent.requiresOwnerPin,
    auditable: intent.auditable,
  });
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : { action: intent.action };
}

function errorToMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Voice command failed.";
}

export function buildVoiceCommandAuditPayload(
  input: VoiceCommandAuditInput,
  context: VoiceAuditContext = readVoiceAuditContext(),
): VoiceCommandAuditPayload {
  const commandText = redactSensitiveVoiceText(input.commandText.trim());
  const payload: VoiceCommandAuditPayload = {
    command_text: commandText,
    parsed_intent: sanitizeVoiceIntentForAudit(input.intent),
    action_preview: sanitizeAuditValue(buildVoiceActionPreview(input.intent)) as Record<string, unknown>,
    user_confirmed: Boolean(input.userConfirmed),
    action_result: input.actionResult,
    result_message: input.resultMessage ? redactSensitiveVoiceText(input.resultMessage) : null,
    pin_required: Boolean(input.intent.requiresOwnerPin),
    pin_confirmed: Boolean(input.pinConfirmed),
    device_id: context.device_id,
    user_id: context.user_id,
    tenant_id: context.tenant_id,
    store_id: context.store_id,
    timestamp: context.timestamp,
  };
  const errorMessage = errorToMessage(input.error);
  if (errorMessage) payload.error_message = redactSensitiveVoiceText(errorMessage);
  return payload;
}

export async function recordVoiceCommandAudit(input: VoiceCommandAuditInput) {
  const context = readVoiceAuditContext();
  const payload = buildVoiceCommandAuditPayload(input, context);

  try {
    return await writeAuditLog({
      action: "voice_command",
      entityType: "voice_command",
      entityId: `voice:${context.timestamp}:${Math.random().toString(36).slice(2, 8)}`,
      entityLabel: input.intent.action,
      userId: context.user_id,
      reason: payload.command_text,
      summary: `Voice command ${input.actionResult}: ${input.intent.action.replaceAll("_", " ")}`,
      newValue: payload,
      ownerPinProvided: payload.pin_confirmed,
      enqueueSync: true,
    });
  } catch {
    return null;
  }
}
