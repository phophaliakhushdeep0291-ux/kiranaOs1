import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import {
  activityBatchSchema,
  analyticsQuerySchema,
  insightsQuerySchema,
  personalizationQuerySchema,
  recentActivityQuerySchema,
} from "./activity.schema.js";
import * as ctrl from "./activity.controller.js";

const router = Router();

// Tenant context is mandatory — shopId comes from the JWT and never from the
// body. Device activation is deliberately NOT required: a device that is in the
// middle of a licensing problem still generates the activity that explains it.
router.use(requireAuth, requireShop);

// Ingest and personal reads: any authenticated user of the shop. These are the
// user's own behaviour, and the whole point is that they shape that user's POS.
router.post("/events", validate(activityBatchSchema), ctrl.ingest);
router.get("/recent", validateQuery(recentActivityQuerySchema), ctrl.recent);
router.get("/personalization", validateQuery(personalizationQuerySchema), ctrl.personalization);
router.get("/replenishment", validateQuery(personalizationQuerySchema), ctrl.replenishment);

// Business intelligence is owner-only: it aggregates every staff member's
// behaviour, which is the owner's view of the business rather than a staff
// member's view of their own work.
router.get("/insights", requireRole("owner"), validateQuery(insightsQuerySchema), ctrl.insights);
router.get("/analytics", requireRole("owner"), validateQuery(analyticsQuerySchema), ctrl.analytics);

export default router;
