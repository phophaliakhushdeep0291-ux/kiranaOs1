import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api/http";
import { getMutationOptions, getQueryOptions, type MutationHookOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as authApi from "@/features/auth/api";
import * as settingsApi from "@/features/settings/api";
import { createStaffLocalFirst, deactivateStaffLocalFirst, listStaffLocalFirst, type StaffMember } from "@/features/staff/local-actions";
import { offlineDB } from "@/lib/offline/db";
import type { Shop } from "@/types/api";

export interface UpdateShopVariables { data: Partial<Shop> & { ownerPin?: string } }
export interface InviteStaffRequest { name: string; mobile?: string; email?: string; password?: string; role?: string; ownerPin?: string }
export interface InviteStaffVariables { data: InviteStaffRequest }
export interface RemoveStaffVariables { id: string; ownerPin?: string }
export interface ChangePasswordVariables { data: authApi.ChangePasswordRequest }
export interface ChangePasswordResponse { success?: boolean; message?: string }

export const getGetShopQueryKey = () => ["shop"] as const;
export const getListStaffQueryKey = () => ["staff"] as const;

type ShopQueryKey = ReturnType<typeof getGetShopQueryKey>;
type StaffQueryKey = ReturnType<typeof getListStaffQueryKey>;

function normaliseStaffRole(role?: string): "manager" | "cashier" | "viewer" | "owner" {
  return role === "manager" || role === "cashier" || role === "viewer" || role === "owner" ? role : "cashier";
}

async function updateShopOnlineFirst(data: Partial<Shop> & { ownerPin?: string }): Promise<Shop> {
  const updated = await settingsApi.updateShop(data);
  await offlineDB.setSetting("shop", updated).catch(() => undefined);
  return updated;
}

export function useGetShop(options?: QueryHookOptions<Shop, ShopQueryKey>) {
  return useQuery<Shop, ApiClientError, Shop, ShopQueryKey>({
    queryKey: getGetShopQueryKey(),
    queryFn: () => settingsApi.getShop(),
    ...getQueryOptions<Shop, ShopQueryKey>(options),
  });
}

export function useUpdateShop(options?: MutationHookOptions<Shop, UpdateShopVariables>) {
  return useMutation<Shop, ApiClientError, UpdateShopVariables>({
    ...getMutationOptions<Shop, UpdateShopVariables>(options),
    mutationFn: ({ data }) => updateShopOnlineFirst(data),
  });
}

export function useListStaff(options?: QueryHookOptions<StaffMember[], StaffQueryKey>) {
  return useQuery<StaffMember[], ApiClientError, StaffMember[], StaffQueryKey>({
    queryKey: getListStaffQueryKey(),
    queryFn: listStaffLocalFirst,
    ...getQueryOptions<StaffMember[], StaffQueryKey>(options),
  });
}

export function useInviteStaff(options?: MutationHookOptions<StaffMember, InviteStaffVariables>) {
  return useMutation<StaffMember, ApiClientError, InviteStaffVariables>({
    ...getMutationOptions<StaffMember, InviteStaffVariables>(options),
    mutationFn: ({ data }) => createStaffLocalFirst({ ...data, role: normaliseStaffRole(data.role) }),
  });
}

export function useRemoveStaff(options?: MutationHookOptions<unknown, RemoveStaffVariables>) {
  return useMutation<unknown, ApiClientError, RemoveStaffVariables>({
    ...getMutationOptions<unknown, RemoveStaffVariables>(options),
    mutationFn: ({ id, ownerPin }) => deactivateStaffLocalFirst(id, ownerPin ?? "", "Removed from settings staff list"),
  });
}

export function useChangePassword(options?: MutationHookOptions<ChangePasswordResponse, ChangePasswordVariables>) {
  return useMutation<ChangePasswordResponse, ApiClientError, ChangePasswordVariables>({
    ...getMutationOptions<ChangePasswordResponse, ChangePasswordVariables>(options),
    mutationFn: ({ data }) => authApi.changePassword(data),
  });
}
