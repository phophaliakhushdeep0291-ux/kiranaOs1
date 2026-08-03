import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { AUDIT_MODULES, createAuditLog } from "../audit/audit.service.js";
import { bootstrapForShop, businessTypeFromSettings, parseShopSettings, settingsForBusinessType } from "./businessProfiles.js";

export async function getShop(shopId) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new AppError("Shop not found", 404);
  return shop;
}

export async function getBootstrap(shopId, role) {
  const shop = await getShop(shopId);
  const [productCount, billCount] = await Promise.all([
    db.product.count({ where: { shopId } }),
    db.bill.count({ where: { shopId } }),
  ]);
  return { ...bootstrapForShop(shop, role), businessTypeLocked: productCount + billCount > 0 };
}

export async function updateShop(shopId, data, actor = {}) {
  const startedAt = Date.now();
  // Read the current row first so the audit entry can carry the spec's
  // "Previous value" / "New value" pair. This PATCH is also the settings blob's
  // write path, so it is the shop's "Settings changed" event.
  const previous = await db.shop.findUnique({ where: { id: shopId } });
  if (data.settingsJson && previous) {
    const beforeSettings = parseShopSettings(previous.settingsJson);
    const nextSettings = parseShopSettings(data.settingsJson);
    const beforeType = businessTypeFromSettings(beforeSettings);
    const nextType = businessTypeFromSettings(nextSettings);
    if (beforeType !== nextType) {
      const [productCount, billCount] = await Promise.all([
        db.product.count({ where: { shopId } }),
        db.bill.count({ where: { shopId } }),
      ]);
      if (productCount + billCount > 0) {
        const error = new AppError("Business type cannot be changed after products or bills exist. Create a new shop profile or request a reviewed migration.", 409, "BUSINESS_TYPE_CHANGE_REQUIRES_MIGRATION");
        error.publicData = { currentBusinessType: beforeType, requestedBusinessType: nextType, productCount, billCount };
        throw error;
      }
      data = { ...data, settingsJson: JSON.stringify(settingsForBusinessType(nextType, nextSettings)) };
    }
  }
  const shop = await db.shop.update({ where: { id: shopId }, data });

  const changedKeys = Object.keys(data ?? {}).filter(
    (key) => !valuesMatch(previous?.[key], shop?.[key]),
  );

  if (changedKeys.length > 0) {
    await createAuditLog({
      shopId,
      userId: actor.userId ?? null,
      module: AUDIT_MODULES.SETTINGS,
      action: "SETTINGS_CHANGED",
      entityType: "shop",
      entityId: shopId,
      // Only the fields that actually moved — a full shop row (settingsJson can
      // be kilobytes) on every save would bloat the timeline it is meant to make
      // readable.
      before: pickKeys(previous, changedKeys),
      after: pickKeys(shop, changedKeys),
      metadata: { changedFields: changedKeys },
      durationMs: Date.now() - startedAt,
      req: actor.req ?? null,
    });
  }

  return shop;
}

function valuesMatch(a, b) {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function pickKeys(source, keys) {
  if (!source) return null;
  const picked = {};
  for (const key of keys) picked[key] = source[key] ?? null;
  return picked;
}
