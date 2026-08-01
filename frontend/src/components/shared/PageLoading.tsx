import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading({ label = "Loading app..." }: { label?: string }) {
  return (
    <div className="app-loading-surface" role="status" aria-live="polite" aria-busy="true">
      <div className="app-loading-content">
        <div className="app-loading-header">
          <Skeleton className="app-loading-mark" />
          <div className="app-loading-copy">
            <Skeleton className="app-loading-title" />
            <p className="app-loading-label">{label}</p>
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
