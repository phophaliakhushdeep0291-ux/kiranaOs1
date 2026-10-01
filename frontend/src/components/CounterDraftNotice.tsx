import { Button } from "@/components/ui/button";
import { useAppLanguage } from "@/features/core/settings/i18n";

export function CounterDraftNotice({ draft }: { draft: { recoveryRequired: boolean; storageFailed: boolean; discard: () => void } }) {
  const { t } = useAppLanguage();
  if (!draft.recoveryRequired && !draft.storageFailed) return null;
  return <div role="alert" className="m-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
    <p>{t(draft.recoveryRequired ? "workflow.register.interrupted" : "workflow.register.storageFailed")}</p>
    {draft.recoveryRequired && <Button type="button" variant="outline" onClick={draft.discard}>{t("workflow.register.reviewRecords")}</Button>}
  </div>;
}
