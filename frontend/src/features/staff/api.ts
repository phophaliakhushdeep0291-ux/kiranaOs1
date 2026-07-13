import { apiRequest } from "@/lib/api/http";
import type { User } from "@/types/api";
import type { StaffRole } from "@/features/staff/permissions";

export interface StaffInviteRequest {
  name: string;
  mobile: string;
  password: string;
  role?: StaffRole | string;
  ownerPin?: string;
  permissions?: string[];
}

export interface StaffLocationAccessRow {
  id: string;
  code: string;
  name: string;
  city?: string | null;
  isPrimary: boolean;
  assigned: boolean;
  canSell: boolean;
  canPurchase: boolean;
  canManageInventory: boolean;
  canTransfer: boolean;
}

export interface StaffLocationAssignments {
  staff: Pick<User, "id" | "name" | "mobile" | "email" | "role">;
  explicitScope: boolean;
  locations: StaffLocationAccessRow[];
}

export type StaffLocationAssignmentInput = Pick<
  StaffLocationAccessRow,
  "canSell" | "canPurchase" | "canManageInventory" | "canTransfer"
> & { locationId: string };

export function listStaff() {
  return apiRequest<User[]>("/auth/staff");
}

export function inviteStaff(data: StaffInviteRequest) {
  return apiRequest<User>("/auth/staff", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function removeStaff(id: string) {
  return apiRequest<{ success?: boolean; message?: string }>(`/auth/staff/${id}`, { method: "DELETE" });
}

export function getStaffLocationAssignments(id: string) {
  return apiRequest<StaffLocationAssignments>(`/auth/staff/${id}/locations`);
}

export function updateStaffLocationAssignments(id: string, locations: StaffLocationAssignmentInput[], ownerPin: string) {
  return apiRequest<{ assignedLocationCount: number; assignments: StaffLocationAssignments }>(`/auth/staff/${id}/locations`, {
    method: "PUT",
    body: JSON.stringify({ locations, ownerPin }),
  });
}
