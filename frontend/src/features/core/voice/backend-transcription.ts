import { ApiClientError } from "@/lib/api/http";
import { requestAiAudioTranscription, type AudioTranscriptionResult } from "@/lib/ai/ai-client";

export const BACKEND_RECORDING_MAX_MS = 15_000;

const RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export type BackendTranscriptionSession = {
  stop: () => void;
  cancel: () => void;
};

export type BackendTranscriptionCallbacks = {
  onStart: () => void;
  onTranscribing: () => void;
  onTranscript: (result: AudioTranscriptionResult) => void;
  onError: (message: string) => void;
  onEnd: () => void;
};

export function chooseRecorderMimeType(
  supports: (mimeType: string) => boolean = (mimeType) => MediaRecorder.isTypeSupported(mimeType),
) {
  return RECORDER_MIME_TYPES.find(supports) ?? "";
}

export function backendTranscriptionErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.data.code === "AI_KEY_MISSING") return "Cloud transcription is not configured on this server. Type the command or ask the owner to configure an AI provider.";
    if (error.data.code === "AI_RATE_LIMITED") return "Cloud transcription is busy. Wait a moment or type the command.";
    if (error.data.code === "AI_QUOTA_EXCEEDED") return "Cloud transcription quota is unavailable. Type the command while the owner checks provider billing.";
    if (error.status === 401) return "Your session expired before transcription. Sign in again and retry.";
  }
  if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) {
    return "Microphone is blocked. Allow microphone access from the browser lock icon and retry.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone is selected in the browser or operating-system input settings.";
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "Cloud transcription needs a connection. Type the command while offline.";
  }
  return error instanceof Error && error.message
    ? error.message
    : "Voice could not be transcribed. Type the command or retry.";
}

function assertBackendRecordingAvailable() {
  if (typeof window === "undefined" || typeof navigator === "undefined") throw new Error("Voice recording is available only in the app browser.");
  const isLocalhost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
  if (!window.isSecureContext && !isLocalhost) throw new Error("Microphone recording requires HTTPS or localhost.");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot request microphone access.");
  if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record audio for cloud transcription.");
}

export async function startBackendTranscription(
  callbacks: BackendTranscriptionCallbacks,
  maxDurationMs = BACKEND_RECORDING_MAX_MS,
): Promise<BackendTranscriptionSession> {
  assertBackendRecordingAvailable();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = chooseRecorderMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  let cancelled = false;
  let ended = false;
  let autoStopTimer: number | undefined;

  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
  const endOnce = () => {
    if (ended) return;
    ended = true;
    callbacks.onEnd();
  };
  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  const cancel = () => {
    cancelled = true;
    if (autoStopTimer) window.clearTimeout(autoStopTimer);
    stop();
    stopTracks();
    if (recorder.state === "inactive") endOnce();
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onerror = () => {
    callbacks.onError("The browser audio recorder failed. Check microphone access or type the command.");
  };
  recorder.onstop = async () => {
    if (autoStopTimer) window.clearTimeout(autoStopTimer);
    stopTracks();
    if (cancelled) {
      endOnce();
      return;
    }

    const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
    if (audio.size === 0) {
      callbacks.onError("No audio was captured. Speak closer to the microphone or type the command.");
      endOnce();
      return;
    }

    callbacks.onTranscribing();
    try {
      const result = await requestAiAudioTranscription(audio);
      callbacks.onTranscript(result);
    } catch (error) {
      callbacks.onError(backendTranscriptionErrorMessage(error));
    } finally {
      endOnce();
    }
  };

  recorder.start(250);
  callbacks.onStart();
  autoStopTimer = window.setTimeout(stop, Math.max(1_000, Math.min(maxDurationMs, BACKEND_RECORDING_MAX_MS)));

  return { stop, cancel };
}
