import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { changePlanSchema, checkoutSchema, extendGraceSchema, foundingCustomerSchema, manualActivateSchema, onboardingPurchaseSchema, validateCouponSchema, verifyPaymentSchema } from "./subscription.schemas.js";
import * as ctrl from "./subscription.controller.js";

const router = Router();

router.get("/plans", ctrl.plans);
router.use(requireAuth, requireShop);
router.get("/current", ctrl.current);
router.post("/validate-coupon", requireRole("owner", "admin"), validate(validateCouponSchema), ctrl.validateCoupon);
router.post("/checkout", requireRole("owner", "admin"), validate(checkoutSchema), ctrl.checkout);
router.post("/verify-payment", requireRole("owner", "admin"), validate(verifyPaymentSchema), ctrl.verifyPayment);
router.post("/manual-activate", requireRole("owner", "admin"), requireOwnerPin, validate(manualActivateSchema), ctrl.manualActivate);
router.post("/change-plan", requireRole("owner", "admin"), requireOwnerPin, validate(changePlanSchema), ctrl.changePlan);
router.post("/cancel", requireRole("owner", "admin"), requireOwnerPin, ctrl.cancel);
router.post("/extend-grace", requireRole("owner", "admin"), requireOwnerPin, validate(extendGraceSchema), ctrl.extendGrace);
router.post("/founding-customer", requireRole("owner", "admin"), requireOwnerPin, validate(foundingCustomerSchema), ctrl.foundingCustomer);
router.get("/onboarding", requireRole("owner", "admin"), ctrl.onboardingPurchases);
router.post("/onboarding", requireRole("owner", "admin"), requireOwnerPin, validate(onboardingPurchaseSchema), ctrl.recordOnboardingPurchase);

export default router;
