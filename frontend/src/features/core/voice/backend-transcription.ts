import { ApiClientError } from "@/lib/api/http";
import { type AudioTranscriptionResult } from "@/lib/ai/ai-client";
import { selectedMicrophone, type MicrophoneFeedback } from "./microphone-input";

export const BACKEND_RECORDING_MAX_MS = 15_000;
export const MICROPHONE_PERMISSION_TIMEOUT_MS = 20_000;
const RECORDER_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;
export type BackendTranscriptionSession = { stop: () => void; cancel: () => void };
export type BackendTranscriptionCallbacks = {
  onStart: () => void; onTranscribing: () => void;
  onTranscript: (result: AudioTranscriptionResult) => void;
  onError: (message: string) => void; onEnd: () => void;
  onInput?: (input: MicrophoneFeedback) => void;
};
export function chooseRecorderMimeType(supports: (mimeType: string) => boolean = mime => MediaRecorder.isTypeSupported(mime)) {
  return RECORDER_MIME_TYPES.find(supports) ?? "";
}
export function backendTranscriptionErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.data.code === "AI_TRANSCRIPTION_EMPTY") return "No speech was heard. Choose the correct microphone, check its input level, and try again.";
    if (error.data.code === "AI_KEY_MISSING") return "Cloud transcription is not configured on this server. Type the command or ask the owner to configure an AI provider.";
    if (error.data.code === "AI_RATE_LIMITED") return "Cloud transcription is busy. Wait a moment or type the command.";
    if (error.data.code === "AI_QUOTA_EXCEEDED") return "Cloud transcription quota is unavailable. Type the command while the owner checks provider billing.";
    if (error.status === 401) return "Your session expired before transcription. Sign in again and retry.";
  }
  if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) return "Microphone access is blocked. Allow it in this app or browser and in your device's Privacy settings, then retry.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone was found. Select an input device in your system settings.";
  if (error instanceof DOMException && error.name === "OverconstrainedError") return "The selected microphone is disconnected. Choose another microphone or the system default, then retry.";
  if (error instanceof DOMException && error.name === "NotReadableError") return "The microphone is busy or unavailable. Close the other recording app and retry.";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "Cloud transcription needs a connection. Type the command while offline.";
  return error instanceof Error && error.message ? error.message : "Voice could not be transcribed. Type the command or retry.";
}
export function canRecordAudio() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}
function assertBackendRecordingAvailable() {
  if (typeof window === "undefined" || typeof navigator === "undefined") throw new Error("Open the app to record a voice command.");
  if (!window.isSecureContext) throw new Error("Microphone access needs HTTPS or the installed app. An insecure network address cannot record audio.");
  if (!canRecordAudio()) throw new Error("Audio recording is unavailable here. Open the installed app or a supported browser, or type your command.");
  if (navigator.onLine === false) throw new Error("Cloud transcription needs a connection. Type the command while offline.");
}
/** Bound a permission prompt without leaking a stream if the user accepts it later. */
export async function requestMicrophone(signal?: AbortSignal, deviceId = selectedMicrophone()): Promise<MediaStream> {
  if (signal?.aborted) throw new DOMException("Recording cancelled", "AbortError");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, stream?: MediaStream) => {
      if (settled) { stream?.getTracks().forEach(track => track.stop()); return; }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(stream!);
    };
    const abort = () => finish(new DOMException("Recording cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Microphone permission is still waiting. Allow access in the permission prompt, then press Speak again.")), MICROPHONE_PERMISSION_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    try { navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true }).then(stream => finish(undefined, stream), error => finish(error)); }
    catch (error) { finish(error as Error); }
  });
}
export async function startBackendTranscription(callbacks: BackendTranscriptionCallbacks, maxDurationMs = BACKEND_RECORDING_MAX_MS, language?: string, signal?: AbortSignal): Promise<BackendTranscriptionSession> {
  assertBackendRecordingAvailable();
  // Cloud capture cannot run offline. Fetch its recorder only when requested;
  // installed packages still contain the whole module for local loading.
  const { recordAndTranscribe } = await import("./backend-recording");
  if (signal?.aborted) throw new DOMException("Recording cancelled", "AbortError");
  return recordAndTranscribe(callbacks, maxDurationMs, language, signal);
}
