import { Button } from "@/components/ui/button";
import { useAppLanguage } from "@/features/core/settings/i18n";

/** Reports combine local and server records; neither read may silently become zero. */
export function ReportDataUnavailable({ checking, onRetry }: { checking: boolean; onRetry: () => void }) {
  const { t } = useAppLanguage();
  return <section role={checking ? "status" : "alert"} className="m-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
    <h2 className="font-bold">{t(checking ? "reports.read.checking" : "reports.read.unavailable")}</h2>
    {!checking && <>
      <p className="text-sm">{t("reports.read.help")}</p>
      <Button variant="outline" onClick={onRetry}>{t("reports.read.retry")}</Button>
    </>}
  </section>;
}
