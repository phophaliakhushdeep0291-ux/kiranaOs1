import type { SpeechRecognitionConstructor, SpeechRecognitionEventLike, SpeechRecognitionLike, VoiceToastPayload } from "./voice-types";

type SpeechWindow = typeof window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export type VoiceRecognitionCallbacks = {
  onStart: () => void;
  onTranscript: (text: string) => void;
  onError: (message: string, toastVariant: VoiceToastPayload["variant"], errorCode?: string) => void;
  onEnd: () => void;
};

export const DUPLICATE_FINAL_TRANSCRIPT_DEBOUNCE_MS = 1500;

/**
 * Which language the mic listens in.
 *
 * This is not cosmetic. Web Speech decodes against ONE language model, so a shop
 * dictating Hindi into an en-IN recogniser gets English words that sound vaguely
 * similar — "do kilo chini" comes back as "do kilo cheney" — and no amount of
 * vocabulary in the parser can recover the sentence that was actually spoken.
 * The shop already told us which language it works in; the mic should use it.
 */
export function speechRecognitionLocale(language: string): string {
  if (language === "hi") return "hi-IN";
  if (language === "en") return "en-IN";
  try { return language && language !== "auto" ? new Intl.Locale(language).toString() : "en-IN"; }
  catch { return "en-IN"; }
}

export function getSpeechRecognitionConstructor() {
  // Embedded Chromium/WebViews can expose Web Speech without a speech service.
  if (typeof window === "undefined" || import.meta.env.VITE_NATIVE_APP) return undefined;
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
    return "Mic is blocked. Allow Microphone in your browser's site settings and your device's Privacy settings, then retry.";
  }
  if (error === "network") return "Chrome speech service is unavailable. Type the command manually.";
  if (error === "no-speech") return "No voice heard. Speak closer to the mic or type the command.";
  return `Mic error: ${error}`;
}

export function createOneShotRecognition(
  Recognition: SpeechRecognitionConstructor,
  callbacks: VoiceRecognitionCallbacks,
  locale = "en-IN",
): SpeechRecognitionLike {
  const recognition = new Recognition();
  let lastFinal: { key: string; at: number } | null = null;
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    callbacks.onEnd();
  };
  const originalStart = recognition.start.bind(recognition);
  const originalAbort = recognition.abort?.bind(recognition);
  const originalStop = recognition.stop?.bind(recognition);
  const expire = () => {
    if (ended) return;
    callbacks.onError("Microphone did not respond. Check microphone permission, then retry.", "destructive", "timeout");
    recognition.abort?.();
  };
  recognition.start = () => {
    timer = setTimeout(expire, 20_000);
    try { originalStart(); } catch (error) { finish(); throw error; }
  };
  recognition.abort = () => { finish(); originalAbort?.(); };
  recognition.stop = () => {
    if (ended) return;
    clearTimeout(timer);
    timer = setTimeout(finish, 3_000);
    originalStop?.();
  };

  recognition.lang = locale;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    if (ended) return;
    clearTimeout(timer);
    timer = setTimeout(() => recognition.stop(), 15_000);
    callbacks.onStart();
  };
  recognition.onresult = (event) => {
    if (ended) return;
    const text = collectFinalTranscript(event);
    if (!text) return;

    const now = Date.now();
    if (!shouldAcceptFinalTranscript(text, lastFinal, now)) return;

    lastFinal = { key: voiceTranscriptKey(text), at: now };
    callbacks.onTranscript(text);
  };
  recognition.onerror = (event) => {
    if (ended) return;
    const error = event.error ?? "unknown";
    callbacks.onError(voiceRecognitionErrorMessage(error), error === "no-speech" ? "default" : "destructive", error);
    finish();
  };
  recognition.onend = finish;

  return recognition;
}
