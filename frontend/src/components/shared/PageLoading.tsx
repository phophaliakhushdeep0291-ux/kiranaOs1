import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading({ label = "Loading app..." }: { label?: string }) {
  return (
    <div className="app-loading-surface min-h-[42vh] bg-white p-3 sm:p-5" role="status" aria-live="polite" aria-busy="true">
      <div className="mx-auto max-w-6xl space-y-3.5">
        <div className="flex min-h-[68px] items-center gap-3 rounded-[16px] border border-[#e5ebf4] bg-white p-3.5 shadow-[0_10px_28px_rgba(15,35,80,0.045)]">
          <Skeleton className="h-10 w-10 shrink-0 rounded-[12px]" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Skeleton className="h-24 rounded-[16px]" />
          <Skeleton className="h-24 rounded-[16px]" />
          <Skeleton className="hidden h-24 rounded-[16px] md:block" />
          <Skeleton className="hidden h-24 rounded-[16px] md:block" />
        </div>
        <Skeleton className="h-44 rounded-[16px]" />
      </div>
    </div>
  );
}
