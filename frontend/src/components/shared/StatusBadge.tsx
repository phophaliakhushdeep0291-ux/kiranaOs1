import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock3, WifiOff, AlertTriangle, XCircle } from "lucide-react";

type Tone = "success" | "warning" | "danger" | "info" | "muted";

const toneClasses: Record<Tone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
  muted: "border-border bg-muted text-muted-foreground",
};

const icons = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Clock3,
  muted: WifiOff,
};

export function StatusBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  const Icon = icons[tone];
  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-full px-2.5 py-1 font-semibold", toneClasses[tone], className)}>
      <Icon size={13} aria-hidden="true" />
      {children}
    </Badge>
  );
}
