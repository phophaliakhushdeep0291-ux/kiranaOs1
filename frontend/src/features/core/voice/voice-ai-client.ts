import { requestAiAppCommand } from "@/lib/ai/ai-client";
import { normalizeAiIntent } from "./voice-command-parser";
import type { VoiceIntent } from "./voice-types";

// The AI enhancement is optional: a missing backend AI provider key (backend 503), an
// unreachable/slow proxy, or any error must never block the reliable local
// parser. Bound the call so it can't hang the command at "Understanding…".
const AI_COMMAND_TIMEOUT_MS = 3500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The backend /ai/parse-command returns a shop/billing-oriented schema:
 *   { intent: "SEARCH_PRODUCT" | "ADD_ITEMS" | ..., confidence, customer, items,
 *     payment, target, clarificationNeeded, messageToUser }
 * Translate the safely-mappable intents into the app's VoiceIntent. Anything
 * ambiguous, low-confidence, or destructive (CANCEL_BILL, DELETE_PRODUCT, …)
 * returns null so runCommand falls back to the local parser, which never runs a
 * destructive action without explicit review.
 */
export function adaptBackendCommandIntent(data: unknown, command: string): VoiceIntent | null {
  if (!isRecord(data)) return null;
  const intent = str(data.intent)?.toUpperCase();
  if (!intent) return null;

  const message = str(data.messageToUser);
  const confidence = num(data.confidence);
  const safety = isRecord(data.safety) ? data.safety : undefined;
  if (
    data.permissionAllowed === false
    || safety?.schemaValid === false
    || safety?.requiresManualFallback === true
    || data.clarificationNeeded === true
    || confidence === undefined
    || confidence < 0.65
  ) {
    return null;
  }

  const items = Array.isArray(data.items) ? data.items.filter(isRecord) : [];
  const customer = isRecord(data.customer) ? data.customer : undefined;
  const query = str(items[0]?.query) ?? str(data.target);

  switch (intent) {
    case "SEARCH_PRODUCT":
      return query
        ? { action: "search", route: "/products", search: { target: "product", query }, message, auditable: true }
        : null;
    case "SHOW_KHATA":
      return { action: "navigate", route: "/udhar", message, auditable: true };
    case "OPEN_REPORTS":
      return { action: "navigate", route: "/reports", message, auditable: true };
    case "OPEN_INVENTORY":
      return { action: "navigate", route: "/inventory", message, auditable: true };
    case "SET_CUSTOMER":
    case "CREATE_CUSTOMER":
      return {
        action: "customer_draft",
        route: "/customers",
        customer: {
          mode: intent === "SET_CUSTOMER" ? "edit" : "create",
          name: str(customer?.name),
          mobile: str(customer?.mobile),
        },
        message,
        auditable: true,
      };
    case "ADD_ITEMS":
    case "REMOVE_ITEM":
    case "UPDATE_QUANTITY":
    case "SET_PAYMENT":
    case "APPLY_DISCOUNT":
    case "CONFIRM_BILL":
      // Hand the raw transcript to the billing page, which re-parses it locally
      // with full cart/product context. Always confirmed before it touches a bill.
      return {
        action: "billing_command",
        route: "/billing",
        billingCommand: command,
        requiresConfirmation: true,
        message,
        auditable: true,
      };
    default:
      return null;
  }
}

export async function askAiIntent(command: string, currentScreen?: string): Promise<VoiceIntent | null> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), AI_COMMAND_TIMEOUT_MS)
    : null;
  try {
    const response = await requestAiAppCommand(
      { command, context: currentScreen ? { currentScreen } : undefined },
      controller ? { signal: controller.signal } : undefined,
    );

    // Primary: the live backend parse-command schema.
    const adapted = adaptBackendCommandIntent(response, command);
    if (adapted) return adapted;

    // Forward-compat: if a deployment already returns the app-command shape.
    const maybeIntent = isRecord(response) && isRecord(response.intent) ? response.intent : response;
    const normalized = normalizeAiIntent(maybeIntent);
    if (normalized && normalized.action !== "noop") return normalized;
  } catch {
    // Backend AI proxy is optional. The local parser remains the safe fallback.
  } finally {
    if (timer) clearTimeout(timer);
  }

  return null;
}
