import type { HTMLAttributes, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatCardTone = "default" | "green" | "blue" | "amber" | "violet" | "red";

const toneIconClasses: Record<StatCardTone, string> = {
  default: "bg-primary/10 text-primary ring-primary/20",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  blue: "bg-sky-50 text-sky-700 ring-sky-200/80 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  amber: "bg-amber-50 text-amber-700 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  violet: "bg-violet-50 text-violet-700 ring-violet-200/80 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  red: "bg-red-50 text-red-700 ring-red-200/80 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
};

const toneBorderTop: Record<StatCardTone, string> = {
  default: "border-t-primary/80",
  green: "border-t-emerald-500",
  blue: "border-t-sky-500",
  amber: "border-t-amber-500",
  violet: "border-t-violet-500",
  red: "border-t-red-500",
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
    <div
      className={cn(
        "group min-h-[118px] rounded-xl border border-t-2 bg-card p-3.5 text-card-foreground shadow-sm sm:p-5",
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
        toneBorderTop[tone],
        className,
      )}
      {...props}
    >
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0 break-words text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {icon ? (
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 sm:h-10 sm:w-10", toneIconClasses[tone])}>
            {icon}
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-28 max-w-full" />
          <Skeleton className="h-3.5 w-20 max-w-full" />
        </div>
      ) : (
        <div className="min-w-0">
          <p className="break-words font-display text-[1.45rem] font-black leading-tight tracking-tight text-foreground tabular-nums sm:text-3xl">
            {value}
          </p>
          {description ? (
            <p className="mt-1 break-words text-xs font-medium text-muted-foreground">{description}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
