/** Language choices describe preferences, not a promise of provider/voice support. */
export function canonicalAssistantLanguage(value: string): string | null {
  if (value === "auto") return value;
  if (value.length > 35 || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(value)) return null;
  try { const locale = new Intl.Locale(value); return (!locale.language || ["und", "zxx"].includes(locale.language)) ? null : locale.baseName; } catch { return null; }
}
const codes = "en hi ar ur bn mr gu ta te kn ml pa ne si as or es fr de pt it nl ru uk pl tr fa he id ms th vi zh ja ko sw af am az be bg bs ca cs cy da el et eu fi fil ga gl ha hr hu hy is ka kk km ku ky lo lt lv mg mk mn mt my no ps ro sk sl so sq sr su sv tg tk tl tt ug uz xh yi yo zu yue".split(" ");
export const assistantLanguageChoices = codes.map(code => {
  const english = new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  let native = english;
  try { native = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? english; } catch { /* English name remains usable. */ }
  return { code, label: native === english ? english : `${native} · ${english}` };
});
export function matchingSpeechVoice(voices: SpeechSynthesisVoice[], language: string) {
  const locale = canonicalAssistantLanguage(language);
  if (!locale || locale === "auto") return null;
  const exact = voices.find(voice => voice.lang.toLowerCase() === locale.toLowerCase());
  return exact ?? voices.find(voice => voice.lang.split(/[-_]/)[0].toLowerCase() === locale.split("-")[0]) ?? null;
}
