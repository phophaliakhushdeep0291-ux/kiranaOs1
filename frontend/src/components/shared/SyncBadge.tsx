import { useAppLanguage, type Translate } from "@/features/core/settings/i18n";
import { CheckCircle2, CloudOff, Loader2, AlertTriangle, Database } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type SyncBadgeStatus = "synced" | "pending" | "failed" | "offline" | "local" | "estimate";

const syncStatuses = (t: Translate): Record<SyncBadgeStatus, { label: string; className: string; icon: typeof CheckCircle2 }> => ({
  synced: { label: t("dashboard.health.synced"), className: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  pending: { label: t("dashboard.pendingSync"), className: "border-amber-200 bg-amber-50 text-amber-700", icon: Loader2 },
  failed: { label: t("chrome.sync.failed"), className: "border-destructive/20 bg-destructive/10 text-destructive", icon: AlertTriangle },
  offline: { label: t("dashboard.health.offline"), className: "border-slate-200 bg-slate-50 text-slate-700", icon: CloudOff },
  local: { label: t("chrome.sync.localData"), className: "border-blue-200 bg-blue-50 text-blue-700", icon: Database },
  estimate: { label: t("chrome.sync.localEstimate"), className: "border-amber-200 bg-amber-50 text-amber-700", icon: AlertTriangle },
});

export interface SyncBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: SyncBadgeStatus;
  label?: string;
}

export function SyncBadge({ status, label, className, ...props }: SyncBadgeProps) {
  const { t } = useAppLanguage();
  const config = syncStatuses(t)[status];
  const Icon = config.icon;
  const isSpinner = status === "pending";
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", config.className, className)} {...props}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", isSpinner && "animate-spin")} aria-hidden="true" />
      <span className="truncate">{label ?? config.label}</span>
    </span>
  );
}
