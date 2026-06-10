import { cn } from "@/lib/utils";

export type PaymentMode = "cash" | "upi" | "split" | "udhar" | "card" | "online" | "other";

const modeConfig: Record<PaymentMode, { label: string; className: string }> = {
  cash:   { label: "Cash",   className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" },
  upi:    { label: "UPI",    className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900" },
  split:  { label: "Split",  className: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900" },
  udhar:  { label: "Udhar",  className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" },
  card:   { label: "Card",   className: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900" },
  online: { label: "Online", className: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900" },
  other:  { label: "Other",  className: "bg-muted text-muted-foreground border-border" },
};

export interface PaymentBadgeProps {
  mode: PaymentMode | string;
  compact?: boolean;
  className?: string;
}

export function PaymentBadge({ mode, compact = false, className }: PaymentBadgeProps) {
  const key = mode?.toLowerCase() as PaymentMode;
  const config = modeConfig[key] ?? modeConfig.other;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border font-semibold",
        compact ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        config.className,
        className,
      )}
    >
      {config.label !== "Other" ? config.label : (mode ?? "Other")}
    </span>
  );
}
