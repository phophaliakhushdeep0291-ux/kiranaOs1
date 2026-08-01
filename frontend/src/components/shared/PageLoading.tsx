import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading({ label = "Loading app..." }: { label?: string }) {
  return (
    <div className="app-loading-surface min-h-[calc(100dvh-var(--app-desktop-topbar-height))] p-3 sm:p-5 lg:p-6" role="status" aria-live="polite" aria-busy="true">
      <div className="mx-auto max-w-[var(--app-page-max)] space-y-4">
        <div className="app-loading-header flex min-h-[80px] items-center gap-3.5 rounded-[var(--surface-radius)] border border-[var(--surface-line)] bg-white p-4 shadow-[var(--surface-shadow)]">
          <Skeleton className="h-11 w-11 shrink-0 rounded-[13px]" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
          <Skeleton className="h-28 rounded-[var(--surface-radius)]" />
          <Skeleton className="h-28 rounded-[var(--surface-radius)]" />
          <Skeleton className="hidden h-28 rounded-[var(--surface-radius)] md:block" />
          <Skeleton className="hidden h-28 rounded-[var(--surface-radius)] md:block" />
        </div>
        <Skeleton className="h-52 rounded-[var(--surface-radius)]" />
      </div>
    </div>
  );
}
