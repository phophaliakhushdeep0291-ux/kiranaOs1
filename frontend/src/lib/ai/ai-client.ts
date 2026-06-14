import { apiRequest } from "@/lib/api/http";

export interface ProductAliasesAiRequest {
  name: string;
  category: string;
  unit?: string;
  language?: "hindi-hinglish-english" | string;
  languageContext?: string[];
}

export interface AppCommandAiRequest {
  command: string;
  context?: {
    currentScreen?: string;
    currentCart?: unknown[];
    currentCustomer?: unknown;
    visibleProducts?: unknown[];
  };
}

export interface VoiceBillingParseAiRequest {
  command: string;
  productNames?: string[];
}

export interface FormFillAiRequest {
  prompt: string;
  formName: string;
  currentValues?: Record<string, unknown>;
}

export async function requestAiAppCommand(
  payload: AppCommandAiRequest,
  init?: { signal?: AbortSignal },
): Promise<unknown> {
  // The backend AI router exposes POST /ai/parse-command (validated as
  // { transcript, context }). The old "/ai/app-command" path never existed, so
  // every voice command 404'd. Send the schema the backend actually validates.
  return apiRequest<unknown>("/ai/parse-command", {
    method: "POST",
    body: JSON.stringify({
      transcript: payload.command,
      ...(payload.context ? { context: payload.context } : {}),
    }),
    signal: init?.signal,
  });
}

export async function requestAiProductAliases(payload: ProductAliasesAiRequest): Promise<unknown> {
  return apiRequest<unknown>("/ai/product-aliases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function requestAiVoiceBillingParse(payload: VoiceBillingParseAiRequest): Promise<unknown> {
  return apiRequest<unknown>("/ai/voice-billing-parse", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function requestAiFormFill(payload: FormFillAiRequest): Promise<unknown> {
  return apiRequest<unknown>("/ai/form-fill", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
