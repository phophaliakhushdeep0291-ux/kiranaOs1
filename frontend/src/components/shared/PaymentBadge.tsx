import { useAppLanguage, type Translate } from "@/features/core/settings/i18n";
import { useShopBillingWords } from "@/features/core/settings/shop-billing";
import { cn } from "@/lib/utils";

export type PaymentMode = "cash" | "upi" | "split" | "udhar" | "card" | "online" | "other";

// `creditWord` is required because "billing.pay.udhar" is the placeholder
// "{credit}" in every language — each trade supplies its own word for credit.
// Calling it bare renders the literal "{credit}" to the shopkeeper.
const paymentModes = (t: Translate, creditWord: string): Record<PaymentMode, { label: string; className: string }> => ({
  cash:   { label: t("billing.pay.cash"),   className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" },
  upi:    { label: t("billing.pay.upi"),    className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900" },
  split:  { label: t("billing.pay.split"),  className: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900" },
  udhar:  { label: t("billing.pay.udhar", { credit: creditWord }),  className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" },
  card:   { label: t("billing.bills.card"),   className: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900" },
  online: { label: t("dashboard.health.online"), className: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900" },
  other:  { label: t("inventory.transfers.reason.other"),  className: "bg-muted text-muted-foreground border-border" },
});

export interface PaymentBadgeProps {
  mode: PaymentMode | string;
  compact?: boolean;
  className?: string;
}

export function PaymentBadge({ mode, compact = false, className }: PaymentBadgeProps) {
  const { t } = useAppLanguage();
  const words = useShopBillingWords();
  const key = mode?.toLowerCase() as PaymentMode;
  const modes = paymentModes(t, words.credit);
  const config = modes[key] ?? modes.other;
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
