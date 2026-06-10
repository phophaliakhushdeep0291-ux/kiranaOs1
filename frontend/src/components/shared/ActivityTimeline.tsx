import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TimelineEntry {
  id: string | number;
  date: string;
  title: ReactNode;
  description?: ReactNode;
  amount?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "muted";
}

const toneConnector: Record<NonNullable<TimelineEntry["tone"]>, string> = {
  default: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger:  "bg-red-500",
  muted:   "bg-muted-foreground/40",
};

const toneIcon: Record<NonNullable<TimelineEntry["tone"]>, string> = {
  default: "bg-primary/10 text-primary border-primary/20",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300",
  danger:  "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300",
  muted:   "bg-muted text-muted-foreground border-border",
};

export interface ActivityTimelineProps {
  entries: TimelineEntry[];
  className?: string;
  emptyMessage?: string;
}

export function ActivityTimeline({ entries, className, emptyMessage = "No activity yet." }: ActivityTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <ol className={cn("relative space-y-0", className)}>
      {entries.map((entry, i) => {
        const tone = entry.tone ?? "default";
        const isLast = i === entries.length - 1;
        return (
          <li key={entry.id} className="relative flex gap-4 pb-6 last:pb-0">
            {/* vertical connector */}
            {!isLast && (
              <span className={cn("absolute left-[15px] top-8 bottom-0 w-0.5", toneConnector[tone], "opacity-20")} aria-hidden="true" />
            )}
            {/* icon */}
            <span className={cn(
              "relative z-10 mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm",
              toneIcon[tone],
            )}>
              {entry.icon ?? <span className="h-2 w-2 rounded-full bg-current" />}
            </span>
            {/* content */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-foreground leading-snug">{entry.title}</p>
                {entry.amount ? (
                  <span className="shrink-0 text-sm font-black tabular-nums text-foreground">{entry.amount}</span>
                ) : null}
              </div>
              {entry.description ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{entry.description}</p>
              ) : null}
              <p className="mt-1 text-[11px] text-muted-foreground/70">{entry.date}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
