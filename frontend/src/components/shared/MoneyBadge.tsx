import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type MoneyBadgeTone = "default" | "success" | "warning" | "danger" | "muted";

const toneClasses: Record<MoneyBadgeTone, string> = {
  default: "border-primary/20 bg-primary/10 text-primary",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

export interface MoneyBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  amount: number | undefined;
  tone?: MoneyBadgeTone;
  compact?: boolean;
}

export function MoneyBadge({ amount, tone = "default", compact = false, className, ...props }: MoneyBadgeProps) {
  const formatted = `₹${(amount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border font-semibold tabular-nums",
        compact ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {formatted}
    </span>
  );
}
