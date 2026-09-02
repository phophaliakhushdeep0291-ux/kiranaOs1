/**
 * Dictating a product into the open form, one question at a time.
 *
 * The floating assistant can already prepare a product from a spoken command,
 * but only if you know the command exists — nothing on this form said so, and a
 * shop that has never heard the magic words never finds the feature. This is the
 * same capability with a button on it.
 *
 * The turn-taking, the mic and the spoken prompts are shared with the customer
 * form (use-voice-dictation.ts); everything here is the product vocabulary.
 */
import { useCallback } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useVoiceDictation } from "@/features/core/voice/use-voice-dictation";
import { VoiceDictationBar } from "@/features/core/voice/VoiceDictationBar";
import {
  parseProductVoiceAnswer,
  parseSpokenProductFields,
  type ProductVoiceField,
  type ProductVoiceFields,
} from "@/features/core/products/product-voice-parser";
import {
  applyProductVoiceFields,
  nextProductVoiceField,
  PRODUCT_VOICE_DISPLAY_KEYS,
  PRODUCT_VOICE_PROMPT_KEYS,
} from "@/features/core/products/product-voice-session";
import type { ProductFormData } from "../product-form-state";

type ProductVoiceDictationProps = {
  form: UseFormReturn<ProductFormData>;
  open: boolean;
  onRequestSave: () => void;
};

export function ProductVoiceDictation({ form, open, onRequestSave }: ProductVoiceDictationProps) {
  const { t, language } = useAppLanguage();

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

  const applyAnswer = useCallback(
    (field: ProductVoiceField | null, spoken: string) => {
      // With a question on the table a bare "28" is that field's answer; with
      // none, the sentence has to name its own fields.
      const fields = field ? parseProductVoiceAnswer(field, spoken) : parseSpokenProductFields(spoken);
      return Object.keys(fields).length ? applyFields(fields) : 0;
    },
    [applyFields],
  );

  const nextField = useCallback(
    (handled: ReadonlySet<ProductVoiceField>) => nextProductVoiceField(form.getValues(), handled),
    [form],
  );

  const dictation = useVoiceDictation<ProductVoiceField>({
    open,
    language,
    // Spoken in the app's own language; shown in Hinglish. See
    // PRODUCT_VOICE_DISPLAY_KEYS.
    promptFor: (field) => t(PRODUCT_VOICE_PROMPT_KEYS[field]),
    readyPrompt: t("products.voice.ready"),
    readyNote: t("products.voice.sayReady"),
    notUnderstoodPrompt: t("products.voice.notUnderstood"),
    nextField,
    applyAnswer,
    onSave: onRequestSave,
    filledNote: (count) => t("products.voice.filled", { count }),
  });

  return (
    <VoiceDictationBar
      testId="product-voice"
      labels={{
        start: t("products.voice.start"),
        hint: t("products.voice.hint"),
        unsupported: t("products.voice.unsupported"),
        listening: t("products.voice.listening"),
        starting: t("products.voice.starting"),
        heard: (text) => t("products.voice.heard", { text }),
        controls: t("products.voice.controls"),
        stop: t("products.voice.stop"),
        speakToggle: t("products.voice.speakToggle"),
      }}
      supported={dictation.supported}
      active={dictation.active}
      listening={dictation.listening}
      heard={dictation.heard}
      note={dictation.note}
      speakPrompts={dictation.speakPrompts}
      prompt={dictation.pending ? t(PRODUCT_VOICE_DISPLAY_KEYS[dictation.pending]) : t("products.voice.sayReady")}
      onStart={dictation.start}
      onStop={dictation.stop}
      onToggleSpeak={dictation.toggleSpeak}
    />
  );
}
