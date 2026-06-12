import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";

export interface DataTableCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  loading?: boolean;
  error?: ReactNode;
  empty?: boolean;
  emptyState?: ReactNode;
  loadingRows?: number;
}

export function DataTableCard({ title, description, actions, children, loading = false, error, empty = false, emptyState, loadingRows = 3, className, ...props }: DataTableCardProps) {
  return (
    <section className={cn("rounded-xl border bg-card p-3 text-card-foreground shadow-sm sm:p-4", className)} {...props}>
      <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-words text-base font-bold text-foreground">{title}</h2>
          {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="grid w-full shrink-0 grid-cols-1 gap-2 min-[420px]:flex min-[420px]:w-auto min-[420px]:flex-wrap min-[420px]:items-center">{actions}</div> : null}
      </div>
      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading">
          {Array.from({ length: loadingRows }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}
        </div>
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title="Unable to load data"
          description={error}
          className="border-destructive/30 bg-destructive/5"
          role="alert"
        />
      ) : empty ? (
        emptyState ?? <EmptyState title="No data found" description="There is nothing to show right now." />
      ) : (
        <div className="app-table-scroll min-w-0 overflow-x-auto">{children}</div>
      )}
    </section>
  );
}
