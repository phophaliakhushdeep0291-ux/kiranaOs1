import { useMemo } from "react";
import { useAuth } from "@/features/core/auth/useAuth";
import { useFeature } from "@/features/core/subscription";
import {
  POS_PERMISSIONS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  effectivePermissions,
  hasPermission,
  isReadOnlyRole,
  normalizeStaffRole,
  serverPermissions,
  type PermissionName,
  type StaffRole,
} from "@/features/core/staff/role-access";

// The catalogue itself lives in role-access.ts, which has no React in it so the
// offline write path can read it. Everything a screen needs is re-exported here.
export {
  POS_PERMISSIONS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  hasPermission,
  isReadOnlyRole,
  normalizeStaffRole,
  type PermissionName,
  type StaffRole,
};

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

export const OWNER_PIN_REQUIRED_PERMISSIONS: PermissionName[] = [
  "cancel_bill",
  "reverse_payment",
  "manage_inventory",
  "export_data",
  "manage_staff",
  "sell_below_minimum_price",
];

export function permissionsForRole(role: StaffRole, granted?: PermissionName[]): PermissionName[] {
  return Array.from(new Set(effectivePermissions(role, granted)));
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
    const subscriptionAllowed = role === "owner" || staffFeature.allowed;
    const roleAllowed = hasPermission(role, permission, serverPermissions(user));
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
