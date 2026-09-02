/**
 * Dictating a customer into the open form, one question at a time.
 *
 * The twin of the product form's bar, and for the same reason: the floating
 * assistant can already prepare a customer from a spoken command, but a shop
 * that has never heard the magic words never finds it. This puts a button on it,
 * on the form where a new customer is actually written down — usually with the
 * person still standing at the counter, which is exactly when typing is slowest.
 *
 * The turn-taking, the mic and the spoken prompts are shared with the product
 * form (use-voice-dictation.ts); everything here is the customer vocabulary.
 */
import { useCallback, useEffect, useRef } from "react";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useVoiceDictation } from "@/features/core/voice/use-voice-dictation";
import { VoiceDictationBar } from "@/features/core/voice/VoiceDictationBar";
import {
  parseCustomerVoiceAnswer,
  parseSpokenCustomerFields,
  type CustomerVoiceField,
  type CustomerVoiceFields,
} from "../../customer-voice-parser";
import {
  applyCustomerVoiceFields,
  nextCustomerVoiceField,
  CUSTOMER_VOICE_DISPLAY_KEYS,
  CUSTOMER_VOICE_PROMPT_KEYS,
  type CustomerVoiceFormValues,
} from "../../customer-voice-session";

type CustomerVoiceDictationProps = {
  values: CustomerVoiceFormValues;
  onChange: (next: CustomerVoiceFormValues) => void;
  open: boolean;
  onRequestSave: () => void;
};

export function CustomerVoiceDictation({ values, onChange, open, onRequestSave }: CustomerVoiceDictationProps) {
  const { t, language } = useAppLanguage();

  /**
   * The form as it stands right now, readable synchronously.
   *
   * A single turn writes an answer and then immediately asks what is still
   * missing. React state has not re-rendered in between, so asking the props
   * would ask the form as it was BEFORE the answer landed and repeat the
   * question that was just answered. The ref is what `form.getValues()` is to
   * the product form: kept current by the write itself, and re-synced from
   * props so typing into the form by hand is seen too.
   */
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  /** Write everything voice understood into the form, and count what moved. */
  const applyFields = useCallback(
    (fields: CustomerVoiceFields) => {
      const current = valuesRef.current;
      const merged = applyCustomerVoiceFields(current, fields);
      const changed = (Object.keys(merged) as (keyof CustomerVoiceFormValues)[]).filter(
        (key) => !Object.is(merged[key], current[key]),
      ).length;
      if (!changed) return 0;
      valuesRef.current = merged;
      onChange(merged);
      return changed;
    },
    [onChange],
  );

  const applyAnswer = useCallback(
    (field: CustomerVoiceField | null, spoken: string) => {
      // With a question on the table a bare "9876543210" is that field's answer;
      // with none, the sentence has to name its own fields.
      const fields = field ? parseCustomerVoiceAnswer(field, spoken) : parseSpokenCustomerFields(spoken);
      return Object.keys(fields).length ? applyFields(fields) : 0;
    },
    [applyFields],
  );

  const nextField = useCallback(
    (handled: ReadonlySet<CustomerVoiceField>) => nextCustomerVoiceField(valuesRef.current, handled),
    [],
  );

  const dictation = useVoiceDictation<CustomerVoiceField>({
    open,
    language,
    // Spoken in the app's own language; shown in Hinglish. See
    // CUSTOMER_VOICE_DISPLAY_KEYS.
    promptFor: (field) => t(CUSTOMER_VOICE_PROMPT_KEYS[field]),
    readyPrompt: t("customers.voice.ready"),
    readyNote: t("customers.voice.sayReady"),
    notUnderstoodPrompt: t("customers.voice.notUnderstood"),
    nextField,
    applyAnswer,
    onSave: onRequestSave,
    filledNote: (count) => t("customers.voice.filled", { count }),
  });

  return (
    <VoiceDictationBar
      testId="customer-voice"
      labels={{
        start: t("customers.voice.start"),
        hint: t("customers.voice.hint"),
        unsupported: t("customers.voice.unsupported"),
        listening: t("customers.voice.listening"),
        starting: t("customers.voice.starting"),
        heard: (text) => t("customers.voice.heard", { text }),
        controls: t("customers.voice.controls"),
        stop: t("customers.voice.stop"),
        speakToggle: t("customers.voice.speakToggle"),
      }}
      supported={dictation.supported}
      active={dictation.active}
      listening={dictation.listening}
      heard={dictation.heard}
      note={dictation.note}
      speakPrompts={dictation.speakPrompts}
      prompt={dictation.pending ? t(CUSTOMER_VOICE_DISPLAY_KEYS[dictation.pending]) : t("customers.voice.sayReady")}
      onStart={dictation.start}
      onStop={dictation.stop}
      onToggleSpeak={dictation.toggleSpeak}
    />
  );
}
