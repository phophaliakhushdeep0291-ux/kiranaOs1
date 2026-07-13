import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading({ label = "Loading app..." }: { label?: string }) {
  return (
    <div className="min-h-[42vh] bg-white p-3 sm:p-5" role="status" aria-live="polite">
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex items-center gap-3 rounded-[14px] border border-[#e5ebf4] bg-white p-3 shadow-sm">
          <div className="h-10 w-10 animate-pulse rounded-[11px] bg-primary/10" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Skeleton className="h-20 rounded-[14px]" />
          <Skeleton className="h-20 rounded-[14px]" />
          <Skeleton className="hidden h-20 rounded-[14px] md:block" />
          <Skeleton className="hidden h-20 rounded-[14px] md:block" />
        </div>
        <Skeleton className="h-40 rounded-[14px]" />
      </div>
    </div>
  );
}
