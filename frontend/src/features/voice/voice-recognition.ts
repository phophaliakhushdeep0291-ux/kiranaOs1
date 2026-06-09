import type { SpeechRecognitionConstructor, SpeechRecognitionEventLike, SpeechRecognitionLike, VoiceToastPayload } from "./voice-types";

type SpeechWindow = typeof window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export type VoiceRecognitionCallbacks = {
  onStart: () => void;
  onTranscript: (text: string) => void;
  onError: (message: string, toastVariant: VoiceToastPayload["variant"]) => void;
  onEnd: () => void;
};

export const DUPLICATE_FINAL_TRANSCRIPT_DEBOUNCE_MS = 1500;

export function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return undefined;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

export function normalizeVoiceTranscript(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function voiceTranscriptKey(text: string) {
  return normalizeVoiceTranscript(text).toLocaleLowerCase("en-IN");
}

function isRepeatedPhrase(candidate: string, previous: string) {
  const candidateKey = voiceTranscriptKey(candidate);
  const previousKey = voiceTranscriptKey(previous);
  return Boolean(candidateKey && candidateKey === previousKey);
}

export function collectFinalTranscript(event: SpeechRecognitionEventLike) {
  const uniqueFinalTexts: string[] = [];
  const seenFinalKeys = new Set<string>();

  for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result || result.isFinal === false) continue;

    const transcript = normalizeVoiceTranscript(result[0]?.transcript ?? "");
    if (!transcript) continue;

    const key = voiceTranscriptKey(transcript);
    if (seenFinalKeys.has(key)) continue;

    const previous = uniqueFinalTexts[uniqueFinalTexts.length - 1];
    if (previous && isRepeatedPhrase(transcript, previous)) continue;

    seenFinalKeys.add(key);
    uniqueFinalTexts.push(transcript);
  }

  return normalizeVoiceTranscript(uniqueFinalTexts.join(" "));
}

export function shouldAcceptFinalTranscript(
  text: string,
  lastFinal: { key: string; at: number } | null,
  now = Date.now(),
  debounceMs = DUPLICATE_FINAL_TRANSCRIPT_DEBOUNCE_MS,
) {
  const key = voiceTranscriptKey(text);
  if (!key) return false;
  if (!lastFinal) return true;
  return !(lastFinal.key === key && now - lastFinal.at < debounceMs);
}

export function voiceRecognitionErrorMessage(error: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Mic is blocked. Click the site controls icon near localhost, allow Microphone, refresh, then try again.";
  }
  if (error === "network") return "Chrome speech service is unavailable. Type the command manually.";
  if (error === "no-speech") return "No voice heard. Speak closer to the mic or type the command.";
  return `Mic error: ${error}`;
}

export function createOneShotRecognition(Recognition: SpeechRecognitionConstructor, callbacks: VoiceRecognitionCallbacks): SpeechRecognitionLike {
  const recognition = new Recognition();
  let lastFinal: { key: string; at: number } | null = null;

  recognition.lang = "en-IN";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = callbacks.onStart;
  recognition.onresult = (event) => {
    const text = collectFinalTranscript(event);
    if (!text) return;

    const now = Date.now();
    if (!shouldAcceptFinalTranscript(text, lastFinal, now)) return;

    lastFinal = { key: voiceTranscriptKey(text), at: now };
    callbacks.onTranscript(text);
  };
  recognition.onerror = (event) => {
    const error = event.error ?? "unknown";
    callbacks.onError(voiceRecognitionErrorMessage(error), error === "no-speech" ? "default" : "destructive");
  };
  recognition.onend = callbacks.onEnd;

  return recognition;
}
