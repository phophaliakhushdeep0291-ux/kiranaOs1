import { getSubscriptionStatus } from "@/features/core/subscription/api";
import { writeSubscriptionSnapshot } from "@/features/core/subscription/access";
import type { PlanCode } from "@/features/core/subscription/plans";

/**
 * Kept under the historical name for callers, but this is intentionally
 * server-authoritative. A subscription refresh cannot be manufactured offline:
 * plan access and payment state must come from the billing service.
 */
export async function subscriptionRefreshLocalFirst(_planCode: PlanCode | string = "starter") {
  const subscription = await getSubscriptionStatus();
  await writeSubscriptionSnapshot(subscription as unknown as Record<string, unknown>);
  return { success: true, pendingSync: false, subscription };
}
