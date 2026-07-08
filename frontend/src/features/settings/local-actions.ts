import { offlineDB } from "@/lib/offline/db";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import { enqueueOutboxOperation } from "@/features/sync/outbox";
import { parseOrThrow } from "@/lib/offline/actions/utils";
import type { Shop } from "@/types/api";

const SHOP_CACHE_KEY = "shop";

export async function updateSettingsLocalFirst(data: Partial<Shop> & { ownerPin?: string }): Promise<Shop> {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "change_settings", ownerPin: data.ownerPin });
  const existing = await offlineDB.getSetting<Shop>(SHOP_CACHE_KEY).catch(() => null);
  const now = new Date().toISOString();
  const shop: Shop = {
    ...existing,
    ...data,
    id: existing?.id ?? "local_shop",
    name: data.name ?? existing?.name ?? "My Shop",
    ownerName: data.ownerName ?? existing?.ownerName ?? "Owner",
    city: data.city ?? existing?.city ?? "",
    address: data.address ?? existing?.address ?? "",
    gstNumber: data.gstNumber ?? existing?.gstNumber ?? null,
    phone: data.phone ?? existing?.phone ?? null,
    settingsJson: data.settingsJson ?? existing?.settingsJson ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await offlineDB.setSetting(SHOP_CACHE_KEY, shop);
  await enqueueOutboxOperation({
    entity_type: "settings",
    entity_id: shop.id,
    operation_type: "UPDATE_SETTINGS",
    payload: { shop, ownerPin: data.ownerPin },
  });
  return shop;
}
