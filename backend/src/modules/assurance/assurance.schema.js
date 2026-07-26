// Zod validation for every assurance endpoint. Nothing reaches the engine or
// the database without passing through here.
import { z } from "zod";
import {
  ENTITY_TYPES,
  EVIDENCE_STATUS,
  EVIDENCE_TYPES,
  FINDING_STATUS,
  RISK_LEVELS,
  RULE_CATEGORIES,
  RUN_TYPES,
} from "./assurance.constants.js";

const isoDate = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), "must be a valid date");
const objectId = z.string().min(1).max(64);

export const createRunSchema = z
  .object({
    runType: z.enum([RUN_TYPES.MANUAL, RUN_TYPES.SCHEDULED]).default(RUN_TYPES.MANUAL),
    from: isoDate.optional(),
    to: isoDate.optional(),
    entityTypes: z.array(z.nativeEnum(ENTITY_TYPES)).min(1).max(7).optional(),
  })
  .refine((value) => Boolean(value.from && value.to), {
    message: "from and to are required",
    path: ["from"],
  })
  .refine((value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to), {
    message: "from must be before to",
    path: ["from"],
  });

export const listRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  runType: z.nativeEnum(RUN_TYPES).optional(),
  status: z.enum(["RUNNING", "COMPLETED", "FAILED", "PARTIAL"]).optional(),
});

export const listFindingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.nativeEnum(FINDING_STATUS).optional(),
  riskLevel: z.nativeEnum(RISK_LEVELS).optional(),
  category: z.nativeEnum(RULE_CATEGORIES).optional(),
  sourceEntityType: z.nativeEnum(ENTITY_TYPES).optional(),
  sourceEntityId: objectId.optional(),
  assignedReviewerId: objectId.optional(),
  ruleCode: z.string().min(3).max(80).optional(),
  openOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const updateFindingStatusSchema = z.object({
  status: z.nativeEnum(FINDING_STATUS),
  comment: z.string().min(1).max(2000).optional(),
  evidenceId: objectId.optional(),
  approvalLevel: z.enum(["staff", "manager", "owner", "reviewer"]).optional(),
  resolutionType: z.string().min(2).max(60).optional(),
});

export const submitEvidenceSchema = z.object({
  evidenceType: z.nativeEnum(EVIDENCE_TYPES),
  requirementId: objectId.optional(),
  referenceKind: z.enum(["text", "reference", "url", "file", "transaction_ref"]).default("text"),
  referenceValue: z.string().min(1).max(4000),
  originalFilename: z.string().min(1).max(255).optional(),
  mimeType: z.string().min(3).max(120).optional(),
  sizeBytes: z.coerce.number().int().min(0).max(50 * 1024 * 1024).optional(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i, "must be a hex sha256").optional(),
  storageKey: z.string().min(1).max(512).optional(),
});

export const requestEvidenceSchema = z.object({
  evidenceType: z.nativeEnum(EVIDENCE_TYPES),
  description: z.string().min(3).max(1000),
  dueAt: isoDate.optional(),
});

export const verifyEvidenceSchema = z.object({
  verificationStatus: z.enum([
    EVIDENCE_STATUS.VERIFIED,
    EVIDENCE_STATUS.REJECTED,
    EVIDENCE_STATUS.INSUFFICIENT,
    EVIDENCE_STATUS.NOT_APPLICABLE,
  ]),
  reviewerNotes: z.string().min(1).max(2000).optional(),
});

export const reviewSchema = z.object({
  decision: z.enum(["CONFIRMED_ISSUE", "FALSE_POSITIVE", "ACCEPTED_RISK", "CORRECTED", "NEEDS_MORE_EVIDENCE"]),
  notes: z.string().min(1).max(2000).optional(),
  newStatus: z.nativeEnum(FINDING_STATUS).optional(),
});

export const assignSchema = z.object({
  reviewerUserId: objectId,
  comment: z.string().min(1).max(1000).optional(),
});

export const updateRuleSchema = z
  .object({
    enabled: z.boolean().optional(),
    weightOverride: z.coerce.number().int().min(0).max(60).nullable().optional(),
    thresholds: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "at least one field is required" });

export const evaluateEntityParamsSchema = z.object({
  entityType: z.string().transform((value) => value.toUpperCase()).pipe(z.nativeEnum(ENTITY_TYPES)),
  entityId: objectId,
});

export const dateRangeSchema = z
  .object({
    from: isoDate,
    to: isoDate,
  })
  .refine((value) => new Date(value.from) <= new Date(value.to), { message: "from must be before to", path: ["from"] });

export const explainSchema = z.object({
  language: z.enum(["en", "hi", "hinglish"]).default("en"),
});

export const listEvidenceRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.nativeEnum(EVIDENCE_STATUS).optional(),
});
