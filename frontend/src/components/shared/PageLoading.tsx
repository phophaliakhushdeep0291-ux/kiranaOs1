import { useAppLanguage } from "@/features/core/settings/i18n";
import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading({ label }: { label?: string }) {
  // Not a default parameter: those are evaluated in the parameter list, before
  // any hook has run, so the fallback has to happen in the body.
  const { t } = useAppLanguage();
  const text = label ?? t("chrome.loadingApp");
  return (
    <div className="app-loading-surface" role="status" aria-live="polite" aria-busy="true">
      <div className="app-loading-content">
        <div className="app-loading-header">
          <Skeleton className="app-loading-mark" />
          <div className="app-loading-copy">
            <Skeleton className="app-loading-title" />
            <p className="app-loading-label">{text}</p>
          </div>
        </div>
        <div className="app-loading-metrics">
          <Skeleton /><Skeleton /><Skeleton /><Skeleton />
        </div>
        <Skeleton className="app-loading-table" />
      </div>
    </div>
  );
}
