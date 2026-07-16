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

export interface AudioTranscriptionResult {
  transcript: string;
  model: string;
  provider: "openai" | "groq" | string;
}

function audioFileExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "webm";
}

export async function requestAiAudioTranscription(
  audio: Blob,
  init?: { signal?: AbortSignal; fileName?: string },
): Promise<AudioTranscriptionResult> {
  if (!(audio instanceof Blob) || audio.size === 0) throw new Error("Recorded audio is empty");

  const form = new FormData();
  const fileName = init?.fileName ?? `voice-command.${audioFileExtension(audio.type)}`;
  form.append("audio", audio, fileName);

  return apiRequest<AudioTranscriptionResult>("/ai/transcribe", {
    method: "POST",
    body: form,
    signal: init?.signal,
  });
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
