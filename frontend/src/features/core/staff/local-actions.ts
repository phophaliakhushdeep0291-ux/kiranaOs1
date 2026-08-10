import { dexieDB, offlineDB, type OfflineRow } from "@/lib/offline/db";
import { emitLocalDataChanged } from "@/lib/offline/instant-cache";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { isRecoverableNetworkError } from "@/lib/api/http";
import type { User } from "@/types/api";
import {
  inviteStaff,
  listStaff,
  removeStaff,
  updateStaff,
  type StaffInviteRequest,
} from "@/features/core/staff/api";
import {
  POS_PERMISSIONS,
  permissionsForRole,
  type PermissionName,
  type StaffRole,
  normalizeStaffRole,
} from "@/features/core/staff/permissions";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import { parseOrThrow } from "@/lib/offline/actions/utils";

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

export interface StaffListSnapshot {
  members: StaffMember[];
  source: "server" | "cache";
  warning?: string;
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
      typeof item === "string" && POS_PERMISSIONS.includes(item as PermissionName),
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

function memberFromServer(user: User): StaffMember & OfflineRow {
  const scope = getOfflineScope();
  const now = nowIso();
  const role = normalizeStaffRole(user.role);
  const createdAt = user.createdAt ?? now;
  const updatedAt = user.updatedAt ?? now;
  return {
    ...user,
    id: user.id,
    local_id: user.id,
    server_id: user.id,
    role,
    permissions: permissionsForRole(role),
    isActive: true,
    active: true,
    createdAt,
    updatedAt,
    deletedAt: null,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
    version: 1,
    sync_status: "synced",
    last_modified_by: null,
  };
}

async function readCachedStaff(): Promise<StaffMember[]> {
  const rows = await offlineDB.getAll<OfflineRow>("staff_users").catch(() => []);
  return rows
    .map(fromRow)
    .filter((row): row is StaffMember => Boolean(row))
    .sort(
      (a, b) =>
        Number(b.role === "owner") - Number(a.role === "owner") ||
        a.name.localeCompare(b.name),
    );
}

async function replaceCachedStaff(users: User[]): Promise<StaffMember[]> {
  await dexieDB.open();
  const scope = getOfflineScope();
  const rows = users.map(memberFromServer);
  await dexieDB.transaction("rw", dexieDB.staff_users, async () => {
    const keys = await dexieDB.staff_users
      .filter((row) => row.tenant_id === scope.tenant_id && row.store_id === scope.store_id)
      .primaryKeys();
    if (keys.length > 0) await dexieDB.staff_users.bulkDelete(keys as string[]);
    if (rows.length > 0) await dexieDB.staff_users.bulkPut(rows);
  });
  emitLocalDataChanged();
  return rows.map((row) => fromRow(row) as StaffMember);
}

async function cacheServerMember(user: User): Promise<StaffMember> {
  const row = memberFromServer(user);
  await dexieDB.open();
  await dexieDB.staff_users.put(row);
  emitLocalDataChanged();
  return fromRow(row) as StaffMember;
}

export async function listStaffSnapshot(): Promise<StaffListSnapshot> {
  try {
    const users = await listStaff();
    const members = await replaceCachedStaff(users).catch(() => users.map((user) => fromRow(memberFromServer(user)) as StaffMember));
    return { members, source: "server" };
  } catch (error) {
    if (!isRecoverableNetworkError(error)) throw error;
    return {
      members: await readCachedStaff(),
      source: "cache",
      warning: "Showing the last saved staff list. Reconnect before changing accounts or permissions.",
    };
  }
}

export async function listStaffLocalFirst(): Promise<StaffMember[]> {
  return (await listStaffSnapshot()).members;
}

function ensureOwnerPin(ownerPin: string | undefined, reason: string, entityId?: string) {
  parseOrThrow(ownerPinRequiredActionSchema, {
    action: "staff_permission_change",
    ownerPin,
    reason,
    entityId,
  });
}

function serverRole(role: StaffRole): "staff" | "admin" {
  if (role === "manager") return "admin";
  if (role === "cashier") return "staff";
  throw new Error("Choose Manager or Cashier. Owner transfer and view-only accounts need a separate secured workflow.");
}

function mutationNetworkError(action: string) {
  return new Error(
    `Could not confirm the ${action} with the server. Reconnect and refresh the staff list before retrying; no unverified staff access was enabled locally.`,
  );
}

export async function createStaffLocalFirst(input: StaffUpsertInput): Promise<StaffMember> {
  ensureOwnerPin(input.ownerPin, input.ownerPinReason || "Add staff permissions");
  if (!input.name.trim()) throw new Error("Staff name is required.");
  if (!input.mobile?.trim() && !input.email?.trim()) throw new Error("Mobile or email is required.");
  if (!input.password || input.password.trim().length < 6) throw new Error("New staff login needs a password of at least 6 characters.");

  let user: User;
  try {
    user = await inviteStaff({
      name: input.name.trim(),
      mobile: input.mobile?.trim() || undefined,
      email: input.email?.trim() || undefined,
      password: input.password,
      role: serverRole(input.role),
    }, input.ownerPin!);
  } catch (error) {
    if (isRecoverableNetworkError(error)) throw mutationNetworkError("new staff account");
    throw error;
  }
  return cacheServerMember(user).catch(() => fromRow(memberFromServer(user)) as StaffMember);
}

export async function updateStaffLocalFirst(input: StaffUpsertInput & { id: string }): Promise<StaffMember> {
  ensureOwnerPin(input.ownerPin, input.ownerPinReason || "Change staff permissions", input.id);
  const cached = await dexieDB.staff_users.get(input.id).catch(() => undefined);
  const existing = fromRow(cached);
  const serverId = existing?.server_id ?? (existing?.sync_status === "synced" ? existing.id : undefined);
  if (!serverId) {
    throw new Error("This staff row was never confirmed by the server. Reconnect and refresh the staff list before editing it.");
  }
  if (!input.name.trim()) throw new Error("Staff name is required.");
  if (!input.mobile?.trim() && !input.email?.trim()) throw new Error("Mobile or email is required.");

  let user: User;
  try {
    user = await updateStaff(serverId, {
      name: input.name.trim(),
      mobile: input.mobile?.trim() || undefined,
      email: input.email?.trim() || undefined,
      password: input.password?.trim() || undefined,
      role: serverRole(input.role),
    }, input.ownerPin!);
  } catch (error) {
    if (isRecoverableNetworkError(error)) throw mutationNetworkError("staff update");
    throw error;
  }
  return cacheServerMember(user).catch(() => fromRow(memberFromServer(user)) as StaffMember);
}

export async function deactivateStaffLocalFirst(id: string, ownerPin: string, reason?: string): Promise<StaffMember> {
  ensureOwnerPin(ownerPin, reason || "Deactivate staff", id);
  const cached = await dexieDB.staff_users.get(id).catch(() => undefined);
  const before = fromRow(cached);
  if (!before) throw new Error("Staff member not found in the saved staff list.");
  if (before.role === "owner") throw new Error("Owner account cannot be deactivated from staff screen.");
  const serverId = before.server_id ?? (before.sync_status === "synced" ? before.id : undefined);
  if (!serverId) throw new Error("This staff row was never confirmed by the server. Reconnect and refresh the staff list.");

  let disabledAt = nowIso();
  try {
    const result = await removeStaff(serverId, ownerPin);
    disabledAt = result.disabledAt ?? disabledAt;
  } catch (error) {
    if (isRecoverableNetworkError(error)) throw mutationNetworkError("staff deactivation");
    throw error;
  }

  const updated: StaffMember & Partial<OfflineRow> = {
    ...before,
    isActive: false,
    active: false,
    deactivatedAt: disabledAt,
    deletedAt: disabledAt,
    deleted_at: disabledAt,
    updatedAt: disabledAt,
    updated_at: disabledAt,
    sync_status: "synced",
  };
  await dexieDB.staff_users.put(updated as OfflineRow).catch(() => undefined);
  emitLocalDataChanged();
  return updated;
}

export async function staffActionLocalFirst(
  action: "invite" | "remove",
  payload: StaffInviteRequest & { ownerPin?: string } | { id: string; ownerPin?: string },
): Promise<User | { success: true; pendingSync: false }> {
  if (action === "invite" && "name" in payload) {
    return createStaffLocalFirst({
      name: payload.name,
      mobile: payload.mobile,
      email: payload.email,
      password: payload.password,
      role: normalizeStaffRole(payload.role),
      ownerPin: payload.ownerPin,
    }) as Promise<User>;
  }
  if ("id" in payload) {
    await deactivateStaffLocalFirst(payload.id, payload.ownerPin ?? "", "Removed from settings staff list");
  }
  return { success: true, pendingSync: false };
}
