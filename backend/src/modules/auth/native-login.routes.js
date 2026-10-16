import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { AppError } from "../../middleware/error.js";
import { deviceMetadataSchema } from "./auth.schema.js";
import { requestMeta } from "./auth.controller.js";
import { approveNativeGoogleIdentity, completeNativeGoogleLogin } from "./auth.service.js";
import { isGoogleLoginConfigured } from "./google.service.js";
import { createNativeLoginService } from "./native-login.service.js";
import { nativeLoginStore } from "./native-login.store.js";

const router = Router();
const requestId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const verifier = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const proof = z.object({ requestId, verifier }).strict();
const service = createNativeLoginService({ store: nativeLoginStore, approveIdentity: approveNativeGoogleIdentity, completeLogin: completeNativeGoogleLogin });
// Polling has its own bounded allowance; it must not burn password attempts.
router.use(rateLimit({ windowMs: 60_000, max: 90, standardHeaders: true, legacyHeaders: false }));
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const handler = method => async (req, res, next) => {
  try {
    if (!isGoogleLoginConfigured()) throw new AppError("Google sign-in is not configured on this server.", 503, "GOOGLE_LOGIN_NOT_CONFIGURED");
    res.json({ success: true, data: await service[method](req.body, requestMeta(req)) });
  } catch (error) { next(error); }
};
router.post("/start", validate(z.object({ verifier, device: deviceMetadataSchema }).strict()), handler("start"));
router.post("/inspect", validate(z.object({ requestId }).strict()), handler("inspect"));
router.post("/approve", validate(z.object({ requestId, userCode: z.string().regex(/^\d{8}$/), credential: z.string().min(20).max(16_384), shopId: z.string().min(1).max(128).optional() }).strict()), handler("approve"));
router.post("/poll", validate(proof), handler("poll"));
router.post("/cancel", validate(proof), handler("cancel"));
export default router;
