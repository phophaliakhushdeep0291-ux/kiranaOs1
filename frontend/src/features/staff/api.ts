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
