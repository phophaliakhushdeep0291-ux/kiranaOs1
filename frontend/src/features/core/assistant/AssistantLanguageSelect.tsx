import { useAppLanguage } from "@/features/core/settings/i18n";
import { assistantLanguageChoices } from "./assistant-language";
export function AssistantLanguageSelect({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useAppLanguage();
  return <label className="grid gap-1 text-xs font-semibold text-slate-600">
    <span>{t("assistant.languageLabel")}</span>
    <select aria-label={t("assistant.languageLabel")} value={value} disabled={disabled}
      onChange={event => onChange(event.target.value)}
      className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:opacity-50">
      <option value="auto">{t("assistant.languageAuto")}</option>
      {assistantLanguageChoices.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
    </select>
  </label>;
}
