import { database as db } from "../../infrastructure/database/index.js";
import { AppError } from "../../shared/errors/index.js";
import { AUDIT_MODULES, createAuditLog } from "../audit/audit.service.js";
import { BUSINESS_PROFILES, bootstrapForShop, businessTypeFromSettings, parseShopSettings, requestedBusinessTypeFromSettings, settingsForBusinessType } from "./businessProfiles.js";

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
    // The stored shop is read server-owned-first; the incoming payload is read
    // as a request, so the owner's new choice is not overruled by the old value
    // it travelled next to. See `requestedBusinessTypeFromSettings`.
    const nextType = requestedBusinessTypeFromSettings(nextSettings);
    const capabilitiesChanged = JSON.stringify(beforeSettings.businessProfile?.capabilities ?? null)
      !== JSON.stringify(nextSettings.businessProfile?.capabilities ?? null);
    if (capabilitiesChanged && actor.role !== "owner") {
      throw new AppError("Only the shop owner can change business capabilities", 403, "OWNER_REQUIRED");
    }
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
    }
    // Engine, profile version and capabilities are server-owned. Preserve other
    // preference keys, but always rebuild profile metadata from the catalog.
    data = { ...data, settingsJson: JSON.stringify(settingsForBusinessType(nextType, nextSettings)) };
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

const COMPATIBLE_PROFILE_CHANGES = new Set([
  "clothing:footwear", "footwear:clothing",
  "kirana:other", "stationery:other", "cosmetics:other", "furniture:other",
]);

export async function getBusinessTypeCompatibility(shopId, targetBusinessType, actor = {}) {
  const shop = await getShop(shopId);
  const settings = parseShopSettings(shop.settingsJson);
  const currentBusinessType = businessTypeFromSettings(settings);
  const target = BUSINESS_PROFILES[targetBusinessType];
  if (!target) throw new AppError("Select a supported business type", 422, "INVALID_BUSINESS_TYPE");
  const [productCount, billCount, lotCount] = await Promise.all([
    db.product.count({ where: { shopId } }),
    db.bill.count({ where: { shopId } }),
    db.inventoryLot.count({ where: { shopId } }),
  ]);
  const current = BUSINESS_PROFILES[currentBusinessType];
  const disabledCapabilities = current.capabilities.filter((capability) => !target.capabilities.includes(capability));
  const enabledCapabilities = target.capabilities.filter((capability) => !current.capabilities.includes(capability));
  const hasMeaningfulData = productCount + billCount + lotCount > 0;
  const compatibilityKey = `${currentBusinessType}:${targetBusinessType}`;
  const sameProfile = currentBusinessType === targetBusinessType;
  const migrationSupported = sameProfile || COMPATIBLE_PROFILE_CHANGES.has(compatibilityKey);
  const result = {
    currentBusinessType,
    targetBusinessType,
    currentEngine: current.engine,
    targetEngine: target.engine,
    counts: { products: productCount, bills: billCount, inventoryLots: lotCount },
    disabledCapabilities,
    enabledCapabilities,
    canApplyImmediately: !hasMeaningfulData,
    migrationSupported,
    decision: sameProfile ? "NO_CHANGE" : !hasMeaningfulData ? "SAFE_BEFORE_TRANSACTIONS" : migrationSupported ? "REVIEWED_MIGRATION_REQUIRED" : "NEW_SHOP_REQUIRED",
  };
  await createAuditLog({
    shopId,
    userId: actor.userId ?? null,
    module: AUDIT_MODULES.SETTINGS,
    action: "BUSINESS_TYPE_CHANGE_REVIEWED",
    entityType: "shop",
    entityId: shopId,
    metadata: result,
    req: actor.req ?? null,
  });
  return result;
}

export async function updateSetupStatus(shopId, status, actor = {}) {
  const shop = await getShop(shopId);
  const settings = parseShopSettings(shop.settingsJson);
  const businessType = businessTypeFromSettings(settings);
  const next = settingsForBusinessType(businessType, settings);
  next.businessProfile.setupStatus = status;
  const updated = await db.shop.update({ where: { id: shopId }, data: { settingsJson: JSON.stringify(next) } });
  await createAuditLog({
    shopId,
    userId: actor.userId ?? null,
    module: AUDIT_MODULES.SETTINGS,
    action: "SHOP_SETUP_STATUS_CHANGED",
    entityType: "shop",
    entityId: shopId,
    before: { setupStatus: settings.businessProfile?.setupStatus ?? "pending" },
    after: { setupStatus: status },
    req: actor.req ?? null,
  });
  return bootstrapForShop(updated, actor.role ?? null);
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
