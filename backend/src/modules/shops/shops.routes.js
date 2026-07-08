import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPinForFields, requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { updateShopSchema } from "./shops.schema.js";
import * as ctrl from "./shops.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

// Editing the shop's legal identity (name, owner, GST, address, phone) needs the owner PIN.
// The settingsJson preferences blob (printer, GST mode, notifications, customer-QR-ordering
// opt-in — none financial) is written by a debounced background autosave that has no way to
// prompt for a PIN; gating it behind requireOwnerPin made every settings save silently 403 in
// production (OWNER_PIN_REQUIRED=true), so preferences — most visibly the customer-ordering
// flag the public catalog reads — never persisted server-side. Only PIN-gate the identity fields.
const PIN_PROTECTED_SHOP_FIELDS = ["name", "ownerName", "city", "address", "gstNumber", "phone"];

router.get("/", ctrl.getShop);
router.patch("/", requireOwnerPinForFields(PIN_PROTECTED_SHOP_FIELDS), validate(updateShopSchema), ctrl.updateShop);

export default router;
