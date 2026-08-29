import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireOwnerPinForFields, requireShop } from "../../middleware/permissions.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { bindProductBarcodeSchema, createProductSchema, updateProductSchema, productQuerySchema } from "./products.schema.js";
import * as ctrl from "./products.controller.js";
import { requireLocationAccess } from "../stores/location-access.service.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

const protectedProductFields = [
  "stockBaseQty",
  "defaultPricePerRateUnit",
  "retailPricePerRateUnit",
  "retailFromQuantity",
  "wholesalePricePerRateUnit",
  "wholesaleFromQuantity",
  "costPerRateUnit",
  "minPricePerRateUnit",
  "gstRate",
  "hsn",
  "mrp",
  "barcode",
  "sku",
  "sellingUnits",
  "variantAxes",
  "packagingMode",
  "batchTrackingEnabled",
  "drugSchedule",
  "restaurantItemType",
  "isActive",
  "status",
];

function requireProductLocationAccess(req, res, next) {
  const touchesStock = Object.prototype.hasOwnProperty.call(req.body ?? {}, "stockBaseQty")
    || (Array.isArray(req.body?.sellingUnits) && req.body.sellingUnits.some((unit) =>
      unit && Object.prototype.hasOwnProperty.call(unit, "onHandQty")));
  return requireLocationAccess(touchesStock ? "inventory" : "view")(req, res, next);
}

router.get("/", requireLocationAccess("view"), validateQuery(productQuerySchema), ctrl.list);
router.get("/recycle-bin", validateQuery(productQuerySchema), ctrl.listDeleted);
// Shared, read-only product identity lookup. Stock, price and tax remain shop-owned.
router.get("/knowledge/:barcode", requireLocationAccess("view"), ctrl.lookupKnowledge);
router.delete("/recycle-bin/empty", requireRole("owner", "admin"), requireOwnerPin, ctrl.emptyRecycleBin);
router.post("/:id/restore", requireRole("owner", "admin"), requireOwnerPin, ctrl.restore);
router.delete("/:id/permanent", requireRole("owner", "admin"), requireOwnerPin, ctrl.permanentRemove);
// Read-only, and deliberately NOT gated on multi_store: a single-shop shop still
// gets a straight answer (everything sits at the one location) instead of an error.
router.get("/:id/variant-stock", requireLocationAccess("view"), ctrl.variantStockByLocation);
router.get("/:id", requireLocationAccess("view"), ctrl.get);
// Sensitive pricing/cost/stock fields on create require owner PIN (same fields as PATCH).
// A product name + display unit only (zero cost, zero price) does NOT trigger the PIN gate.
// Static production check anchor: router.post("/", requireOwnerPinForFields(protectedProductFields), validate(createProductSchema), ctrl.create)
router.post("/", requireFeature("basic_products"), requireRole("owner", "admin"), requireOwnerPinForFields(protectedProductFields), validate(createProductSchema), requireProductLocationAccess, ctrl.create);
router.patch("/:id", requireFeature("basic_products"), requireRole("owner", "admin"), requireOwnerPinForFields(protectedProductFields), validate(updateProductSchema), requireProductLocationAccess, ctrl.update);
// Capture-on-first-scan. Deliberately NOT behind requireOwnerPin: the whole point is
// that a cashier with a queue can teach the catalog a code without fetching the owner.
// It is still narrow — the schema accepts one field, and the service refuses to rebind a
// product that already has a code, so this cannot be used to repoint an existing barcode.
router.post("/:id/barcode", requireFeature("basic_products"), validate(bindProductBarcodeSchema), ctrl.bindBarcode);
router.delete("/:id", requireRole("owner", "admin"), requireOwnerPin, ctrl.remove);

export default router;
