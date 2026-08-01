import type { UseFormReturn } from "react-hook-form";
import { AlertTriangle, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DuplicateProductWarning } from "@/features/products/product-reliability";
import type { ProductFormData } from "../product-form-state";
import { useAppLanguage } from "@/features/settings/i18n";

const FALLBACK_ALIAS_CHIPS = ["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर", "atta", "aata", "आटा", "tel", "oil", "तेल"];

interface ProductAliasSuggestionsProps {
  form: UseFormReturn<ProductFormData>;
  aliasSuggestions: string[];
  duplicateWarnings: DuplicateProductWarning[];
  aiAliasLoading: boolean;
  aiAliasError: string | null;
  onAppendAlias: (alias: string) => void;
  onAppendAllLocalAliases: () => void;
  onAskGroqForAliases: () => void;
}

export function ProductAliasSuggestions({
  form,
  aliasSuggestions,
  duplicateWarnings,
  aiAliasLoading,
  aiAliasError,
  onAppendAlias,
  onAppendAllLocalAliases,
  onAskGroqForAliases,
}: ProductAliasSuggestionsProps) {
  const { t } = useAppLanguage();
  const watchedName = form.watch("name");

  return (
    <div className="rounded-2xl border bg-emerald-50/40 p-3 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Label>Alias names / AI suggestions</Label>
          <p className="mt-1 text-xs text-muted-foreground">Used by billing search and voice commands. Click suggestions to add them.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!watchedName.trim()} onClick={onAppendAllLocalAliases}>
            <Lightbulb size={13} className="mr-1" />Add local aliases
          </Button>
          <Button type="button" size="sm" disabled={!watchedName.trim() || aiAliasLoading} onClick={onAskGroqForAliases}>
            <Lightbulb size={13} className="mr-1" />{aiAliasLoading ? t("products.alias.asking") : t("products.alias.ask")}
          </Button>
        </div>
      </div>

      <Textarea className="mt-3 min-h-24" {...form.register("aliasesText")} placeholder="Hindi/English names, separated by comma or new line. e.g. sugar, chini, cheeni, shakar, sakar, चीनी" />
      {aiAliasError ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">{aiAliasError}</p> : null}

      {duplicateWarnings.length ? (
        <div data-testid="product-duplicate-warning" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Possible duplicate product</p>
              <p className="text-xs">{duplicateWarnings[0].message}</p>
            </div>
          </div>
        </div>
      ) : null}

      {aliasSuggestions.length ? (
        <div className="mt-3 rounded-xl border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><Lightbulb size={14} />AI alias suggestions</div>
          <div className="flex flex-wrap gap-2">
            {aliasSuggestions.map((alias) => <Button key={alias} type="button" size="sm" variant="outline" className="rounded-full" onClick={() => onAppendAlias(alias)}>{alias}</Button>)}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">Type product name to get AI alias suggestions, or tap common aliases:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {FALLBACK_ALIAS_CHIPS.map((alias) => (
              <Button key={alias} type="button" size="sm" variant="outline" className="rounded-full" onClick={() => onAppendAlias(alias)}>{alias}</Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
