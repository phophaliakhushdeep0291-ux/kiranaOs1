import { Router } from "express";
import { requireRole } from "../../../middleware/auth.js";
import { requireOwnerPin } from "../../../middleware/permissions.js";
import { validate } from "../../../middleware/validate.js";
import { marketplaceSetupSchema, marketplaceVerifySchema } from "./schemas.js";
import { restaurantMarketplaceService as service } from "./service.js";

// Mounted AFTER integration authentication, shop and activated-device guards.
// No public webhook or order-command routes exist until provider authentication
// and the complete kitchen/billing path have been certified.
const router = Router();
router.use(requireRole("owner"));
const actor = (req) => ({ userId: req.user?.userId, req });

router.get("/", async (req, res, next) => {
  try { res.json({ success: true, data: await service.list(req.shopId) }); }
  catch (error) { next(error); }
});
router.put("/:provider", requireOwnerPin, validate(marketplaceSetupSchema), async (req, res, next) => {
  try { res.json({ success: true, data: await service.save({ shopId: req.shopId, provider: req.params.provider, input: req.body, actor: actor(req) }) }); }
  catch (error) { next(error); }
});
router.post("/connections/:id/verify", requireOwnerPin, validate(marketplaceVerifySchema), async (req, res, next) => {
  try { res.json({ success: true, data: await service.verify({ shopId: req.shopId, connectionId: req.params.id, actor: actor(req) }) }); }
  catch (error) { next(error); }
});

export default router;
