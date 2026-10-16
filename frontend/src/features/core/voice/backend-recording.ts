import { requestAiAudioTranscription } from "@/lib/ai/ai-client";
import { BACKEND_RECORDING_MAX_MS, backendTranscriptionErrorMessage, chooseRecorderMimeType, requestMicrophone, type BackendTranscriptionCallbacks, type BackendTranscriptionSession } from "./backend-transcription";
let microphoneBusy = false;

export async function recordAndTranscribe(callbacks: BackendTranscriptionCallbacks, maxDurationMs = BACKEND_RECORDING_MAX_MS, language?: string, signal?: AbortSignal): Promise<BackendTranscriptionSession> {
  if (microphoneBusy) throw new Error("A voice session is already open. Stop it before starting another.");
  microphoneBusy = true;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let cancelled = false, ended = false, tracksStopped = false;
  let autoStopTimer: ReturnType<typeof setTimeout> | undefined;
  let monitor: ReturnType<typeof import("./microphone-monitor").monitorMicrophone> | undefined;
  const upload = new AbortController();
  const stopTracks = () => { monitor?.stop(); if (!tracksStopped) { tracksStopped = true; stream?.getTracks().forEach(track => track.stop()); } };
  const endOnce = () => {
    if (ended) return;
    ended = true; microphoneBusy = false;
    clearTimeout(autoStopTimer);
    signal?.removeEventListener("abort", cancel);
    stopTracks(); callbacks.onEnd();
  };
  const stop = () => { if (recorder && recorder.state !== "inactive") recorder.stop(); };
  const cancel = () => { cancelled = true; upload.abort(); try { stop(); } finally { endOnce(); } };
  try {
    stream = await requestMicrophone(signal);
    if (signal?.aborted) throw new DOMException("Recording cancelled", "AbortError");
    const mimeType = chooseRecorderMimeType();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const audioRecorder = recorder;
    const chunks: BlobPart[] = [];
    audioRecorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
    audioRecorder.onerror = () => {
      callbacks.onError("Audio recording failed. Check the selected microphone and retry.");
      cancel();
    };
    audioRecorder.onstop = async () => {
      clearTimeout(autoStopTimer); stopTracks();
      if (cancelled) { endOnce(); return; }
      if (monitor?.isSilent()) { callbacks.onError("No sound reached this microphone. Choose a different microphone and check the input level while speaking."); endOnce(); return; }
      const audio = new Blob(chunks, { type: audioRecorder.mimeType || mimeType || "audio/webm" });
      if (!audio.size) { callbacks.onError("No audio was captured. Speak closer to the microphone or type the command."); endOnce(); return; }
      callbacks.onTranscribing();
      try {
        const result = await requestAiAudioTranscription(audio, { language, signal: upload.signal });
        if (!cancelled) callbacks.onTranscript(result);
      } catch (error) { if (!cancelled) callbacks.onError(backendTranscriptionErrorMessage(error)); }
      finally { endOnce(); }
    };
    signal?.addEventListener("abort", cancel, { once: true });
    audioRecorder.start(250);
    const recordingStream = stream;
    // The meter is optional cloud-recording UI, not an offline-counter dependency.
    // A cancelled recording must not acquire an audio graph after this loads.
    void import("./microphone-monitor").then(({ monitorMicrophone }) => {
      if (!ended && !cancelled && audioRecorder.state === "recording") monitor = monitorMicrophone(recordingStream, callbacks.onInput);
    }).catch(() => {});
    autoStopTimer = setTimeout(stop, Math.max(1_000, Math.min(maxDurationMs, BACKEND_RECORDING_MAX_MS)));
    callbacks.onStart();
    return { stop, cancel };
  } catch (error) {
    cancelled = true; upload.abort();
    try { stop(); } finally { endOnce(); }
    throw error;
  }
}
