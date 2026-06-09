import { useMemo } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { useFeature } from "@/features/subscription";

export const STAFF_ROLES = ["owner", "manager", "cashier", "viewer"] as const;
export type StaffRole = typeof STAFF_ROLES[number];

export const POS_PERMISSIONS = [
  "create_bill",
  "cancel_bill",
  "record_payment",
  "reverse_payment",
  "view_reports",
  "manage_products",
  "manage_customers",
  "manage_inventory",
  "manage_staff",
  "export_data",
  "change_settings",
  "view_profit",
  "apply_discount",
  "sell_below_minimum_price",
] as const;

export type PermissionName = typeof POS_PERMISSIONS[number];

export const PERMISSION_LABELS: Record<PermissionName, string> = {
  create_bill: "Create bill",
  cancel_bill: "Cancel bill",
  record_payment: "Record payment",
  reverse_payment: "Reverse payment",
  view_reports: "View reports",
  manage_products: "Manage products",
  manage_customers: "Manage customers",
  manage_inventory: "Manage inventory",
  manage_staff: "Manage staff",
  export_data: "Export data",
  change_settings: "Change settings",
  view_profit: "View profit",
  apply_discount: "Apply discount",
  sell_below_minimum_price: "Sell below minimum price",
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  viewer: "Viewer",
};

export const ROLE_PERMISSIONS: Record<StaffRole, PermissionName[]> = {
  owner: [...POS_PERMISSIONS],
  manager: [
    "create_bill",
    "cancel_bill",
    "record_payment",
    "reverse_payment",
    "view_reports",
    "manage_products",
    "manage_customers",
    "manage_inventory",
    "export_data",
    "change_settings",
    "view_profit",
    "apply_discount",
  ],
  cashier: ["create_bill", "record_payment", "manage_customers", "apply_discount"],
  viewer: ["view_reports"],
};

export const OWNER_PIN_REQUIRED_PERMISSIONS: PermissionName[] = [
  "cancel_bill",
  "reverse_payment",
  "manage_inventory",
  "export_data",
  "manage_staff",
  "sell_below_minimum_price",
];

export function normalizeStaffRole(role: string | null | undefined): StaffRole {
  const normalized = String(role ?? "owner").trim().toLowerCase();
  if (normalized === "owner") return "owner";
  if (normalized === "manager") return "manager";
  if (normalized === "cashier" || normalized === "staff") return "cashier";
  if (normalized === "viewer" || normalized === "read_only" || normalized === "readonly") return "viewer";
  return "cashier";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function userOverrides(user: unknown): PermissionName[] {
  if (typeof user !== "object" || user === null || Array.isArray(user)) return [];
  const record = user as Record<string, unknown>;
  return readStringArray(record.permissions).filter((item): item is PermissionName => POS_PERMISSIONS.includes(item as PermissionName));
}

export function permissionsForRole(role: StaffRole, overrides?: PermissionName[]): PermissionName[] {
  if (role === "owner") return [...POS_PERMISSIONS];
  const base = ROLE_PERMISSIONS[role] ?? [];
  return Array.from(new Set([...(overrides ?? base)]));
}

export function hasPermission(role: StaffRole, permission: PermissionName, overrides?: PermissionName[]): boolean {
  if (role === "owner") return true;
  const effective = overrides && overrides.length > 0 ? overrides : ROLE_PERMISSIONS[role];
  return effective.includes(permission);
}

export interface PermissionDecision {
  permission: PermissionName;
  label: string;
  role: StaffRole;
  allowed: boolean;
  loading: boolean;
  reason: string;
  requiresOwnerPin: boolean;
  subscriptionAllowed: boolean;
}

export function usePermission(permission: PermissionName): PermissionDecision {
  const { user } = useAuth();
  const staffFeature = useFeature("staff_login");

  return useMemo(() => {
    const role = normalizeStaffRole(user?.role);
    const overrides = userOverrides(user);
    const subscriptionAllowed = role === "owner" || staffFeature.allowed;
    const roleAllowed = hasPermission(role, permission, overrides);
    const allowed = subscriptionAllowed && roleAllowed;
    const reason = allowed
      ? "Allowed"
      : !subscriptionAllowed
        ? "Staff login and role-based access need the Growth plan or above."
        : `${ROLE_LABELS[role]} cannot ${PERMISSION_LABELS[permission].toLowerCase()}.`;
    return {
      permission,
      label: PERMISSION_LABELS[permission],
      role,
      allowed,
      loading: staffFeature.loading,
      reason,
      requiresOwnerPin: OWNER_PIN_REQUIRED_PERMISSIONS.includes(permission),
      subscriptionAllowed,
    };
  }, [permission, staffFeature.allowed, staffFeature.loading, user]);
}

export function permissionDeniedMessage(permission: PermissionName, role: StaffRole): string {
  return `${ROLE_LABELS[role]} does not have permission to ${PERMISSION_LABELS[permission].toLowerCase()}. Ask the owner to approve this action.`;
}
