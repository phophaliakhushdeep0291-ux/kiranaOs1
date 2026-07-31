import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading({ label = "Loading app..." }: { label?: string }) {
  return (
    <div className="app-loading-surface min-h-[42vh] p-3 sm:p-5 lg:p-6" role="status" aria-live="polite" aria-busy="true">
      <div className="mx-auto max-w-[var(--app-page-max)] space-y-4">
        <div className="app-loading-header flex min-h-[76px] items-center gap-3.5 rounded-[16px] border border-[#e3eaf4] bg-white/95 p-4 shadow-[0_12px_34px_rgba(15,35,80,0.055)]">
          <Skeleton className="h-11 w-11 shrink-0 rounded-[13px]" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
          <Skeleton className="h-28 rounded-[16px]" />
          <Skeleton className="h-28 rounded-[16px]" />
          <Skeleton className="hidden h-28 rounded-[16px] md:block" />
          <Skeleton className="hidden h-28 rounded-[16px] md:block" />
        </div>
        <Skeleton className="h-52 rounded-[16px]" />
      </div>
    </div>
  );
}
