import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useAppLanguage } from "@/features/core/settings/i18n";

/** No counts or financial actions are safe to show as current after a failed read. */
export function LocalDataUnavailable({ checking = false, onRetry }: { checking?: boolean; onRetry: () => void }) {
  const { t } = useAppLanguage();
  return <section role={checking ? "status" : "alert"} className="m-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
    <h2 className="font-bold">{t(checking ? "sync.local.checking" : "sync.local.unavailable")}</h2>
    {!checking && <>
      <p className="text-sm">{t("sync.local.unavailableBody")}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={onRetry}>{t("sync.local.retry")}</Button>
        <Link href="/recovery-mode" className="inline-flex min-h-11 items-center underline">{t("sync.local.recovery")}</Link>
      </div>
    </>}
  </section>;
}
