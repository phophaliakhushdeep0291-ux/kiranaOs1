import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import {
  registerSchema, loginSchema, setPinSchema,
  verifyPinSchema, inviteStaffSchema, changePasswordSchema,
  refreshSchema, logoutSchema, forgotPasswordSchema, resetPasswordSchema,
  verifyEmailSchema, resendVerificationSchema, googleLoginSchema, deviceReplacementSchema,
  staffLocationAssignmentsSchema, updateStaffSchema
} from "./auth.schema.js";
import * as ctrl from "./auth.controller.js";
import { z } from "zod";

const router = Router();

// Public
router.post("/register", validate(registerSchema), ctrl.register);
router.post("/login",    validate(loginSchema),    ctrl.login);
router.post("/google",   validate(googleLoginSchema), ctrl.googleLogin);
router.post("/verify-email", validate(verifyEmailSchema), ctrl.verifyEmail);
router.post("/resend-verification", validate(resendVerificationSchema), ctrl.resendVerification);
router.post("/password/forgot", validate(forgotPasswordSchema), ctrl.forgotPassword);
router.post("/password/reset", validate(resetPasswordSchema), ctrl.resetPassword);
router.post("/refresh",  validate(refreshSchema),  ctrl.refresh);
router.post("/logout",   validate(logoutSchema),   ctrl.logout);
router.post("/device-replacement/complete", validate(deviceReplacementSchema), ctrl.completeDeviceReplacement);

// Authenticated
router.get("/me", requireAuth, ctrl.me);

// PIN endpoints (any authenticated user)
router.post("/pin/set",    requireAuth, requireRole("owner"), validate(setPinSchema),    ctrl.setPin);
router.post("/pin/verify", requireAuth, validate(verifyPinSchema), ctrl.verifyPin);
router.get("/pin/check",   requireAuth, ctrl.checkPin);

// Staff management is Growth+ only and owner-only.
router.get("/staff",          requireAuth, requireShop, requireRole("owner"), requireFeature("staff_login"), ctrl.listStaff);
router.post("/staff",         requireAuth, requireShop, requireRole("owner"), requireFeature("staff_login"), requireOwnerPin, validate(inviteStaffSchema), ctrl.inviteStaff);
router.patch("/staff/:id", requireAuth, requireShop, requireRole("owner"), requireFeature("staff_login"), requireOwnerPin,
  validate(updateStaffSchema), ctrl.updateStaff);
router.patch("/staff/:id/role", requireAuth, requireShop, requireRole("owner"), requireFeature("staff_login"), requireOwnerPin,
  validate(z.object({ role: z.enum(["staff","admin"]) })), ctrl.updateStaffRole);
router.delete("/staff/:id",   requireAuth, requireShop, requireRole("owner"), requireFeature("staff_login"), requireOwnerPin, ctrl.removeStaff);
router.get("/staff/:id/locations", requireAuth, requireShop, requireRole("owner"), requireFeature("role_based_access"), ctrl.getStaffLocations);
router.put("/staff/:id/locations", requireAuth, requireShop, requireRole("owner"), requireFeature("role_based_access"), requireOwnerPin, validate(staffLocationAssignmentsSchema), ctrl.updateStaffLocations);

// Self-service
router.post("/change-password", requireAuth, validate(changePasswordSchema), ctrl.changePassword);

export default router;
