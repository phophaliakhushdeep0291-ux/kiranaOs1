import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading({ label = "Loading app..." }: { label?: string }) {
  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-sm">
          <div className="h-11 w-11 rounded-lg bg-primary/10" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
        <Skeleton className="h-80 rounded-lg" />
      </div>
    </div>
  );
}
