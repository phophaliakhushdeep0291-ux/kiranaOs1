import { useAppLanguage, type Translate } from "@/features/core/settings/i18n";
import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, RefreshCw, WifiOff, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ErrorStateVariant = "generic" | "network" | "server" | "notFound";

const variantConfig = (t: Translate): Record<ErrorStateVariant, { icon: typeof AlertTriangle; title: string; description: string }> => ({
  generic:  { icon: AlertTriangle, title: t("settings.integrations.genericError"),  description: t("chrome.error.unexpected") },
  network:  { icon: WifiOff,       title: t("chrome.error.offline"), description: t("chrome.error.offlineHelp") },
  server:   { icon: ServerCrash,   title: t("chrome.error.server"),           description: t("chrome.error.serverHelp") },
  notFound: { icon: AlertTriangle, title: t("chrome.error.notFound"), description: t("chrome.error.notFoundHelp") },
});

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  variant?: ErrorStateVariant;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}

export function ErrorState({
  title, description, variant = "generic",
  onRetry, retryLabel = "Try again",
  compact = false, className, ...props
}: ErrorStateProps) {
  const { t } = useAppLanguage();
  const cfg = variantConfig(t)[variant];
  const Icon = cfg.icon;

  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 text-center",
        compact ? "gap-2 p-4" : "gap-3 p-6 sm:p-8",
        className,
      )}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      {...props}
    >
      <span className="grid h-12 w-12 place-items-center rounded-full bg-destructive/10">
        <Icon className="h-6 w-6 text-destructive" aria-hidden="true" />
      </span>
      <div>
        <p className={cn("font-bold text-foreground", compact ? "text-sm" : "text-base")}>
          {title ?? cfg.title}
        </p>
        {!compact && (
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {description ?? cfg.description}
          </p>
        )}
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          onClick={onRetry}
          className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
        >
          <RefreshCw size={14} aria-hidden="true" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
