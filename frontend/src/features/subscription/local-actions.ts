import { offlineDB } from "@/lib/offline/db";
import { enqueueOutboxOperation } from "@/features/sync/outbox";
import { createLocalId } from "@/lib/offline/instant-cache";
import type { PlanCode } from "@/features/subscription/plans";
import { writeAuditLog } from "@/features/audit-logs/local-actions";

export async function subscriptionRefreshLocalFirst(planCode: PlanCode | string = "starter") {
  const id = createLocalId("subscription_refresh");
  await offlineDB.put("subscription_cache", { id, plan_code: planCode, payload: { requestedRefresh: true, planCode }, sync_status: "pending_sync" });
  await writeAuditLog({
    action: "subscription_change",
    entityType: "subscription",
    entityId: id,
    entityLabel: String(planCode),
    newValue: { requestedRefresh: true, planCode },
    summary: `Subscription refresh requested for ${planCode}`,
  });
  await enqueueOutboxOperation({
    entity_type: "subscription",
    entity_id: id,
    operation_type: "SUBSCRIPTION_REFRESH",
    payload: { planCode },
  });
  return { success: true, pendingSync: true, id };
}
