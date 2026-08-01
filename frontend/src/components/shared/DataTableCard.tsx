import { useId, type HTMLAttributes, type ReactNode } from "react";
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
  tableLabel?: string;
}

export function DataTableCard({ title, description, actions, children, loading = false, error, empty = false, emptyState, loadingRows = 3, tableLabel, className, ...props }: DataTableCardProps) {
  const id = useId();
  const titleId = `data-table-title-${id.replace(/:/g, "")}`;

  return (
    <section className={cn("premium-panel min-w-0 overflow-hidden p-0 text-card-foreground", className)} aria-labelledby={titleId} {...props}>
      <div className="flex min-w-0 flex-col gap-2 border-b border-[#edf1f6] px-4 py-3.5 md:flex-row md:items-start md:justify-between md:px-5 md:py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="break-words text-base font-bold text-foreground">{title}</h2>
          {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="responsive-action-row shrink-0 md:justify-end">{actions}</div> : null}
      </div>
      {loading ? (
        <div className="space-y-2 p-4" role="status" aria-live="polite" aria-busy="true" aria-label="Loading table data">
          <Skeleton className="h-10 w-full rounded-lg" />
          {Array.from({ length: loadingRows }).map((_, index) => <Skeleton key={index} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title="Unable to load data"
          description={error}
          className="m-4 border-destructive/30 bg-destructive/5"
          role="alert"
        />
      ) : empty ? (
        emptyState ?? <EmptyState className="m-4" title="No data found" description="There is nothing to show right now." />
      ) : (
        <div
          className="app-table-scroll min-w-0 overflow-x-auto p-3 md:p-4"
          role="region"
          aria-label={tableLabel ?? "Scrollable data table"}
          tabIndex={0}
        >
          {children}
        </div>
      )}
    </section>
  );
}
