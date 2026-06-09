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

export async function requestAiAppCommand(payload: AppCommandAiRequest): Promise<unknown> {
  return apiRequest<unknown>("/ai/app-command", {
    method: "POST",
    body: JSON.stringify(payload),
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
