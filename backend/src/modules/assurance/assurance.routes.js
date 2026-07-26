import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { env } from "../../config/env.js";
import * as ctrl from "./assurance.controller.js";
import {
  assignSchema,
  createRunSchema,
  dateRangeSchema,
  evaluateEntityParamsSchema,
  explainSchema,
  listEvidenceRequestsQuerySchema,
  listFindingsQuerySchema,
  listRunsQuerySchema,
  requestEvidenceSchema,
  reviewSchema,
  submitEvidenceSchema,
  updateFindingStatusSchema,
  updateRuleSchema,
  verifyEvidenceSchema,
} from "./assurance.schema.js";

const router = Router();

// Every assurance endpoint is tenant-scoped: shopId comes from the JWT via
// requireShop, never from a header, body or query parameter. A finding id from
// another shop therefore resolves to 404 rather than to data.
router.use(requireAuth, requireShop);

// Evaluation is the expensive path (it reads many canonical rows per entity),
// so it gets its own tighter limiter on top of the global /api limiter.
const evaluationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "test" ? 10000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.shopId ?? "unknown"}:${req.user?.userId ?? "anon"}`,
  message: { success: false, error: "Too many audit evaluations. Please wait before starting another run.", code: "AUDIT_RATE_LIMITED" },
});

// AI explanation calls out to a provider; keep them separately bounded.
const explainLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "test" ? 10000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.shopId ?? "unknown"}:${req.user?.userId ?? "anon"}`,
  message: { success: false, error: "Too many explanation requests. Please wait.", code: "AUDIT_AI_RATE_LIMITED" },
});

// ── dashboard / reports ───────────────────────────────────────
router.get("/dashboard", ctrl.dashboard);
router.get("/report", validateQuery(dateRangeSchema), ctrl.report);

// ── runs ──────────────────────────────────────────────────────
router.get("/runs", validateQuery(listRunsQuerySchema), ctrl.listRuns);
router.get("/runs/:id", ctrl.getRun);
router.post("/runs", evaluationLimiter, validate(createRunSchema), ctrl.createRun);

// ── findings ──────────────────────────────────────────────────
router.get("/findings", validateQuery(listFindingsQuerySchema), ctrl.listFindings);
router.get("/findings/:id", ctrl.getFinding);
router.patch("/findings/:id/status", validate(updateFindingStatusSchema), ctrl.updateFindingStatus);
router.post("/findings/:id/evidence", validate(submitEvidenceSchema), ctrl.submitEvidence);
router.post("/findings/:id/evidence-requests", validate(requestEvidenceSchema), ctrl.requestEvidence);
router.post("/findings/:id/review", validate(reviewSchema), ctrl.addReview);
router.post("/findings/:id/assign", validate(assignSchema), ctrl.assignReviewer);
router.post("/findings/:id/explain", explainLimiter, validate(explainSchema), ctrl.explainFinding);

// ── evidence ──────────────────────────────────────────────────
router.get("/evidence-requests", validateQuery(listEvidenceRequestsQuerySchema), ctrl.listEvidenceRequests);
router.patch("/evidence/:evidenceId/verify", validate(verifyEvidenceSchema), ctrl.verifyEvidence);

// ── rules and thresholds (owner-configurable) ─────────────────
router.get("/rules", ctrl.listRules);
router.patch("/rules/:ruleCode", requireRole("owner"), validate(updateRuleSchema), ctrl.updateRule);

// ── explicit evaluation entry points ──────────────────────────
router.post(
  "/evaluate/transaction/:entityType/:entityId",
  evaluationLimiter,
  (req, res, next) => {
    const parsed = evaluateEntityParamsSchema.safeParse(req.params);
    if (!parsed.success) return next(parsed.error);
    req.params = { ...req.params, ...parsed.data };
    next();
  },
  ctrl.evaluateTransaction
);
router.post("/evaluate/date-range", evaluationLimiter, validate(dateRangeSchema), ctrl.evaluateDateRange);
router.post("/baselines/recompute", evaluationLimiter, ctrl.recomputeBaselines);

export default router;
