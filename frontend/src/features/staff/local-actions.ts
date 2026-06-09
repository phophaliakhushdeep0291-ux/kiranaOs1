import { dexieDB, offlineDB, type OfflineRow } from "@/lib/offline/db";
import { enqueueOutboxOperation } from "@/features/sync/outbox";
import {
  createLocalId,
  emitLocalDataChanged,
} from "@/lib/offline/instant-cache";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import type { User } from "@/types/api";
import type { StaffInviteRequest } from "@/features/staff/api";
import {
  POS_PERMISSIONS,
  ROLE_PERMISSIONS,
  permissionsForRole,
  type PermissionName,
  type StaffRole,
  normalizeStaffRole,
} from "@/features/staff/permissions";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import { parseOrThrow } from "@/lib/offline/actions/utils";
import { writeAuditLog } from "@/features/audit-logs/local-actions";

export interface StaffMember extends User {
  role: StaffRole;
  permissions: PermissionName[];
  isActive: boolean;
  active?: boolean;
  lastActiveAt?: string | null;
  deactivatedAt?: string | null;
  sync_status?: string;
  deletedAt?: string | null;
  local_id?: string;
  server_id?: string;
}

export interface StaffUpsertInput {
  id?: string;
  name: string;
  mobile?: string;
  email?: string;
  password?: string;
  role: StaffRole;
  permissions?: PermissionName[];
  ownerPin?: string;
  ownerPinReason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readPermissions(value: unknown, role: StaffRole): PermissionName[] {
  if (!Array.isArray(value)) return permissionsForRole(role);
  const clean = value.filter(
    (item): item is PermissionName =>
      typeof item === "string" &&
      POS_PERMISSIONS.includes(item as PermissionName),
  );
  return clean.length > 0 ? clean : permissionsForRole(role);
}

function fromRow(row: unknown): StaffMember | null {
  if (!isRecord(row)) return null;
  const id = readString(row.id) ?? readString(row.local_id);
  const name = readString(row.name);
  if (!id || !name) return null;
  const role = normalizeStaffRole(readString(row.role));
  return {
    id,
    shopId: readString(row.shopId ?? row.shop_id),
    name,
    mobile: readString(row.mobile),
    email: readString(row.email),
    role,
    permissions: readPermissions(row.permissions, role),
    isActive:
      row.isActive !== false &&
      row.active !== false &&
      !row.deletedAt &&
      !row.deleted_at &&
      !row.deactivatedAt,
    active: row.active !== false,
    lastActiveAt: readString(row.lastActiveAt ?? row.last_active_at) ?? null,
    deactivatedAt: readString(row.deactivatedAt ?? row.deactivated_at) ?? null,
    createdAt: readString(row.createdAt ?? row.created_at),
    updatedAt: readString(row.updatedAt ?? row.updated_at),
    sync_status: readString(row.sync_status),
    deletedAt: readString(row.deletedAt ?? row.deleted_at) ?? null,
    local_id: readString(row.local_id),
    server_id: readString(row.server_id),
  };
}

function ensureOwnerPin(
  ownerPin: string | undefined,
  reason: string,
  entityId?: string,
) {
  parseOrThrow(ownerPinRequiredActionSchema, {
    action: "staff_permission_change",
    ownerPin,
    reason,
    entityId,
  });
}

async function audit(
  action: string,
  entityId: string,
  before: unknown,
  after: StaffMember,
  ownerPin?: string,
  reason?: string,
) {
  await writeAuditLog({
    action:
      action === "staff_create" || action === "staff_update"
        ? "staff_permission_change"
        : action,
    entityType: "staff",
    entityId,
    entityLabel: after.name,
    oldValue: before,
    newValue: after,
    reason: reason || action.replaceAll("_", " "),
    ownerPinProvided: Boolean(ownerPin),
    summary: `${action.replaceAll("_", " ")} for ${after.name}`,
  });
}

async function enqueueStaffAction(
  action: string,
  member: StaffMember,
  ownerPin?: string,
  reason?: string,
) {
  await enqueueOutboxOperation({
    entity_type: "staff",
    entity_id: member.id,
    operation_type: "STAFF_ACTION",
    payload: {
      action,
      staff: member,
      ownerPin,
      reason,
      ownerPinProvided: Boolean(ownerPin),
      localStaffId: member.local_id ?? member.id,
    },
    idempotency_key: `staff:${action}:${member.id}:${member.updatedAt ?? nowIso()}`,
  });
}

export async function listStaffLocalFirst(): Promise<StaffMember[]> {
  const rows = await offlineDB
    .getAll<OfflineRow>("staff_users")
    .catch(() => [] as OfflineRow[]);
  return rows
    .map(fromRow)
    .filter((row): row is StaffMember => Boolean(row))
    .sort(
      (a, b) =>
        Number(b.role === "owner") - Number(a.role === "owner") ||
        a.name.localeCompare(b.name),
    );
}

export async function createStaffLocalFirst(
  input: StaffUpsertInput,
): Promise<StaffMember> {
  ensureOwnerPin(
    input.ownerPin,
    input.ownerPinReason || "Add staff permissions",
  );
  if (!input.name.trim()) throw new Error("Staff name is required.");
  if (!input.mobile?.trim() && !input.email?.trim())
    throw new Error("Mobile or email is required.");
  const scope = getOfflineScope();
  const now = nowIso();
  const role = normalizeStaffRole(input.role);
  const id = createLocalId("staff");
  const member: StaffMember & Partial<OfflineRow> = {
    id,
    local_id: id,
    name: input.name.trim(),
    mobile: input.mobile?.trim(),
    email: input.email?.trim(),
    role,
    permissions: input.permissions?.length
      ? input.permissions
      : permissionsForRole(role),
    isActive: true,
    active: true,
    createdAt: now,
    updatedAt: now,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 1,
    sync_status: "pending_sync",
    device_id: scope.device_id,
  };
  await dexieDB.staff_users.put(member as OfflineRow);
  await audit(
    "staff_create",
    id,
    null,
    member,
    input.ownerPin,
    input.ownerPinReason,
  );
  await enqueueStaffAction(
    "create",
    member,
    input.ownerPin,
    input.ownerPinReason,
  );
  emitLocalDataChanged();
  return member;
}

export async function updateStaffLocalFirst(
  input: StaffUpsertInput & { id: string },
): Promise<StaffMember> {
  ensureOwnerPin(
    input.ownerPin,
    input.ownerPinReason || "Change staff permissions",
    input.id,
  );
  await dexieDB.open();
  const existing = await dexieDB.staff_users.get(input.id);
  if (!existing) throw new Error("Staff member not found locally.");
  const before = fromRow(existing);
  const role = normalizeStaffRole(input.role);
  const now = nowIso();
  const updated: StaffMember & Partial<OfflineRow> = {
    ...(existing as unknown as StaffMember),
    id: input.id,
    name: input.name.trim(),
    mobile: input.mobile?.trim(),
    email: input.email?.trim(),
    role,
    permissions: input.permissions?.length
      ? input.permissions
      : permissionsForRole(role),
    isActive: true,
    active: true,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync",
  };
  await dexieDB.staff_users.put(updated as OfflineRow);
  await audit(
    "staff_update",
    input.id,
    before,
    updated,
    input.ownerPin,
    input.ownerPinReason,
  );
  await enqueueStaffAction(
    "update",
    updated,
    input.ownerPin,
    input.ownerPinReason,
  );
  emitLocalDataChanged();
  return updated;
}

export async function deactivateStaffLocalFirst(
  id: string,
  ownerPin: string,
  reason?: string,
): Promise<StaffMember> {
  ensureOwnerPin(ownerPin, reason || "Deactivate staff", id);
  await dexieDB.open();
  const existing = await dexieDB.staff_users.get(id);
  if (!existing) throw new Error("Staff member not found locally.");
  const before = fromRow(existing);
  if (before?.role === "owner")
    throw new Error("Owner account cannot be deactivated from staff screen.");
  const now = nowIso();
  const updated: StaffMember & Partial<OfflineRow> = {
    ...(before ??
      fromRow(existing) ?? {
        id,
        name: String(existing.name ?? "Staff"),
        role: "cashier",
        permissions: ROLE_PERMISSIONS.cashier,
        isActive: true,
      }),
    ...existing,
    id,
    name: before?.name ?? String(existing.name ?? "Staff"),
    role:
      before?.role ?? normalizeStaffRole(String(existing.role ?? "cashier")),
    permissions: before?.permissions ?? ROLE_PERMISSIONS.cashier,
    isActive: false,
    active: false,
    deactivatedAt: now,
    deactivated_at: now,
    deleted_at: now,
    deletedAt: now,
    reason: reason ?? null,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync",
  };
  await dexieDB.staff_users.put(updated as OfflineRow);
  await audit("staff_deactivate", id, before, updated, ownerPin, reason);
  await enqueueStaffAction("deactivate", updated, ownerPin, reason);
  emitLocalDataChanged();
  return updated;
}

export async function staffActionLocalFirst(
  action: "invite" | "remove",
  payload: StaffInviteRequest | { id: string; ownerPin?: string },
): Promise<User | { success: true; pendingSync: true }> {
  if (action === "invite" && "name" in payload) {
    return createStaffLocalFirst({
      name: payload.name,
      mobile: payload.mobile,
      password: payload.password,
      role: normalizeStaffRole(payload.role),
      ownerPin: payload.ownerPin,
    }) as Promise<User>;
  }
  if ("id" in payload) {
    const ownerPin =
      "ownerPin" in payload && typeof payload.ownerPin === "string"
        ? payload.ownerPin
        : undefined;
    await deactivateStaffLocalFirst(
      payload.id,
      ownerPin ?? "",
      "Removed from settings staff list",
    );
  }
  return { success: true, pendingSync: true };
}
