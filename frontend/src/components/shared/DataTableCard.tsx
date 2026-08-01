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
    <section className={cn("premium-panel data-table-card", className)} aria-labelledby={titleId} {...props}>
      <div className="data-table-header">
        <div className="data-table-heading">
          <h2 id={titleId} className="data-table-title">{title}</h2>
          {description ? <p className="data-table-description">{description}</p> : null}
        </div>
        {actions ? <div className="responsive-action-row shrink-0 md:justify-end">{actions}</div> : null}
      </div>
      {loading ? (
        <div className="data-table-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading table data">
          <Skeleton className="data-table-loading-head" />
          {Array.from({ length: loadingRows }).map((_, index) => <Skeleton key={index} />)}
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
          className="app-table-scroll data-table-scroll"
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
