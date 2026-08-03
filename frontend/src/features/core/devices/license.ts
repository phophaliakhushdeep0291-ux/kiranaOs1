import {
  dexieDB,
  offlineDB,
  type DeviceLicenseCacheRow,
} from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import {
  createLocalId,
  emitLocalDataChanged,
} from "@/lib/offline/instant-cache";
import {
  PLAN_DEFINITIONS,
  getPlan,
  type FeatureName,
  type PlanCode,
} from "@/features/core/subscription/plans";

export const OFFLINE_LICENSE_TOKEN_ID = "offline_license_token";
const CURRENT_DEVICE_ROW_ID = "current_device_registration";
const DAY_MS = 24 * 60 * 60 * 1000;

export type LicenseEvaluationState =
  | "valid"
  | "grace"
  | "expired"
  | "missing"
  | "invalid";
export type DeviceSyncStatus =
  | "synced"
  | "pending_sync"
  | "syncing"
  | "failed"
  | "conflict"
  | "local_only";
export type DeviceRecordStatus =
  | "active"
  | "pending_activation"
  | "remove_pending"
  | "removed"
  | "revoked"
  | "expired";

export interface OfflineLicenseToken {
  tenant_id: string;
  store_id: string;
  plan: PlanCode;
  features: FeatureName[];
  max_devices: number;
  valid_until: string;
  offline_grace_until: string;
  signature: string;
  issued_at?: string;
}

export interface LicenseEvaluation {
  state: LicenseEvaluationState;
  token: OfflineLicenseToken | null;
  plan: PlanCode;
  maxDevices: number;
  cloudSyncAllowed: boolean;
  billingAllowed: boolean;
  premiumActionsAllowed: boolean;
  message: string;
  validUntil: string | null;
  offlineGraceUntil: string | null;
}

export interface DeviceRegistration {
  id: string;
  device_id: string;
  device_name: string;
  tenant_id: string;
  store_id: string;
  status: DeviceRecordStatus;
  sync_status: DeviceSyncStatus;
  is_current_device: boolean;
  activated_at: string;
  last_active_at: string;
  removed_at?: string | null;
  owner_action_required?: boolean;
  notes?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFeatureName(value: string): value is FeatureName {
  return (
    Object.prototype.hasOwnProperty.call(
      PLAN_DEFINITIONS.starter.features.reduce<Record<string, true>>(
        (acc, item) => ({ ...acc, [item]: true }),
        {},
      ),
      value,
    ) ||
    Object.values(PLAN_DEFINITIONS).some((plan) =>
      plan.features.includes(value as FeatureName),
    )
  );
}

function normalizeFeatures(value: unknown, plan: PlanCode): FeatureName[] {
  if (Array.isArray(value)) {
    const features = value.filter(
      (item): item is FeatureName =>
        typeof item === "string" && isFeatureName(item),
    );
    if (features.length > 0) return features;
  }
  if (isRecord(value)) {
    const features = Object.entries(value)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => key)
      .filter(isFeatureName);
    if (features.length > 0) return features;
  }
  return PLAN_DEFINITIONS[plan].features;
}

function normalizePlan(value: unknown): PlanCode {
  return typeof value === "string" && value in PLAN_DEFINITIONS
    ? (value as PlanCode)
    : "starter";
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) && numeric > 0
    ? Math.floor(numeric)
    : fallback;
}

export function parseOfflineLicenseToken(
  value: unknown,
): OfflineLicenseToken | null {
  if (!isRecord(value)) return null;
  const plan = normalizePlan(value.plan ?? value.plan_code ?? value.planCode);
  const validUntil = normalizeIso(
    value.valid_until ??
      value.validUntil ??
      value.expires_at ??
      value.expiresAt,
  );
  const offlineGraceUntil = normalizeIso(
    value.offline_grace_until ?? value.offlineGraceUntil,
  );
  const signature =
    typeof value.signature === "string" ? value.signature.trim() : "";
  const tenantId =
    typeof value.tenant_id === "string"
      ? value.tenant_id
      : typeof value.tenantId === "string"
        ? value.tenantId
        : getOfflineScope().tenant_id;
  const storeId =
    typeof value.store_id === "string"
      ? value.store_id
      : typeof value.storeId === "string"
        ? value.storeId
        : getOfflineScope().store_id;

  if (!validUntil || !offlineGraceUntil || signature.length === 0) return null;

  return {
    tenant_id: tenantId,
    store_id: storeId,
    plan,
    features: normalizeFeatures(value.features, plan),
    max_devices: normalizePositiveNumber(
      value.max_devices ?? value.maxDevices,
      PLAN_DEFINITIONS[plan].maxDevices,
    ),
    valid_until: validUntil,
    offline_grace_until: offlineGraceUntil,
    signature,
    issued_at: normalizeIso(value.issued_at ?? value.issuedAt) ?? undefined,
  };
}

export function evaluateOfflineLicenseToken(
  token: OfflineLicenseToken | null,
  now: Date = new Date(),
): LicenseEvaluation {
  if (!token) {
    const plan = getPlan("starter");
    return {
      state: "missing",
      token: null,
      plan: "starter",
      maxDevices: plan.maxDevices,
      cloudSyncAllowed: false,
      billingAllowed: true,
      premiumActionsAllowed: false,
      message:
        "No offline license is cached yet. Old data is viewable; Starter offline billing remains available during trial/grace policy.",
      validUntil: null,
      offlineGraceUntil: null,
    };
  }

  const validUntilMs = new Date(token.valid_until).getTime();
  const graceUntilMs = new Date(token.offline_grace_until).getTime();
  if (
    !Number.isFinite(validUntilMs) ||
    !Number.isFinite(graceUntilMs) ||
    token.signature.trim().length === 0
  ) {
    return {
      state: "invalid",
      token,
      plan: token.plan,
      maxDevices: token.max_devices,
      cloudSyncAllowed: false,
      billingAllowed: false,
      premiumActionsAllowed: false,
      message:
        "Cached license is invalid. Old data is viewable, but new billing and premium actions need license refresh.",
      validUntil: token.valid_until,
      offlineGraceUntil: token.offline_grace_until,
    };
  }

  const nowMs = now.getTime();
  if (nowMs <= validUntilMs) {
    return {
      state: "valid",
      token,
      plan: token.plan,
      maxDevices: token.max_devices,
      cloudSyncAllowed: token.features.includes("cloud_backup"),
      billingAllowed:
        token.features.includes("new_billing") ||
        token.features.includes("basic_billing"),
      premiumActionsAllowed: true,
      message: "License active. App works according to your current plan.",
      validUntil: token.valid_until,
      offlineGraceUntil: token.offline_grace_until,
    };
  }

  if (nowMs <= graceUntilMs) {
    return {
      state: "grace",
      token,
      plan: token.plan,
      maxDevices: token.max_devices,
      cloudSyncAllowed: false,
      billingAllowed: true,
      premiumActionsAllowed: false,
      message:
        "License expired, but offline grace is active. Billing can continue locally with warnings; cloud sync and premium actions are blocked.",
      validUntil: token.valid_until,
      offlineGraceUntil: token.offline_grace_until,
    };
  }

  return {
    state: "expired",
    token,
    plan: token.plan,
    maxDevices: token.max_devices,
    cloudSyncAllowed: false,
    billingAllowed: false,
    premiumActionsAllowed: false,
    message:
      "Offline grace expired. Old data stays viewable, but new billing and premium actions are restricted until license refresh.",
    validUntil: token.valid_until,
    offlineGraceUntil: token.offline_grace_until,
  };
}

function payloadFromRow(row: DeviceLicenseCacheRow): Record<string, unknown> {
  return isRecord(row.payload)
    ? row.payload
    : (row as unknown as Record<string, unknown>);
}

export async function readOfflineLicenseToken(): Promise<OfflineLicenseToken | null> {
  await dexieDB.open();
  const row = await dexieDB.device_license_cache
    .get(OFFLINE_LICENSE_TOKEN_ID)
    .catch(() => undefined);
  return parseOfflineLicenseToken(row ? payloadFromRow(row) : null);
}

export async function writeOfflineLicenseToken(
  token: OfflineLicenseToken,
  source = "local-cache",
): Promise<void> {
  await dexieDB.open();
  const now = nowIso();
  const scope = getOfflineScope();
  await dexieDB.device_license_cache.put({
    id: OFFLINE_LICENSE_TOKEN_ID,
    device_fingerprint: scope.device_id,
    status: evaluateOfflineLicenseToken(token).state,
    plan_code: token.plan,
    payload: { ...token, source },
    tenant_id: token.tenant_id,
    store_id: token.store_id,
    device_id: scope.device_id,
    created_at: token.issued_at ?? now,
    updated_at: now,
    deleted_at: null,
    version: 1,
    sync_status: "synced",
    last_modified_by: null,
  });
  emitLocalDataChanged();
}

export async function getLicenseEvaluation(): Promise<LicenseEvaluation> {
  return evaluateOfflineLicenseToken(await readOfflineLicenseToken());
}

export function createStarterOfflineLicense(
  daysValid = 7,
  graceDays = 7,
): OfflineLicenseToken {
  const scope = getOfflineScope();
  const now = new Date();
  const plan = getPlan("starter");
  return {
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    plan: plan.code,
    features: plan.features,
    max_devices: plan.maxDevices,
    valid_until: new Date(now.getTime() + daysValid * DAY_MS).toISOString(),
    offline_grace_until: new Date(
      now.getTime() + (daysValid + graceDays) * DAY_MS,
    ).toISOString(),
    signature: "frontend-demo-cache-not-backend-trust",
    issued_at: now.toISOString(),
  };
}

function deviceRowToRegistration(
  row: DeviceLicenseCacheRow,
): DeviceRegistration | null {
  if (row.id === OFFLINE_LICENSE_TOKEN_ID) return null;
  const payload = payloadFromRow(row);
  const scope = getOfflineScope();
  const deviceId =
    typeof payload.device_id === "string"
      ? payload.device_id
      : typeof row.device_fingerprint === "string"
        ? row.device_fingerprint
        : row.id;
  const statusRaw =
    typeof payload.status === "string"
      ? payload.status
      : typeof row.status === "string"
        ? row.status
        : "active";
  const validStatuses: DeviceRecordStatus[] = [
    "active",
    "pending_activation",
    "remove_pending",
    "removed",
    "revoked",
    "expired",
  ];
  const status = validStatuses.includes(statusRaw as DeviceRecordStatus)
    ? (statusRaw as DeviceRecordStatus)
    : "active";
  return {
    id: row.id,
    device_id: deviceId,
    device_name:
      typeof payload.device_name === "string"
        ? payload.device_name
        : typeof payload.deviceName === "string"
          ? payload.deviceName
          : deviceId,
    tenant_id:
      typeof row.tenant_id === "string" ? row.tenant_id : scope.tenant_id,
    store_id: typeof row.store_id === "string" ? row.store_id : scope.store_id,
    status,
    sync_status:
      typeof row.sync_status === "string"
        ? (row.sync_status as DeviceSyncStatus)
        : "synced",
    is_current_device: deviceId === scope.device_id,
    activated_at:
      normalizeIso(
        payload.activated_at ?? payload.activatedAt ?? row.created_at,
      ) ?? nowIso(),
    last_active_at:
      normalizeIso(
        payload.last_active_at ?? payload.lastActiveAt ?? row.updated_at,
      ) ?? nowIso(),
    removed_at: normalizeIso(
      payload.removed_at ?? payload.removedAt ?? row.deleted_at,
    ),
    owner_action_required: payload.owner_action_required === true,
    notes: typeof payload.notes === "string" ? payload.notes : null,
  };
}

export async function listCachedDevices(): Promise<DeviceRegistration[]> {
  const rows = await offlineDB
    .getAll<DeviceLicenseCacheRow>("device_license_cache")
    .catch(() => [] as DeviceLicenseCacheRow[]);
  return rows
    .filter((row) => row.id !== OFFLINE_LICENSE_TOKEN_ID)
    .map(deviceRowToRegistration)
    .filter((device): device is DeviceRegistration => device !== null)
    .sort((a, b) => b.last_active_at.localeCompare(a.last_active_at));
}

export async function ensureCurrentDeviceRegistered(
  deviceName?: string,
): Promise<DeviceRegistration> {
  await dexieDB.open();
  const scope = getOfflineScope();
  const now = nowIso();
  const existing = await dexieDB.device_license_cache
    .get(CURRENT_DEVICE_ROW_ID)
    .catch(() => undefined);
  const payload = isRecord(existing?.payload) ? existing.payload : {};
  const sameScope = existing?.tenant_id === scope.tenant_id
    && existing?.store_id === scope.store_id
    && existing?.device_fingerprint === scope.device_id;
  const previousStatus = sameScope && typeof payload.status === "string"
    ? payload.status
    : "pending_activation";
  const status: DeviceRecordStatus = previousStatus === "active"
    ? "active"
    : "pending_activation";
  const row: DeviceLicenseCacheRow = {
    id: CURRENT_DEVICE_ROW_ID,
    device_fingerprint: scope.device_id,
    status,
    payload: {
      ...payload,
      device_id: scope.device_id,
      device_name:
        deviceName ??
        (typeof payload.device_name === "string"
          ? payload.device_name
          : "This device"),
      status,
      activated_at:
        typeof payload.activated_at === "string" ? payload.activated_at : now,
      last_active_at: now,
    },
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    version: existing?.version ?? 1,
    sync_status: existing?.sync_status ?? "synced",
    last_modified_by: null,
  };
  await dexieDB.device_license_cache.put(row);
  return deviceRowToRegistration(row) as DeviceRegistration;
}

export async function markCurrentDeviceActivated(deviceName?: string): Promise<DeviceRegistration> {
  const registration = await ensureCurrentDeviceRegistered(deviceName);
  const now = nowIso();
  const existing = await dexieDB.device_license_cache.get(CURRENT_DEVICE_ROW_ID);
  if (!existing) throw new Error("Current device registration could not be persisted");
  const payload = isRecord(existing?.payload) ? existing.payload : {};
  const row: DeviceLicenseCacheRow = {
    ...existing,
    status: "active",
    payload: { ...payload, status: "active", last_active_at: now },
    updated_at: now,
    sync_status: "synced",
  };
  await dexieDB.device_license_cache.put(row);
  return deviceRowToRegistration(row) ?? registration;
}

export async function createPendingDeviceRegistration(
  deviceName: string,
): Promise<DeviceRegistration> {
  await dexieDB.open();
  const scope = getOfflineScope();
  const now = nowIso();
  const id = createLocalId("device");
  const row: DeviceLicenseCacheRow = {
    id,
    device_fingerprint: id,
    status: "pending_activation",
    payload: {
      device_id: id,
      device_name: deviceName.trim(),
      status: "pending_activation",
      activated_at: now,
      last_active_at: now,
      owner_action_required: true,
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
  };
  await dexieDB.device_license_cache.put(row);
  emitLocalDataChanged();
  return deviceRowToRegistration(row) as DeviceRegistration;
}

export async function markDeviceRemovePending(
  deviceId: string,
  ownerPin: string,
): Promise<DeviceRegistration> {
  if (ownerPin.trim().length < 4)
    throw new Error("Owner PIN is required to remove a device.");
  await dexieDB.open();
  const now = nowIso();
  const row = await dexieDB.device_license_cache.get(deviceId);
  if (!row) throw new Error("Device not found in local license cache.");
  const payload = payloadFromRow(row);
  const updated: DeviceLicenseCacheRow = {
    ...row,
    status: "remove_pending",
    payload: {
      ...payload,
      status: "remove_pending",
      removed_at: now,
      owner_action_required: true,
    },
    updated_at: now,
    deleted_at: now,
    sync_status: "pending_sync",
  };
  await dexieDB.device_license_cache.put(updated);
  emitLocalDataChanged();
  return deviceRowToRegistration(updated) as DeviceRegistration;
}
