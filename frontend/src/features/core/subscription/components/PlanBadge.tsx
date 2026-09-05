import { Badge } from "@/components/ui/badge";
import { getPlan, getPlanForBusinessType, type PlanDefinition } from "@/features/core/subscription/plans";
import { useBusinessTypeKey } from "@/features/core/settings/business-types";

function compactStatus(status?: string | null) {
  if (!status || status === "active") return "";
  if (status === "payment_failed") return "failed";
  return status.replace(/_/g, " ");
}

export function PlanBadge({
  planCode,
  status,
  plan: snapshotPlan,
}: {
  planCode?: string | null;
  status?: string | null;
  plan?: Pick<PlanDefinition, "code" | "name" | "price">;
}) {
  const businessType = useBusinessTypeKey();
  const code = getPlan(planCode).code;
  const plan = snapshotPlan?.code === code ? snapshotPlan : getPlanForBusinessType(code, businessType);
  const statusLabel = compactStatus(status);
  const label = `Rs ${plan.price} ${plan.name}`;
  const title = statusLabel ? `${label} - ${statusLabel}` : label;

  return (
    <Badge
      title={title}
      variant={status === "expired" || status === "payment_failed" ? "destructive" : plan.code === "starter" ? "secondary" : "default"}
      className="max-w-[7.5rem] shrink-0 truncate whitespace-nowrap px-2 text-[10px] leading-5"
    >
      {label}
    </Badge>
  );
}
