import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetShop } from "@/lib/api/client";
import { getGetShopQueryKey } from "@/features/core/settings/queries";
import { updateShop } from "@/features/core/settings/api";
import {
  BUSINESS_TYPE_DEFS,
  getStoredBusinessType,
  isBusinessType,
  saveBusinessType,
} from "@/features/core/settings/business-types";

// One reconcile per shop per app load — the shop id guard also covers switching
// accounts on the same device without a full page reload.
let reconciledShopId: string | null = null;

/**
 * Keeps the business vertical in sync with the shop profile on the server
 * (Shop.settingsJson → storeProfile.businessTypeKey).
 *
 * - Server has a vertical → it wins (multi-device / reinstall consistency).
 * - Server has none yet (shop registered before the vertical was synced, or
 *   picked at registration on this device) → push the local choice up once.
 */
export function useBusinessTypeServerSync() {
  const shop = useGetShop();
  const queryClient = useQueryClient();
  const shopId = shop.data?.id ?? null;
  const raw = shop.data?.settingsJson;

  useEffect(() => {
    if (!shopId || raw == null || reconciledShopId === shopId) return;
    reconciledShopId = shopId;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") parsed = {};
    } catch {
      return; // malformed blob — leave it to the settings module
    }

    const storeProfile = (parsed.storeProfile ?? {}) as Record<string, unknown>;
    const serverKey = storeProfile.businessTypeKey;

    if (isBusinessType(serverKey)) {
      if (serverKey !== getStoredBusinessType()) saveBusinessType(serverKey);
      return;
    }

    const local = getStoredBusinessType();
    const next = {
      ...parsed,
      storeProfile: {
        ...storeProfile,
        businessTypeKey: local,
        businessType: BUSINESS_TYPE_DEFS[local].label,
      },
    };
    void updateShop({ settingsJson: JSON.stringify(next) })
      .then((updated) => {
        queryClient.setQueryData(getGetShopQueryKey(), updated);
      })
      .catch(() => {
        reconciledShopId = null; // offline — retry on next mount / shop refetch
      });
  }, [shopId, raw, queryClient]);
}
