import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getPlan, getPlanForBusinessType, type PlanDefinition } from "@/features/core/subscription/plans";
import { useBusinessTypeKey } from "@/features/core/settings/business-types";
import { useAppLanguage, type TranslationKey } from "@/features/core/settings/i18n";

function compactStatus(status?: string | null) {
  if (!status || status === "active") return "";
  if (status === "payment_failed") return "failed";
  return status.replace(/_/g, " ");
}

/**
 * The states that change what the shop can do, written where they can be read.
 *
 * An expired plan used to wear exactly the words an active one did — "Rs 999
 * Business" — and differ only in colour, with the status tucked into a tooltip
 * that a touch screen never shows. On the counter's phone that is no status at
 * all. These states print their name instead of the price: the price is the one
 * part of the badge an owner with a lapsed plan does not need, and the badge
 * truncates at 7.5rem, so carrying both would cut off the status first.
 */
const LAPSED_STATUS_LABELS: Partial<Record<string, TranslationKey>> = {
  expired: "plans.badge.expired",
  payment_failed: "plans.badge.unpaid",
  grace: "plans.badge.grace",
};

export function PlanBadge({
  planCode,
  status,
  plan: snapshotPlan,
}: {
  planCode?: string | null;
  status?: string | null;
  plan?: Pick<PlanDefinition, "code" | "name" | "price">;
}) {
  const { t } = useAppLanguage();
  const businessType = useBusinessTypeKey();
  const code = getPlan(planCode).code;
  const plan = snapshotPlan?.code === code ? snapshotPlan : getPlanForBusinessType(code, businessType);
  const statusLabel = compactStatus(status);
  const priceLabel = `Rs ${plan.price} ${plan.name}`;
  const lapsedLabelKey = status ? LAPSED_STATUS_LABELS[status] : undefined;
  const label = lapsedLabelKey ? `${plan.name} · ${t(lapsedLabelKey)}` : priceLabel;
  const title = statusLabel ? `${priceLabel} - ${statusLabel}` : priceLabel;
  const lapsed = status === "expired" || status === "payment_failed";

  return (
    <Badge
      title={title}
      variant={lapsed ? "destructive" : status === "grace" ? "outline" : plan.code === "starter" ? "secondary" : "default"}
      className={cn(
        "max-w-[7.5rem] shrink-0 truncate whitespace-nowrap px-2 text-[10px] leading-5",
        // Grace is a warning, not a fault: the plan has ended but nothing has
        // stopped yet. The primary fill it wore before read as "all fine".
        status === "grace" && "border-amber-300 bg-amber-50 text-amber-900",
      )}
    >
      {label}
    </Badge>
  );
}
