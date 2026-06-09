import { Badge } from "@/components/ui/badge";
import { getPlan } from "@/features/subscription/plans";

function compactStatus(status?: string | null) {
  if (!status || status === "active") return "";
  if (status === "payment_failed") return "failed";
  return status.replace(/_/g, " ");
}

export function PlanBadge({
  planCode,
  status,
}: {
  planCode?: string | null;
  status?: string | null;
}) {
  const plan = getPlan(planCode);
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
