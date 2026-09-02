/**
 * The conversation half of dictating a record into an open form.
 *
 * Products and customers ask for different things, but the turn-taking is
 * identical: read a question aloud, open the mic once the app has stopped
 * talking, apply whatever came back, ask for whatever is still missing. That
 * loop — and its two non-obvious safety rules — lives here so there is one copy
 * of it rather than one per form.
 *
 * The two rules worth stating:
 *
 *   The mic must not open while the app is speaking, or the recogniser
 *   transcribes our own question and answers it with itself.
 *
 *   A turn that hears nothing ends the session. Without that the mic reopens for
 *   ever, which behind a counter means recording the shop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createOneShotRecognition,
  getSpeechRecognitionConstructor,
  speechRecognitionLocale,
} from "./voice-recognition";
import type { SpeechRecognitionLike } from "./voice-types";
import { normalizeSpokenText } from "./voice-text";

const SPEAK_PREFERENCE_KEY = "kirana:voice-dictation-speak";

export type VoiceDictationControl = "skip" | "stop" | "save" | "none";

const SKIP_WORDS = new Set([
  "skip",
  "next",
  "pass",
  "chhodo",
  "chodo",
  "aage",
  "छोड़ो",
  "छोड़",
  "आगे",
  "अगला",
]);

const STOP_WORDS = new Set(["stop", "cancel", "quit", "band", "bas", "बस", "रुको", "बंद", "रोको"]);

const SAVE_WORDS = new Set(["save", "done", "finish", "ok", "theek", "sahi", "सेव", "बचाओ", "ठीक"]);

/**
 * Whether a reply is a command about the conversation rather than an answer to it.
 *
 * Checked on the WHOLE utterance, not on any word inside it: "save" appearing in
 * "sarson ka tel save" is part of a sentence, while "save" alone is an
 * instruction. Anything longer than the command itself is treated as an answer,
 * which is the safe direction to be wrong in — a misread answer is visible and
 * editable, a misread "stop" ends the session and loses the thread.
 */
export function readVoiceControlWord(spoken: string): VoiceDictationControl {
  const text = normalizeSpokenText(spoken);
  if (!text) return "none";
  if (SKIP_WORDS.has(text)) return "skip";
  if (STOP_WORDS.has(text)) return "stop";
  if (SAVE_WORDS.has(text)) return "save";
  return "none";
}

function readSpeakPreference() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SPEAK_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Read the question aloud, then hand back control.
 *
 * The callback is what sequences the conversation. It fires exactly once whether
 * the utterance ends, errors, or speech synthesis is missing entirely.
 */
function speakThen(text: string, locale: string, enabled: boolean, done: () => void) {
  const synth = typeof window === "undefined" ? undefined : window.speechSynthesis;
  if (!enabled || !synth || typeof SpeechSynthesisUtterance === "undefined") {
    done();
    return;
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done();
  };
  try {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    utterance.onend = finish;
    utterance.onerror = finish;
    synth.speak(utterance);
    // Some builds never fire onend for a cancelled utterance; the shop should not
    // be left with a dead mic because of it.
    window.setTimeout(finish, 6000);
  } catch {
    finish();
  }
}

export type VoiceDictationOptions<TField extends string> = {
  /** Closing the panel has to end a running session, mic and all. */
  open: boolean;
  language: string;
  /** The question for one field, already translated. */
  promptFor: (field: TField) => string;
  /** Said when nothing is left worth asking. */
  readyPrompt: string;
  /**
   * The same closing line as the counter READS it, when that is not the line
   * that gets spoken. A Hindi shop is asked in Hinglish, because that is what
   * it reads fastest, and spoken to in Devanagari, because that is what a hi-IN
   * voice pronounces. Left out, the spoken line is shown as well.
   */
  readyNote?: string;
  notUnderstoodPrompt: string;
  /** What to ask next given the fields this session has already put to the shop. */
  nextField: (handled: ReadonlySet<TField>) => TField | null;
  /**
   * Apply one reply to the form and report how many fields actually moved.
   * A zero means it was not understood, and the same question is asked again.
   */
  applyAnswer: (field: TField | null, spoken: string) => number;
  /** Spoken "save" goes through the form's own submit, validation and all. */
  onSave: () => void;
  /** Note shown after a reply lands, e.g. "3 details filled by voice." */
  filledNote?: (count: number) => string;
};

export type VoiceDictationState<TField extends string> = {
  supported: boolean;
  active: boolean;
  listening: boolean;
  pending: TField | null;
  heard: string;
  note: string;
  speakPrompts: boolean;
  start: () => void;
  stop: () => void;
  toggleSpeak: () => void;
};

export function useVoiceDictation<TField extends string>(
  options: VoiceDictationOptions<TField>,
): VoiceDictationState<TField> {
  const { open, language, promptFor, readyPrompt, readyNote, notUnderstoodPrompt, nextField, applyAnswer, onSave, filledNote } =
    options;

  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState<TField | null>(null);
  const [heard, setHeard] = useState("");
  const [note, setNote] = useState("");
  const [speakPrompts, setSpeakPrompts] = useState(readSpeakPreference);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const handledRef = useRef<Set<TField>>(new Set());
  const pendingRef = useRef<TField | null>(null);
  const heardThisTurnRef = useRef(false);
  const speakRef = useRef(speakPrompts);
  // The recognition callbacks are rebuilt every turn and would otherwise close
  // over the first render's handler.
  const handleUtteranceRef = useRef<(text: string) => void>(() => {});

  const Recognition = useMemo(() => getSpeechRecognitionConstructor(), []);
  const locale = speechRecognitionLocale(language);
  const supported = Boolean(Recognition);

  useEffect(() => {
    speakRef.current = speakPrompts;
  }, [speakPrompts]);

  const stop = useCallback(() => {
    activeRef.current = false;
    pendingRef.current = null;
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setListening(false);
    setActive(false);
    setPending(null);
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  const listen = useCallback(() => {
    if (!Recognition || !activeRef.current) return;
    heardThisTurnRef.current = false;

    const recognition = createOneShotRecognition(
      Recognition,
      {
        onStart: () => setListening(true),
        onTranscript: (text) => {
          heardThisTurnRef.current = true;
          handleUtteranceRef.current(text);
        },
        onError: (message, _variant, errorCode) => {
          setNote(message);
          // A blocked mic will not un-block by asking again; anything else is
          // worth one more turn, which onEnd will start.
          if (errorCode === "not-allowed" || errorCode === "service-not-allowed") stop();
        },
        onEnd: () => {
          setListening(false);
          recognitionRef.current = null;
          if (activeRef.current && !heardThisTurnRef.current) stop();
        },
      },
      locale,
    );

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setNote(notUnderstoodPrompt);
      stop();
    }
  }, [Recognition, locale, notUnderstoodPrompt, stop]);

  const ask = useCallback(
    (field: TField | null) => {
      pendingRef.current = field;
      setPending(field);
      const line = field ? promptFor(field) : readyPrompt;
      if (!field) setNote(readyNote ?? line);
      // Nothing more is needed, but the shop may still want to add a detail, so
      // the mic stays open for one more turn and silence ends it.
      speakThen(line, locale, speakRef.current, listen);
    },
    [listen, locale, promptFor, readyNote, readyPrompt],
  );

  const handleUtterance = useCallback(
    (text: string) => {
      if (!activeRef.current) return;
      setHeard(text);
      setNote("");

      const control = readVoiceControlWord(text);
      if (control === "stop") {
        stop();
        return;
      }
      if (control === "save") {
        stop();
        onSave();
        return;
      }

      const field = pendingRef.current;
      if (control === "skip") {
        if (field) handledRef.current.add(field);
        ask(nextField(handledRef.current));
        return;
      }

      const changed = applyAnswer(field, text);
      if (!changed) {
        setNote(notUnderstoodPrompt);
        ask(field);
        return;
      }

      if (filledNote) setNote(filledNote(changed));
      if (field) handledRef.current.add(field);
      ask(nextField(handledRef.current));
    },
    [applyAnswer, ask, filledNote, nextField, notUnderstoodPrompt, onSave, stop],
  );

  useEffect(() => {
    handleUtteranceRef.current = handleUtterance;
  }, [handleUtterance]);

  const start = useCallback(() => {
    if (!supported) return;
    handledRef.current = new Set();
    setHeard("");
    setActive(true);
    activeRef.current = true;
    ask(nextField(handledRef.current));
  }, [ask, nextField, supported]);

  const toggleSpeak = useCallback(() => {
    setSpeakPrompts((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(SPEAK_PREFERENCE_KEY, next ? "on" : "off");
      } catch {
        // A spoken-prompt preference is not worth failing the form over.
      }
      if (!next && typeof window !== "undefined") window.speechSynthesis?.cancel();
      return next;
    });
  }, []);

  return { supported, active, listening, pending, heard, note, speakPrompts, start, stop, toggleSpeak };
}
