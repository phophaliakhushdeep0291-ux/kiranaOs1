import { askAiIntent } from "./voice-ai-client";
import type { VoiceIntent } from "./voice-types";

// Backward-compatible alias for older imports/tests. The app now routes voice AI
// through the backend AI proxy instead of any direct provider-specific client.
export async function askGroqIntent(command: string): Promise<VoiceIntent | null> {
  return askAiIntent(command);
}
