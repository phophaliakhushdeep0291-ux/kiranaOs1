import { database as db } from "../../infrastructure/database/index.js";
import { AppError } from "../../shared/errors/index.js";
import { AUDIT_MODULES, createAuditLog } from "../audit/audit.service.js";
import { BUSINESS_PROFILES, assertBusinessTypeOffered, bootstrapForShop, businessTypeFromSettings, parseShopSettings, requestedBusinessTypeFromSettings, settingsForBusinessType } from "./businessProfiles.js";

async function writeRequiredShopAudit(client, entry) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) throw new AppError("Shop settings change could not be audited", 503, "AUDIT_WRITE_FAILED");
  return audit;
}

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
  const requestedData = { ...(data ?? {}) };
  return db.$transaction(async (tx) => {
    const previous = await tx.shop.findUnique({ where: { id: shopId } });
    if (!previous) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");

    let nextData = requestedData;
    if (requestedData.settingsJson) {
      const beforeSettings = parseShopSettings(previous.settingsJson);
      const nextSettings = parseShopSettings(requestedData.settingsJson);
      const beforeType = businessTypeFromSettings(beforeSettings);
      const nextType = requestedBusinessTypeFromSettings(nextSettings);
      const capabilitiesChanged = JSON.stringify(beforeSettings.businessProfile?.capabilities ?? null)
        !== JSON.stringify(nextSettings.businessProfile?.capabilities ?? null);
      if (capabilitiesChanged && actor.role !== "owner") {
        throw new AppError("Only the shop owner can change business capabilities", 403, "OWNER_REQUIRED");
      }
      if (beforeType !== nextType) {
        assertBusinessTypeOffered(nextType);
        const [productCount, billCount] = await Promise.all([
          tx.product.count({ where: { shopId } }),
          tx.bill.count({ where: { shopId } }),
        ]);
        if (productCount + billCount > 0) {
          const error = new AppError("Business type cannot be changed after products or bills exist. Create a new shop profile or request a reviewed migration.", 409, "BUSINESS_TYPE_CHANGE_REQUIRES_MIGRATION");
          error.publicData = { currentBusinessType: beforeType, requestedBusinessType: nextType, productCount, billCount };
          throw error;
        }
      }
      // Profile engine/version/capabilities are server-owned catalog values.
      nextData = { ...requestedData, settingsJson: JSON.stringify(settingsForBusinessType(nextType, nextSettings)) };
    }

    const shop = await tx.shop.update({ where: { id: shopId }, data: nextData });
    const changedKeys = Object.keys(nextData).filter((key) => !valuesMatch(previous[key], shop[key]));
    if (changedKeys.length > 0) {
      await writeRequiredShopAudit(tx, {
        shopId,
        userId: actor.userId ?? null,
        module: AUDIT_MODULES.SETTINGS,
        action: "SETTINGS_CHANGED",
        entityType: "shop",
        entityId: shopId,
        before: pickKeys(previous, changedKeys),
        after: pickKeys(shop, changedKeys),
        metadata: { changedFields: changedKeys },
        durationMs: Date.now() - startedAt,
        req: actor.req ?? null,
      });
    }
    return shop;
  }, { isolationLevel: "Serializable" });
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
  await writeRequiredShopAudit(db, {
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
  const updated = await db.$transaction(async (tx) => {
    const shop = await tx.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
    const settings = parseShopSettings(shop.settingsJson);
    const businessType = businessTypeFromSettings(settings);
    const next = settingsForBusinessType(businessType, settings);
    next.businessProfile.setupStatus = status;
    const saved = await tx.shop.update({ where: { id: shopId }, data: { settingsJson: JSON.stringify(next) } });
    await writeRequiredShopAudit(tx, {
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
    return saved;
  }, { isolationLevel: "Serializable" });
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

