import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppLanguage, type AppLanguage } from "@/features/core/settings/i18n";

/**
 * One tap between Hindi and English, for the screens a shopkeeper reaches before
 * Settings exists to him — the login screen most of all.
 *
 * New shops start in Hindi, so this is the escape hatch for the counter that wants
 * English, and it has to be reachable without signing in first. Each option is
 * labelled in its OWN language: a shopkeeper looking for Hindi looks for "हिन्दी",
 * not for the word "Hindi" written in a language he is trying to leave.
 */
const OPTIONS: Array<{ value: AppLanguage; label: string }> = [
  { value: "hi", label: "हिन्दी" },
  { value: "en", label: "English" },
];

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage } = useAppLanguage();

  return (
    <div className={cn("mt-4 inline-flex items-center gap-2", className)}>
      <Languages size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="inline-flex rounded-[10px] border border-[#dce5f2] bg-[#f7f9fc] p-1">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            // 44px min target: this sits on a phone at a counter, often one-handed.
            className={cn(
              "min-h-[44px] rounded-[7px] px-4 text-[13px] font-bold transition-colors",
              language === option.value ? "bg-white text-[var(--brand)] shadow-sm" : "text-[#64748b]",
            )}
            aria-pressed={language === option.value}
            data-testid={`language-toggle-${option.value}`}
            onClick={() => setLanguage(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
