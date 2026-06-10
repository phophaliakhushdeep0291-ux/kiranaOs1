import type { HTMLAttributes, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface ChartCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  loading?: boolean;
  height?: number | string;
}

export function ChartCard({
  title, description, actions, children, loading = false,
  height = 240, className, ...props
}: ChartCardProps) {
  return (
    <section
      className={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div
        className="p-4 sm:p-5"
        style={{ minHeight: typeof height === "number" ? `${height}px` : height }}
      >
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <div className="flex items-end gap-2 pt-4" style={{ height: typeof height === "number" ? `${height - 80}px` : "160px" }}>
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="flex-1 rounded-md"
                  style={{ height: `${30 + Math.random() * 70}%` }}
                />
              ))}
            </div>
          </div>
        ) : children}
      </div>
    </section>
  );
}
