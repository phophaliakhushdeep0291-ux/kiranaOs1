import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { disableGiftCardSchema, issueGiftCardSchema, listGiftCardsSchema, lookupGiftCardSchema } from "./giftCards.schema.js";
import * as controller from "./giftCards.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("loyalty_program"));
router.get("/", validateQuery(listGiftCardsSchema), controller.list);
router.post("/lookup", validate(lookupGiftCardSchema), controller.lookup);
router.post("/", requireRole("owner", "admin"), requireOwnerPin, validate(issueGiftCardSchema), controller.issue);
router.post("/:id/disable", requireRole("owner", "admin"), requireOwnerPin, validate(disableGiftCardSchema), controller.disable);

export default router;
