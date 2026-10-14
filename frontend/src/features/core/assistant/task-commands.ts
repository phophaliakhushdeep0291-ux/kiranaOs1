// Only a complete, unambiguous answer can approve the displayed plan. A phrase
// such as "yes but change it" must go back through clarification and a new plan.
const decisions: Record<string, { confirm: string[]; cancel: string[] }> = {
  ar: { confirm: ["نعم", "تأكيد", "نعم نفذ"], cancel: ["لا", "إلغاء", "الغاء", "لا تنفذ"] },
  ur: { confirm: ["ہاں", "تصدیق کریں"], cancel: ["نہیں", "منسوخ کریں"] },
  bn: { confirm: ["হ্যাঁ", "নিশ্চিত করুন"], cancel: ["না", "বাতিল করুন"] },
  mr: { confirm: ["हो", "पुष्टी करा"], cancel: ["नाही", "रद्द करा"] },
  gu: { confirm: ["હા", "પુષ્ટિ કરો"], cancel: ["ના", "રદ કરો"] },
  ta: { confirm: ["ஆம்", "உறுதிப்படுத்து"], cancel: ["இல்லை", "ரத்து செய்"] },
  te: { confirm: ["అవును", "నిర్ధారించు"], cancel: ["కాదు", "రద్దు చేయి"] },
  es: { confirm: ["sí", "confirmar", "confirma"], cancel: ["no", "cancelar", "cancela"] },
  fr: { confirm: ["oui", "confirmer", "confirme"], cancel: ["non", "annuler", "annule"] },
  de: { confirm: ["ja", "bestätigen"], cancel: ["nein", "abbrechen"] },
  pt: { confirm: ["sim", "confirmar"], cancel: ["não", "cancelar"] },
  zh: { confirm: ["确认", "確認"], cancel: ["取消"] },
  ja: { confirm: ["はい", "確定"], cancel: ["いいえ", "キャンセル"] },
};
export function planDecision(text: string, language = "en"): "confirm" | "cancel" | null {
  const answer = text.normalize("NFKC").toLowerCase().trim().replace(/[.!।。！]+$/u, "").trim();
  if (/^(confirm|yes|yes please|yes confirm|confirm it|go ahead|do it|yes do it|haan|han|haan kar do|ha kar do|kar do|हाँ|हां|हाँ कर दो|हां कर दो|कर दो|पुष्टि करो)$/u.test(answer)) return "confirm";
  if (/^(cancel|cancel it|no|no cancel|stop|don't do it|do not do it|nahi|nahin|mat karo|radd karo|नहीं|रद्द करो|मत करो)$/u.test(answer)) return "cancel";
  const scoped = decisions[language.split("-")[0]];
  if (scoped?.confirm.includes(answer)) return "confirm";
  if (scoped?.cancel.includes(answer)) return "cancel";
  return null;
}

export const ASSISTANT_COMMAND_EVENT = "kirana:assistant-command";
// Cancelled means a mounted assistant accepted the handoff. If that module is
// off, the caller retains its existing local draft workflow.
export function openAssistantCommand(message: string): boolean {
  return !window.dispatchEvent(new CustomEvent(ASSISTANT_COMMAND_EVENT, { detail: { message }, cancelable: true }));
}
