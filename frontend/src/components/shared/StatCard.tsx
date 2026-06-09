import type { HTMLAttributes, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatCardTone = "default" | "green" | "blue" | "amber" | "violet" | "red";

const toneClasses: Record<StatCardTone, string> = {
  default: "bg-primary/10 text-primary ring-primary/15",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  blue: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  amber: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  violet: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
};

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  tone?: StatCardTone;
}

export function StatCard({ label, value, description, icon, loading = false, tone = "default", className, ...props }: StatCardProps) {
  return (
    <div className={cn("group rounded-lg border bg-card p-3 text-card-foreground shadow-sm transition-colors duration-200 hover:border-primary/30 sm:p-4", className)} {...props}>
      <div className="mb-2 flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {icon ? <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1", toneClasses[tone])}>{icon}</span> : null}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-24 max-w-full" />
          <Skeleton className="h-3 w-16 max-w-full" />
        </div>
      ) : (
        <div className="min-w-0">
          <p className="break-words text-xl font-black text-foreground sm:text-2xl">{value}</p>
          {description ? <p className="mt-0.5 break-words text-xs text-muted-foreground">{description}</p> : null}
        </div>
      )}
    </div>
  );
}
