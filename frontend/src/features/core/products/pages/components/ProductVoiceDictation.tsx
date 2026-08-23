/**
 * Dictating a product into the open form, one question at a time.
 *
 * The floating assistant can already prepare a product from a spoken command,
 * but only if you know the command exists — nothing on this form said so, and a
 * shop that has never heard the magic words never finds the feature. This is the
 * same capability with a button on it.
 *
 * The loop is deliberately a conversation rather than one long dictation: say
 * everything you know, and it asks for whatever is still missing, one field at a
 * time, until the form would actually save. A turn that hears nothing ends the
 * session — an open mic behind a counter picks up the whole shop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Loader2, Mic, Square, Volume2, VolumeX } from "lucide-react";
import { useAppLanguage } from "@/features/core/settings/i18n";
import {
  createOneShotRecognition,
  getSpeechRecognitionConstructor,
  speechRecognitionLocale,
} from "@/features/core/voice/voice-recognition";
import type { SpeechRecognitionLike } from "@/features/core/voice/voice-types";
import {
  parseProductVoiceAnswer,
  parseSpokenProductFields,
  type ProductVoiceField,
  type ProductVoiceFields,
} from "@/features/core/products/product-voice-parser";
import {
  applyProductVoiceFields,
  nextProductVoiceField,
  PRODUCT_VOICE_PROMPT_KEYS,
  readVoiceControlWord,
} from "@/features/core/products/product-voice-session";
import type { ProductFormData } from "../product-form-state";

const SPEAK_PREFERENCE_KEY = "kirana:product-voice-speak";

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
 * The callback is what sequences the conversation: the mic must not open until
 * the app has stopped talking, or the recogniser transcribes our own question
 * and answers it with itself. It fires exactly once whether the utterance ends,
 * errors, or speech synthesis is missing entirely.
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

type ProductVoiceDictationProps = {
  form: UseFormReturn<ProductFormData>;
  /** Closing the panel has to end a running session, mic and all. */
  open: boolean;
  /** Spoken "save" goes through the form's own submit, PIN prompt and all. */
  onRequestSave: () => void;
};

export function ProductVoiceDictation({ form, open, onRequestSave }: ProductVoiceDictationProps) {
  const { t, language } = useAppLanguage();
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState<ProductVoiceField | null>(null);
  const [heard, setHeard] = useState("");
  const [note, setNote] = useState("");
  const [speakPrompts, setSpeakPrompts] = useState(readSpeakPreference);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const handledRef = useRef<Set<ProductVoiceField>>(new Set());
  const pendingRef = useRef<ProductVoiceField | null>(null);
  const heardThisTurnRef = useRef(false);
  const speakRef = useRef(speakPrompts);
  // The recognition callbacks are rebuilt every turn and would otherwise close over
  // the first render's handler.
  const handleUtteranceRef = useRef<(text: string) => void>(() => {});

  const Recognition = useMemo(() => getSpeechRecognitionConstructor(), []);
  const locale = speechRecognitionLocale(language);
  const supported = Boolean(Recognition);

  useEffect(() => {
    speakRef.current = speakPrompts;
  }, [speakPrompts]);

  const stopEverything = useCallback(() => {
    activeRef.current = false;
    pendingRef.current = null;
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setListening(false);
    setActive(false);
    setPending(null);
  }, []);

  useEffect(() => stopEverything, [stopEverything]);
  useEffect(() => {
    if (!open) stopEverything();
  }, [open, stopEverything]);

  /** Write everything voice understood into the form, and count what moved. */
  const applyFields = useCallback(
    (fields: ProductVoiceFields) => {
      const current = form.getValues();
      const merged = applyProductVoiceFields(current, fields);
      let changed = 0;
      (Object.keys(merged) as (keyof ProductFormData)[]).forEach((key) => {
        if (Object.is(merged[key], current[key])) return;
        form.setValue(key, merged[key] as never, { shouldDirty: true });
        changed += 1;
      });
      return changed;
    },
    [form],
  );

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
          if (errorCode === "not-allowed" || errorCode === "service-not-allowed") stopEverything();
        },
        onEnd: () => {
          setListening(false);
          recognitionRef.current = null;
          // Silence ends the conversation. Without this the mic would reopen for
          // ever, which behind a counter means recording the shop.
          if (activeRef.current && !heardThisTurnRef.current) stopEverything();
        },
      },
      locale,
    );

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setNote(t("products.voice.notUnderstood"));
      stopEverything();
    }
  }, [Recognition, locale, stopEverything, t]);

  /** Ask for one field — or close out when there is nothing left to ask. */
  const ask = useCallback(
    (field: ProductVoiceField | null) => {
      pendingRef.current = field;
      setPending(field);
      const line = field ? t(PRODUCT_VOICE_PROMPT_KEYS[field]) : t("products.voice.ready");
      if (!field) setNote(line);
      speakThen(line, locale, speakRef.current, () => {
        // Nothing more is needed, but the shop may still want to say the GST or a
        // barcode, so the mic stays open for one more turn and silence ends it.
        listen();
      });
    },
    [listen, locale, t],
  );

  const advance = useCallback(() => {
    if (!activeRef.current) return;
    ask(nextProductVoiceField(form.getValues(), handledRef.current));
  }, [ask, form]);

  const handleUtterance = useCallback(
    (text: string) => {
      if (!activeRef.current) return;
      setHeard(text);
      setNote("");

      const control = readVoiceControlWord(text);
      if (control === "stop") {
        stopEverything();
        return;
      }
      if (control === "save") {
        stopEverything();
        onRequestSave();
        return;
      }

      const field = pendingRef.current;
      if (control === "skip") {
        if (field) handledRef.current.add(field);
        advance();
        return;
      }

      // With a question on the table a bare "28" is that field's answer; with
      // none, the sentence has to name its own fields.
      const fields = field ? parseProductVoiceAnswer(field, text) : parseSpokenProductFields(text);
      const changed = Object.keys(fields).length ? applyFields(fields) : 0;
      if (!changed) {
        setNote(t("products.voice.notUnderstood"));
        ask(field);
        return;
      }

      setNote(t("products.voice.filled", { count: changed }));
      if (field) handledRef.current.add(field);
      advance();
    },
    [advance, applyFields, ask, onRequestSave, stopEverything, t],
  );

  useEffect(() => {
    handleUtteranceRef.current = handleUtterance;
  }, [handleUtterance]);

  const start = useCallback(() => {
    if (!supported) {
      setNote(t("products.voice.unsupported"));
      return;
    }
    handledRef.current = new Set();
    setHeard("");
    setNote(t("products.voice.hint"));
    setActive(true);
    activeRef.current = true;
    ask(nextProductVoiceField(form.getValues(), handledRef.current));
  }, [ask, form, supported, t]);

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

  if (!active) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-[#eef1f6] px-5 py-2.5">
        <button
          type="button"
          onClick={start}
          data-testid="product-voice-start"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--brand-softer)] px-3 text-[12px] font-black text-[var(--brand)] transition-colors hover:bg-[var(--brand-soft)] disabled:opacity-50"
          disabled={!supported}
        >
          <Mic size={14} />
          {t("products.voice.start")}
        </button>
        <p className="min-w-0 flex-1 truncate text-[11px] text-[#6d7c98]">
          {supported ? t("products.voice.hint") : t("products.voice.unsupported")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 border-b border-[var(--brand-border)] bg-[var(--brand-softer)] px-5 py-3"
      data-testid="product-voice-panel"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-white">
          {listening ? <Mic size={15} className="animate-pulse" /> : <Loader2 size={15} className="animate-spin" />}
        </span>
        <p className="min-w-0 flex-1 text-[13px] font-black leading-5 text-[var(--brand-ink)]">
          {pending ? t(PRODUCT_VOICE_PROMPT_KEYS[pending]) : t("products.voice.ready")}
        </p>
        <button
          type="button"
          onClick={toggleSpeak}
          aria-label={t("products.voice.speakToggle")}
          aria-pressed={speakPrompts}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-white/70"
        >
          {speakPrompts ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        <button
          type="button"
          onClick={stopEverything}
          data-testid="product-voice-stop"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[12px] font-black text-[#536383] transition-colors hover:bg-[#f1f4f8]"
        >
          <Square size={12} />
          {t("products.voice.stop")}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-[#52627e]">
        {listening ? t("products.voice.listening") : t("products.voice.starting")}
        {heard ? ` · ${t("products.voice.heard", { text: heard })}` : ""}
      </p>
      {note ? <p className="mt-0.5 text-[11px] leading-4 text-[#6d7c98]">{note}</p> : null}
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b98ad]">
        {t("products.voice.controls")}
      </p>
    </div>
  );
}
