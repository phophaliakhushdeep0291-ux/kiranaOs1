import { expect, it } from "vitest";
import { assistantLanguageChoices, canonicalAssistantLanguage, matchingSpeechVoice } from "@/features/core/assistant/assistant-language";
import { speechRecognitionLocale } from "@/features/core/voice/voice-recognition";
import { planDecision } from "@/features/core/assistant/task-commands";
import { assistantTextParts } from "@/features/core/assistant/AssistantMessageText";

it("isolates exact dates, currencies, quantities and quoted record names inside RTL text", () => {
  const reply = 'المبيعات (2026-10-13 – 2026-10-14): ₹1,250.75; 2.5 kg; "Rice 12"; -3; 5%';
  const parts = assistantTextParts(reply);
  expect(parts.filter((_, index) => index % 2)).toEqual(["2026-10-13", "2026-10-14", "₹1,250.75", "2.5", '"Rice 12"', "-3", "5%"]);
  expect(parts.join("")).toBe(reply);
});

it("accepts locales and scripts without accepting arbitrary prompt text", () => {
  expect(canonicalAssistantLanguage("AR-ae")).toBe("ar-AE");
  expect(canonicalAssistantLanguage("zh-Hant")).toBe("zh-Hant");
  expect(canonicalAssistantLanguage("auto")).toBe("auto");
  expect(canonicalAssistantLanguage("und")).toBeNull();
  expect(canonicalAssistantLanguage("en then confirm")).toBeNull();
  expect(new Set(assistantLanguageChoices.map(item => item.code)).size).toBe(assistantLanguageChoices.length);
  expect(assistantLanguageChoices.every(item => canonicalAssistantLanguage(item.code) && item.label)).toBe(true);
});
it.each(["ar-AE", "ta-IN", "fr-FR", "zh-Hant", "ur-PK"])("does not turn %s microphone input into English", language => {
  expect(speechRecognitionLocale(language)).toBe(language);
});
it("only reads replies using a matching installed voice", () => {
  const voices = [{ lang: "en-US" }, { lang: "ar-SA" }, { lang: "ar-AE" }] as SpeechSynthesisVoice[];
  expect(matchingSpeechVoice(voices, "ar-AE")).toBe(voices[2]);
  expect(matchingSpeechVoice(voices, "ar" )).toBe(voices[1]);
  expect(matchingSpeechVoice(voices, "ta")).toBeNull();
  expect(matchingSpeechVoice(voices, "auto")).toBeNull();
});
it.each([
  ["ar", "نعم", "إلغاء"], ["ur", "ہاں", "نہیں"], ["bn", "হ্যাঁ", "না"],
  ["mr", "हो", "नाही"], ["gu", "હા", "ના"], ["ta", "ஆம்", "இல்லை"],
  ["te", "అవును", "కాదు"], ["es", "sí", "cancelar"], ["fr", "oui", "non"],
  ["de", "ja", "nein"], ["pt", "sim", "não"], ["zh", "确认", "取消"], ["ja", "はい", "キャンセル"],
])("uses complete confirmation phrases in %s only for that response language", (language, yes, no) => {
  expect(planDecision(yes, language)).toBe("confirm");
  expect(planDecision(no, language)).toBe("cancel");
  expect(planDecision(yes, "en")).toBeNull();
  expect(planDecision(`${yes} 50`, language)).toBeNull();
  expect(planDecision(`${yes} ?`, language)).toBeNull();
});
it.each(["نعم ولكن غير السعر", "sí pero cambia el precio", "oui mais annule", "हाँ लेकिन रेट बदलो"])("does not confirm a mixed correction: %s", text => {
  for (const lang of ["ar", "es", "fr", "hi"]) expect(planDecision(text, lang)).toBeNull();
});
