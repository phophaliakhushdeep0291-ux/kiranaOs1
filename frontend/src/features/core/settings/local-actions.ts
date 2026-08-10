import { offlineDB } from "@/lib/offline/db";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import { parseOrThrow } from "@/lib/offline/actions/utils";
import { updateShop } from "@/features/core/settings/api";
import type { Shop } from "@/types/api";

const SHOP_CACHE_KEY = "shop";

/**
 * Shop identity and cross-device settings are server-authoritative. The former
 * implementation queued UPDATE_SETTINGS as a local-only event, so it could be
 * marked synced without ever reaching another device.
 */
export async function updateSettingsLocalFirst(data: Partial<Shop> & { ownerPin?: string }): Promise<Shop> {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "change_settings", ownerPin: data.ownerPin });
  const updated = await updateShop(data);
  // A cache failure after a confirmed server update must not make the UI invite
  // a duplicate retry. The next online read will repair the local snapshot.
  await offlineDB.setSetting(SHOP_CACHE_KEY, updated).catch(() => undefined);
  return updated;
}
