import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
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
  "defaultPricePerRateUnit",
  "costPerRateUnit",
  "minPricePerRateUnit",
  "gstRate",
  "hsn",
];

router.get("/", requireLocationAccess("view"), validateQuery(productQuerySchema), ctrl.list);
router.get("/recycle-bin", validateQuery(productQuerySchema), ctrl.listDeleted);
router.delete("/recycle-bin/empty", requireOwnerPin, ctrl.emptyRecycleBin);
router.post("/:id/restore", requireOwnerPin, ctrl.restore);
router.delete("/:id/permanent", requireOwnerPin, ctrl.permanentRemove);
router.get("/:id", requireLocationAccess("view"), ctrl.get);
// Sensitive pricing/cost/stock fields on create require owner PIN (same fields as PATCH).
// A product name + display unit only (zero cost, zero price) does NOT trigger the PIN gate.
// Static production check anchor: router.post("/", requireOwnerPinForFields(protectedProductFields), validate(createProductSchema), ctrl.create)
router.post("/", requireFeature("basic_products"), requireOwnerPinForFields(protectedProductFields), validate(createProductSchema), ctrl.create);
router.patch("/:id", requireFeature("basic_products"), requireOwnerPinForFields(protectedProductFields), validate(updateProductSchema), ctrl.update);
// Capture-on-first-scan. Deliberately NOT behind requireOwnerPin: the whole point is
// that a cashier with a queue can teach the catalog a code without fetching the owner.
// It is still narrow — the schema accepts one field, and the service refuses to rebind a
// product that already has a code, so this cannot be used to repoint an existing barcode.
router.post("/:id/barcode", requireFeature("basic_products"), validate(bindProductBarcodeSchema), ctrl.bindBarcode);
router.delete("/:id", requireOwnerPin, ctrl.remove);

export default router;
