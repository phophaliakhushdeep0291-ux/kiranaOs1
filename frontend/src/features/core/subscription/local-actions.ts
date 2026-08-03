import { offlineDB } from "@/lib/offline/db";
import { buildOutboxOperation } from "@/features/core/sync/outbox";
import { createLocalId } from "@/lib/offline/instant-cache";
import type { PlanCode } from "@/features/core/subscription/plans";
import { buildAuditLogOutboxInput, buildAuditLogRow } from "@/features/core/audit-logs/local-actions";

export async function subscriptionRefreshLocalFirst(planCode: PlanCode | string = "starter") {
  const id = createLocalId("subscription_refresh");
  const row = { id, plan_code: planCode, payload: { requestedRefresh: true, planCode }, sync_status: "pending_sync" };
  const audit = buildAuditLogRow({
    action: "subscription_change",
    entityType: "subscription",
    entityId: id,
    entityLabel: String(planCode),
    newValue: { requestedRefresh: true, planCode },
    summary: `Subscription refresh requested for ${planCode}`,
  });
  const auditOutbox = buildOutboxOperation(buildAuditLogOutboxInput(audit));
  const refreshOutbox = buildOutboxOperation({
    entity_type: "subscription",
    entity_id: id,
    operation_type: "SUBSCRIPTION_REFRESH",
    idempotency_key: `subscription-refresh:${id}`,
    payload: { planCode },
  });
  await offlineDB.transaction(["subscription_cache", "local_audit_logs", "sync_outbox"], async (tx) => {
    await tx.put("subscription_cache", row);
    await tx.put("local_audit_logs", audit);
    await tx.enqueueOutboxOperation(auditOutbox);
    await tx.enqueueOutboxOperation(refreshOutbox);
  });
  return { success: true, pendingSync: true, id };
}
