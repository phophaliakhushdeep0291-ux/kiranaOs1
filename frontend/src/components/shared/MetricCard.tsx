import type { HTMLAttributes, ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type MetricCardTone = "default" | "green" | "blue" | "amber" | "violet" | "red" | "teal" | "rose";

const toneClasses: Record<MetricCardTone, { border: string; icon: string; badge: string }> = {
  default: { border: "border-t-primary/80",  icon: "bg-primary/10 text-primary ring-primary/20",            badge: "bg-primary/10 text-primary" },
  green:   { border: "border-t-emerald-500", icon: "bg-emerald-50 text-emerald-700 ring-emerald-200/80",     badge: "bg-emerald-50 text-emerald-700" },
  blue:    { border: "border-t-blue-500",    icon: "bg-blue-50 text-blue-700 ring-blue-200/80",              badge: "bg-blue-50 text-blue-700" },
  amber:   { border: "border-t-amber-500",   icon: "bg-amber-50 text-amber-700 ring-amber-200/80",           badge: "bg-amber-50 text-amber-700" },
  violet:  { border: "border-t-violet-500",  icon: "bg-violet-50 text-violet-700 ring-violet-200/80",        badge: "bg-violet-50 text-violet-700" },
  red:     { border: "border-t-red-500",     icon: "bg-red-50 text-red-700 ring-red-200/80",                 badge: "bg-red-50 text-red-700" },
  teal:    { border: "border-t-teal-500",    icon: "bg-teal-50 text-teal-700 ring-teal-200/80",              badge: "bg-teal-50 text-teal-700" },
  rose:    { border: "border-t-rose-500",    icon: "bg-rose-50 text-rose-700 ring-rose-200/80",              badge: "bg-rose-50 text-rose-700" },
};

export interface MetricCardProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  description?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  tone?: MetricCardTone;
  action?: ReactNode;
}

export function MetricCard({
  label, value, delta, deltaLabel = "vs yesterday",
  description, icon, loading = false, tone = "default",
  action, className, ...props
}: MetricCardProps) {
  const tc = toneClasses[tone];

  const trend = delta == null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendClass = trend === "up"
    ? "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40"
    : trend === "down"
    ? "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/40"
    : "text-muted-foreground bg-muted";

  return (
    <div
      className={cn(
        "group rounded-xl border border-t-2 bg-card p-4 text-card-foreground shadow-sm",
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5",
        tc.border,
        className,
      )}
      {...props}
    >
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0 break-words text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {icon ? (
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1", tc.icon)}>
            {icon}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-28 max-w-full" />
          <Skeleton className="h-3.5 w-24 max-w-full" />
        </div>
      ) : (
        <div className="min-w-0">
          <p className="break-words font-display text-2xl font-black tracking-tight text-foreground tabular-nums sm:text-3xl">
            {value}
          </p>
          {delta != null && (
            <div className="mt-2 flex items-center gap-2">
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold", trendClass)}>
                <TrendIcon size={12} aria-hidden="true" />
                {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
              </span>
              <span className="text-xs text-muted-foreground">{deltaLabel}</span>
            </div>
          )}
          {description ? (
            <p className="mt-1 break-words text-xs font-medium text-muted-foreground">{description}</p>
          ) : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      )}
    </div>
  );
}
