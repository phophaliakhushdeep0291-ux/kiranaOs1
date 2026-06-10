import { cn } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";

export type RiskLevel = "low" | "medium" | "high" | "none";

const levelConfig: Record<RiskLevel, { label: string; className: string; icon: typeof ShieldCheck }> = {
  none:   { label: "No risk",    className: "bg-muted text-muted-foreground border-border",                                                    icon: ShieldCheck  },
  low:    { label: "Low risk",   className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300", icon: ShieldCheck  },
  medium: { label: "Medium risk",className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300",           icon: AlertTriangle},
  high:   { label: "High risk",  className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300",                    icon: ShieldAlert  },
};

export interface RiskBadgeProps {
  level: RiskLevel;
  compact?: boolean;
  className?: string;
}

export function RiskBadge({ level, compact = false, className }: RiskBadgeProps) {
  const config = levelConfig[level] ?? levelConfig.none;
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold",
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        config.className,
        className,
      )}
    >
      <Icon size={compact ? 11 : 13} aria-hidden="true" />
      {config.label}
    </span>
  );
}

export function riskLevel(outstanding: number): RiskLevel {
  if (outstanding <= 0) return "none";
  if (outstanding < 500) return "low";
  if (outstanding < 5000) return "medium";
  return "high";
}
