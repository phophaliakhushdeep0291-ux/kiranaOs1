import { createHash } from "node:crypto";
import db from "../../db.js";
import { incrementMetric } from "../../lib/metrics.js";
import { AppError } from "../../shared/errors/index.js";

export const AI_FEEDBACK_OUTCOMES = Object.freeze(["correct", "misunderstood", "unsafe"]);
export const AI_FEEDBACK_REASONS = Object.freeze([
  "NONE",
  "MISUNDERSTOOD_REQUEST",
  "WRONG_FACT",
  "WRONG_ITEM",
  "WRONG_QUANTITY_OR_AMOUNT",
  "UNSAFE_ACTION",
  "OTHER",
]);

function evaluationMetadata(log) {
  try {
    const parsed = JSON.parse(log?.parsedActionJson ?? "{}");
    const evaluation = parsed?.evaluation ?? parsed?.safety ?? {};
    return {
      kind: parsed?.kind === "agent_turn" ? "agent_turn" : "command_parser",
      provider: String(evaluation.provider ?? parsed?.provider?.name ?? "unknown").slice(0, 80),
      model: String(evaluation.model ?? parsed?.provider?.model ?? "unknown").slice(0, 80),
      policyVersion: String(evaluation.policyVersion ?? "unknown").slice(0, 80),
      promptFingerprint: String(evaluation.promptFingerprint ?? "unknown").slice(0, 80),
    };
  } catch {
    return { kind: "unknown", provider: "unknown", model: "unknown", policyVersion: "unknown", promptFingerprint: "unknown" };
  }
}

function feedbackAuditId(shopId, userId, actionLogId) {
  return `aifb_${createHash("sha256").update(`${shopId}\0${userId}\0${actionLogId}`).digest("hex").slice(0, 24)}`;
}

export async function submitAiFeedback(
  { shopId, userId, actionLogId, outcome, reasonCode = "NONE" },
  { database = db } = {},
) {
  const source = await database.aiActionLog.findFirst({
    where: { id: actionLogId, shopId, userId },
    select: { id: true, parsedActionJson: true },
  });
  if (!source) throw new AppError("That AI result was not found", 404, "AI_RESULT_NOT_FOUND");

  const evaluation = evaluationMetadata(source);
  const metadata = { actionLogId: source.id, outcome, reasonCode, ...evaluation };
  const id = feedbackAuditId(shopId, userId, source.id);
  let created = false;
  try {
    await database.auditLog.create({
      data: {
        id,
        shopId,
        userId,
        module: "ai",
        action: "AI_QUALITY_FEEDBACK",
        entityType: "AiActionLog",
        entityId: source.id,
        metadataJson: JSON.stringify(metadata),
        result: "success",
      },
    });
    created = true;
  } catch (error) {
    if (error?.code !== "P2002") throw error;
  }

  if (created) {
    incrementMetric("ai_feedback_total", {
      outcome,
      reasonCode,
      kind: evaluation.kind,
      provider: evaluation.provider,
      model: evaluation.model,
      policyVersion: evaluation.policyVersion,
    });
  }
  return { actionLogId: source.id, outcome, reasonCode, recorded: created, duplicate: !created };
}

export function wilsonInterval(positive, total, z = 1.96) {
  if (!Number.isInteger(total) || total <= 0) return null;
  const boundedPositive = Math.max(0, Math.min(total, Number(positive) || 0));
  const p = boundedPositive / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
  return { rate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function summarizeAiFeedbackMetadata(rows, minimumSamples = 30) {
  const samples = [];
  for (const row of rows ?? []) {
    try {
      const value = JSON.parse(row?.metadataJson ?? "{}");
      if (AI_FEEDBACK_OUTCOMES.includes(value.outcome)) samples.push(value);
    } catch {}
  }
  const total = samples.length;
  const correct = samples.filter((sample) => sample.outcome === "correct").length;
  const misunderstood = samples.filter((sample) => sample.outcome === "misunderstood").length;
  const unsafe = samples.filter((sample) => sample.outcome === "unsafe").length;
  return {
    sampleSize: total,
    minimumSamples,
    evidenceStatus: total >= minimumSamples ? "measured" : "insufficient_sample",
    counts: { correct, misunderstood, unsafe },
    correct: wilsonInterval(correct, total),
    misunderstood: wilsonInterval(misunderstood, total),
    unsafe: wilsonInterval(unsafe, total),
  };
}

export async function getAiFeedbackSummary(shopId, { database = db, minimumSamples = 30 } = {}) {
  const rows = await database.auditLog.findMany({
    where: { shopId, module: "ai", action: "AI_QUALITY_FEEDBACK", result: "success" },
    select: { metadataJson: true },
    orderBy: { createdAt: "desc" },
    take: 10_000,
  });
  return summarizeAiFeedbackMetadata(rows, minimumSamples);
}

export const __aiFeedbackInternals = { evaluationMetadata, feedbackAuditId };

