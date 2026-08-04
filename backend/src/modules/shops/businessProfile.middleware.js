import { database as db } from "../../infrastructure/database/index.js";
import { AppError } from "../../shared/errors/index.js";
import { businessTypeFromSettings, hasCapability, parseShopSettings } from "./businessProfiles.js";

async function loadShop(req) {
  if (!req.shopId) throw new AppError("Shop context required", 400, "SHOP_CONTEXT_REQUIRED");
  const shop = await db.shop.findUnique({ where: { id: req.shopId }, select: { id: true, settingsJson: true } });
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
  return shop;
}

export function requireCapability(capability) {
  return async (req, _res, next) => {
    try {
      const shop = await loadShop(req);
      if (!hasCapability(shop, capability)) {
        throw new AppError(`${capabilityLabel(capability)} is not enabled for this shop`, 403, "FEATURE_NOT_AVAILABLE");
      }
      req.shopCapability = capability;
      next();
    } catch (error) { next(error); }
  };
}

export function requireBusinessType(...allowedTypes) {
  return async (req, _res, next) => {
    try {
      const shop = await loadShop(req);
      const businessType = businessTypeFromSettings(parseShopSettings(shop.settingsJson));
      if (!allowedTypes.includes(businessType)) {
        throw new AppError("This workflow is not available for this business profile", 403, "FEATURE_NOT_AVAILABLE");
      }
      req.businessType = businessType;
      next();
    } catch (error) { next(error); }
  };
}

function capabilityLabel(capability) {
  const labels = {
    BATCH_TRACKING: "Batch management",
    EXPIRY_TRACKING: "Expiry tracking",
    SERIAL_TRACKING: "Serial number tracking",
    PRODUCT_VARIANTS: "Product variants",
    TABLE_MANAGEMENT: "Table management",
    KOT: "Kitchen order tickets",
  };
  return labels[capability] ?? capability.toLowerCase().replace(/_/g, " ");
}
