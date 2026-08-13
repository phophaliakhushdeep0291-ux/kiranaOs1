import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dexieDB,
  offlineDB,
  type SubscriptionCacheRow,
} from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { emitLocalDataChanged } from "@/lib/offline/instant-cache";
import {
  FEATURE_LABELS,
  getPlan,
  getPlanForBusinessType,
  getPlanForEntitlementSnapshot,
  getRequiredPlanForFeature,
  type FeatureName,
  type PlanCode,
  type PlanDefinition,
  type SubscriptionState,
} from "@/features/core/subscription/plans";
import { getLicenseEvaluation } from "@/features/core/devices/license";
import { getStoredBusinessType, subscribeToBusinessType } from "@/features/core/settings/business-type-store";

const DEFAULT_TRIAL_KEY = "kirana-os:subscription-default-trial:v1";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionSnapshot {
  plan: PlanDefinition;
  planCode: PlanCode;
  status: SubscriptionState;
  isTrial: boolean;
  isExpired: boolean;
  isPaymentFailed: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  offlineGraceEndsAt: string | null;
  graceActive: boolean;
  localOnlyAfterExpiry: boolean;
  cloudSyncAllowed: boolean;
  canCreateNewBills: boolean;
  message: string;
  foundingCustomer: boolean;
  foundingEndsAt: string | null;
  intendedPaidPlanCode: PlanCode;
  source: "license-cache" | "local-cache" | "default-trial";
}

// Subscription state is consumed by the layout, banner, pages and feature gates.
// Keep one in-memory snapshot and one shared read so frequent sync events do not
// make each consumer independently drop back to a loading state.
let subscriptionSnapshotMemory: SubscriptionSnapshot | null = null;
let subscriptionSnapshotMemoryScope: string | null = null;
let subscriptionSnapshotRead: Promise<SubscriptionSnapshot> | null = null;
let subscriptionSnapshotReadScope: string | null = null;

function currentSubscriptionScopeKey() {
  const scope = getOfflineScope();
  return `${scope.tenant_id}:${scope.store_id}:${scope.device_id}`;
}

function readSubscriptionSnapshotShared() {
  const scopeKey = currentSubscriptionScopeKey();
  if (subscriptionSnapshotMemoryScope !== scopeKey) subscriptionSnapshotMemory = null;
  if (!subscriptionSnapshotRead || subscriptionSnapshotReadScope !== scopeKey) {
    subscriptionSnapshotReadScope = scopeKey;
    subscriptionSnapshotRead = getCurrentSubscriptionSnapshot()
      .then((next) => {
        if (currentSubscriptionScopeKey() === scopeKey) {
          subscriptionSnapshotMemory = next;
          subscriptionSnapshotMemoryScope = scopeKey;
        }
        return next;
      })
      .finally(() => {
        if (subscriptionSnapshotReadScope === scopeKey) {
          subscriptionSnapshotRead = null;
          subscriptionSnapshotReadScope = null;
        }
      });
  }
  return subscriptionSnapshotRead;
}

export interface FeatureDecision {
  featureName: FeatureName;
  label: string;
  allowed: boolean;
  loading: boolean;
  plan: PlanDefinition;
  requiredPlan: PlanDefinition;
  status: SubscriptionState;
  reason: string;
  upgradeRequired: boolean;
  localOnlyWarning: boolean;
  refresh: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIso(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS).toISOString();
}

async function getOrCreateDefaultTrial(): Promise<{
  trialStartedAt: string;
  trialEndsAt: string;
  offlineGraceEndsAt: string;
}> {
  await dexieDB.open();
  const scope = getOfflineScope();
  const existing = await dexieDB.settings
    .get(DEFAULT_TRIAL_KEY)
    .catch(() => undefined);
  if (
    existing &&
    existing.tenant_id === scope.tenant_id &&
    existing.store_id === scope.store_id &&
    isRecord(existing.value)
  ) {
    return {
      trialStartedAt: toIso(existing.value.trialStartedAt) ?? nowIso(),
      trialEndsAt: toIso(existing.value.trialEndsAt) ?? addDays(new Date(), 7),
      offlineGraceEndsAt:
        toIso(existing.value.offlineGraceEndsAt) ?? addDays(new Date(), 14),
    };
  }
  const now = new Date();
  const value = {
    trialStartedAt: now.toISOString(),
    trialEndsAt: addDays(now, 7),
    offlineGraceEndsAt: addDays(now, 14),
  };
  await dexieDB.settings
    .put({
      key: DEFAULT_TRIAL_KEY,
      value,
      tenant_id: scope.tenant_id,
      store_id: scope.store_id,
      updated_at: nowIso(),
    })
    .catch(() => undefined);
  return value;
}

function payloadFromRow(
  row: SubscriptionCacheRow | undefined,
): Record<string, unknown> | null {
  if (!row) return null;
  return isRecord(row.payload)
    ? row.payload
    : (row as unknown as Record<string, unknown>);
}

function latestSubscriptionRow(
  rows: SubscriptionCacheRow[],
): SubscriptionCacheRow | undefined {
  const sorted = rows.sort((a, b) =>
    String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")),
  );
  return sorted.find((row) => !isSubscriptionActionOnly(payloadFromRow(row)));
}

function isSubscriptionActionOnly(payload: Record<string, unknown> | null) {
  if (!payload) return false;
  const status = String(payload.status ?? "").toLowerCase();
  return (
    status === "upgrade_requested" ||
    payload.requestedRefresh === true ||
    payload.requestedPlanCode !== undefined
  );
}

function entitlementFeaturesFromPayload(payload: Record<string, unknown> | null): string[] | null {
  if (!payload) return null;
  const plan = isRecord(payload.plan) ? payload.plan : null;
  const candidates = [
    payload.entitledFeatures,
    payload.entitled_features,
    payload.features,
    plan?.features,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is string => typeof item === "string");
  }
  return null;
}

export async function writeSubscriptionSnapshot(
  payload: Record<string, unknown>,
): Promise<void> {
  await dexieDB.open();
  const scope = getOfflineScope();
  const now = nowIso();
  const planCode = String(
    payload.planCode ??
      payload.plan_code ??
      (isRecord(payload.plan) ? payload.plan.code : undefined) ??
      "starter",
  );
  await dexieDB.subscription_cache.put({
    id: "current",
    plan_code: planCode,
    payload,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 1,
    sync_status: "synced",
    last_modified_by: null,
  });
  emitLocalDataChanged();
}

export async function getCurrentSubscriptionSnapshot(): Promise<SubscriptionSnapshot> {
  const rows = await offlineDB
    .getAll<SubscriptionCacheRow>("subscription_cache")
    .catch(() => [] as SubscriptionCacheRow[]);
  const latest = latestSubscriptionRow(rows);
  const payload = payloadFromRow(latest);
  const now = Date.now();
  const license = await getLicenseEvaluation().catch(() => null);
  if (license?.token && license.state !== "missing") {
    const plan = getPlanForEntitlementSnapshot(license.plan, getStoredBusinessType(), license.token.features);
    const graceActive = license.state === "grace";
    const isExpired =
      license.state === "expired" || license.state === "invalid";
    const status: SubscriptionState =
      isExpired || graceActive ? "expired" : "active";
    return {
      plan,
      planCode: plan.code,
      status,
      isTrial: false,
      isExpired,
      isPaymentFailed: false,
      trialEndsAt: null,
      currentPeriodEnd: license.validUntil,
      offlineGraceEndsAt: license.offlineGraceUntil,
      graceActive,
      localOnlyAfterExpiry: license.state !== "valid",
      cloudSyncAllowed: license.cloudSyncAllowed,
      canCreateNewBills: true,
      message: license.message,
      foundingCustomer: false,
      foundingEndsAt: null,
      intendedPaidPlanCode: plan.code,
      source: "license-cache",
    };
  }

  if (!payload) {
    const trial = await getOrCreateDefaultTrial();
    const trialEnd = new Date(trial.trialEndsAt).getTime();
    const graceEnd = new Date(trial.offlineGraceEndsAt).getTime();
    const status: SubscriptionState = now <= trialEnd ? "trial" : "expired";
    const graceActive = now > trialEnd && now <= graceEnd;
    const plan = getPlanForBusinessType("starter", getStoredBusinessType());
    return {
      plan,
      planCode: plan.code,
      status,
      isTrial: status === "trial",
      isExpired: status === "expired" && !graceActive,
      isPaymentFailed: false,
      trialEndsAt: trial.trialEndsAt,
      currentPeriodEnd: trial.trialEndsAt,
      offlineGraceEndsAt: trial.offlineGraceEndsAt,
      graceActive,
      localOnlyAfterExpiry: status === "expired",
      cloudSyncAllowed: status === "trial" || graceActive,
      canCreateNewBills: true,
      message:
        status === "trial"
          ? "Starter trial active. Your old data will always stay viewable."
          : graceActive
            ? "Trial ended. Billing is in offline grace, cloud sync may be limited."
            : "Trial grace ended. Sales and data export remain available; other changes and cloud sync wait for renewal.",
      source: "default-trial",
      foundingCustomer: false,
      foundingEndsAt: null,
      intendedPaidPlanCode: plan.code,
    };
  }

  const planCode = getPlan(
    String(
      payload.planCode ?? payload.plan_code ?? latest?.plan_code ?? "starter",
    ),
  ).code;
  const plan = getPlanForEntitlementSnapshot(
    planCode,
    getStoredBusinessType(),
    entitlementFeaturesFromPayload(payload),
  );
  const rawStatus = String(payload.status ?? "active").toLowerCase();
  const status: SubscriptionState =
    rawStatus === "trial" ||
    rawStatus === "grace" ||
    rawStatus === "expired" ||
    rawStatus === "payment_failed" ||
    rawStatus === "cancelled"
      ? rawStatus
      : "active";
  const trialEndsAt = toIso(payload.trialEndsAt ?? payload.trial_ends_at);
  const currentPeriodEnd = toIso(
    payload.currentPeriodEnd ??
      payload.current_period_end ??
      payload.expiresAt ??
      payload.expires_at,
  );
  const offlineGraceEndsAt = toIso(
    payload.offlineGraceEndsAt ??
      payload.offline_grace_ends_at ??
      payload.graceEndsAt ??
      payload.grace_ends_at,
  );
  const periodEndTime = currentPeriodEnd
    ? new Date(currentPeriodEnd).getTime()
    : Number.POSITIVE_INFINITY;
  const graceEndTime = offlineGraceEndsAt
    ? new Date(offlineGraceEndsAt).getTime()
    : periodEndTime + 7 * DAY_MS;
  const timeExpired = Number.isFinite(periodEndTime) && now > periodEndTime;
  const explicitlyExpired = status === "expired" || (status === "cancelled" && timeExpired);
  const subscriptionAccessExpired = timeExpired || explicitlyExpired || status === "grace";
  const graceActive = status !== "cancelled" && subscriptionAccessExpired && now <= graceEndTime;
  const isPaymentFailed =
    status === "payment_failed" ||
    payload.paymentFailed === true ||
    payload.payment_failed === true;
  const isExpired = subscriptionAccessExpired && !graceActive;
  const localOnlyAfterExpiry =
    subscriptionAccessExpired || isPaymentFailed || payload.syncAllowed === false || payload.sync_enabled === false;
  const cloudSyncAllowed =
    !subscriptionAccessExpired &&
    !isPaymentFailed &&
    plan.features.includes("cloud_backup") &&
    payload.syncAllowed !== false &&
    payload.sync_enabled !== false;
  const canCreateNewBills =
    plan.features.includes("new_billing");
  const foundingCustomer = String(payload.provider ?? "") === "founding" || payload.foundingCustomer === true;
  const intendedPaidPlanCode = getPlan(String(payload.intendedPaidPlanCode ?? payload.intended_paid_plan_code ?? plan.code)).code;

  return {
    plan,
    planCode: plan.code,
    status,
    isTrial: status === "trial",
    isExpired,
    isPaymentFailed,
    trialEndsAt,
    currentPeriodEnd,
    offlineGraceEndsAt,
    graceActive,
    localOnlyAfterExpiry,
    cloudSyncAllowed,
    canCreateNewBills,
    message: isPaymentFailed
      ? "Payment failed. Sales and data export stay available; other changes and cloud sync are locked."
      : isExpired
        ? "Subscription expired. You can still finish sales, bill again, and export your data; other changes and cloud sync are locked."
        : graceActive
          ? "Subscription is in offline grace. Billing can continue locally, but cloud sync may be limited."
          : status === "cancelled"
            ? "Subscription cancelled. Paid access remains available until the current period ends."
            : status === "trial"
              ? "Trial active. Your data is safe locally and can be backed up when sync is allowed."
              : "Subscription active. Cloud backup and allowed plan features are available.",
    source: "local-cache",
    foundingCustomer,
    foundingEndsAt: foundingCustomer ? trialEndsAt : null,
    intendedPaidPlanCode,
  };
}

export async function writeSubscriptionRequest(
  planCode: PlanCode,
): Promise<void> {
  await dexieDB.open();
  const scope = getOfflineScope();
  const now = nowIso();
  await dexieDB.subscription_cache.put({
    id: `subscription_request_${planCode}`,
    plan_code: planCode,
    payload: {
      requestedPlanCode: planCode,
      status: "upgrade_requested",
      requestedAt: now,
    },
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 1,
    sync_status: "pending_sync",
    last_modified_by: null,
  });
  emitLocalDataChanged();
}

export function decideFeature(
  snapshot: SubscriptionSnapshot,
  featureName: FeatureName,
): Omit<FeatureDecision, "loading" | "refresh"> {
  const requiredPlan = getRequiredPlanForFeature(featureName, getStoredBusinessType());
  const label = FEATURE_LABELS[featureName] ?? featureName;

  if (featureName === "view_old_data") {
    return {
      featureName,
      label,
      allowed: true,
      plan: snapshot.plan,
      requiredPlan,
      status: snapshot.status,
      reason: "Old data is always viewable.",
      upgradeRequired: false,
      localOnlyWarning: false,
    };
  }

  if (
    featureName === "cloud_backup" ||
    featureName === "automatic_two_way_sync"
  ) {
    const planAllows =
      snapshot.plan.features.includes(featureName) ||
      (featureName === "automatic_two_way_sync" &&
        snapshot.plan.features.includes("cloud_backup"));
    const allowed = planAllows && snapshot.cloudSyncAllowed;
    return {
      featureName,
      label,
      allowed,
      plan: snapshot.plan,
      requiredPlan,
      status: snapshot.status,
      reason: allowed
        ? "Cloud backup is available."
        : snapshot.localOnlyAfterExpiry
          ? "Cloud sync is disabled. Data remains safe locally."
          : `${label} requires ${requiredPlan.name}.`,
      upgradeRequired: !planAllows,
      localOnlyWarning: snapshot.localOnlyAfterExpiry,
    };
  }

  if (featureName === "new_billing") {
    const allowed = snapshot.canCreateNewBills;
    return {
      featureName,
      label,
      allowed,
      plan: snapshot.plan,
      requiredPlan,
      status: snapshot.status,
      reason: allowed
        ? "Billing is available offline."
        : "Old data remains viewable, but new billing is blocked after expiry/grace until renewal.",
      upgradeRequired: false,
      localOnlyWarning: snapshot.localOnlyAfterExpiry,
    };
  }

  const planAllows = snapshot.plan.features.includes(featureName);
  const subscriptionLocked =
    snapshot.isExpired || snapshot.isPaymentFailed || snapshot.localOnlyAfterExpiry;
  const allowed = planAllows && !subscriptionLocked;
  return {
    featureName,
    label,
    allowed,
    plan: snapshot.plan,
    requiredPlan,
    status: snapshot.status,
    reason: allowed
      ? `${label} is included in ${snapshot.plan.name}.`
      : subscriptionLocked
        ? "Renew subscription to use this action. Old data is still viewable."
        : `${label} requires ${requiredPlan.name}.`,
    upgradeRequired: !planAllows,
    localOnlyWarning: snapshot.localOnlyAfterExpiry,
  };
}

export function useSubscriptionSnapshot() {
  const sameScopeSnapshot = subscriptionSnapshotMemoryScope === currentSubscriptionScopeKey() ? subscriptionSnapshotMemory : null;
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | null>(() => sameScopeSnapshot);
  const [loading, setLoading] = useState(() => sameScopeSnapshot === null);

  const refresh = useCallback(async () => {
    const scopeKey = currentSubscriptionScopeKey();
    // Background refreshes retain the last trustworthy snapshot. This avoids
    // flashing loading screens and temporarily locking feature-gated content.
    if (!subscriptionSnapshotMemory) setLoading(true);
    try {
      const next = await readSubscriptionSnapshotShared();
      if (currentSubscriptionScopeKey() === scopeKey) setSnapshot(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    const unsubscribeBusinessType = subscribeToBusinessType(handler);
    window.addEventListener("kirana:local-data-changed", handler);
    window.addEventListener("kirana:sync-queue-updated", handler);
    return () => {
      unsubscribeBusinessType();
      window.removeEventListener("kirana:local-data-changed", handler);
      window.removeEventListener("kirana:sync-queue-updated", handler);
    };
  }, [refresh]);

  return { snapshot, loading, refresh };
}

export function useFeature(featureName: FeatureName): FeatureDecision {
  const { snapshot, loading, refresh } = useSubscriptionSnapshot();
  return useMemo(() => {
    const safeSnapshot = snapshot ?? {
      plan: getPlanForBusinessType("starter", getStoredBusinessType()),
      planCode: "starter" as PlanCode,
      status: "trial" as SubscriptionState,
      isTrial: true,
      isExpired: false,
      isPaymentFailed: false,
      trialEndsAt: null,
      currentPeriodEnd: null,
      offlineGraceEndsAt: null,
      graceActive: false,
      localOnlyAfterExpiry: false,
      cloudSyncAllowed: true,
      canCreateNewBills: true,
      message: "Checking subscription...",
      foundingCustomer: false,
      foundingEndsAt: null,
      intendedPaidPlanCode: "starter" as PlanCode,
      source: "default-trial" as const,
    };
    return { ...decideFeature(safeSnapshot, featureName), loading, refresh };
  }, [featureName, loading, refresh, snapshot]);
}
