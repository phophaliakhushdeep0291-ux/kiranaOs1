import { requestAiAppCommand } from "@/lib/ai/ai-client";
import { normalizeAiIntent } from "./voice-command-parser";
import type { VoiceIntent } from "./voice-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function askAiIntent(command: string): Promise<VoiceIntent | null> {
  try {
    const response = await requestAiAppCommand({ command });
    const maybeIntent = isRecord(response) && response.intent ? response.intent : response;
    const normalized = normalizeAiIntent(maybeIntent);
    if (normalized) return normalized;
  } catch {
    // Backend AI proxy is optional. The local parser remains the safe fallback.
  }

  return null;
}
