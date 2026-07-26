// AI orchestration for the assurance module.
//
// Order of operations for every call, with no way around it:
//   1. build a minimal fact payload from already-computed deterministic output
//   2. redact (drop identity, mask phones/GSTIN/UPI/tokens, pseudonymize ids)
//   3. check consent + provider availability
//   4. call the provider with a timeout and a bounded retry budget
//   5. validate the response against a zod schema
//   6. on ANY failure, return the deterministic fallback text
//
// The deterministic engine never depends on this module: findings, scores and
// evidence requirements exist before any explanation is requested.
import { z } from "zod";
import { env } from "../../../config/env.js";
import { RULES_BY_CODE } from "../rules/index.js";
import { containsLikelyPii, redactForExternalAi } from "./redaction.js";
import { AiProviderUnavailable, getAuditAIProvider } from "./providers.js";

export const AUDIT_AI_DISCLAIMER =
  "Generated explanation of a deterministic rule result. It is a prompt to review, not a finding of fraud, and not a statutory audit opinion.";

const SUPPORTED_LANGUAGES = new Set(["en", "hi", "hinglish"]);

const explanationSchema = z.object({
  summary: z.string().min(10).max(2000),
  whatToCheck: z.array(z.string().min(3).max(500)).max(10).default([]),
  suggestedEvidence: z.array(z.string().min(2).max(80)).max(10).default([]),
});

const caseSummarySchema = z.object({
  summary: z.string().min(10).max(2000),
  financialImpact: z.string().min(3).max(500),
  recommendedNextStep: z.string().min(3).max(500),
});

const evidenceClassificationSchema = z.object({
  evidenceType: z.string().min(2).max(80),
  confidence: z.coerce.number().min(0).max(1),
  reasoning: z.string().min(3).max(1000).default(""),
});

// Language claims and accusation-shaped wording are rejected even when the
// schema passes, so a misbehaving provider cannot put "fraud" in front of a user.
const FORBIDDEN_PHRASES = [
  "fraud has occurred",
  "committed fraud",
  "is fraudulent",
  "theft",
  "stole",
  "guilty",
  "criminal",
  "audit opinion",
  "certif", // certified / certification
  "chartered accountant",
];

function violatesLanguagePolicy(text) {
  const lowered = String(text ?? "").toLowerCase();
  return FORBIDDEN_PHRASES.find((phrase) => lowered.includes(phrase)) ?? null;
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("AUDIT_AI_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} options
 * @param {object} options.provider  override provider (tests)
 * @param {object} options.shopSettings  parsed settingsJson.audit for consent
 */
async function callProvider(method, payload, { provider = null, shopSettings = null } = {}) {
  const active = getAuditAIProvider({ override: provider });
  if (!active?.available) {
    throw new AiProviderUnavailable(`Audit AI provider "${active?.name ?? "unknown"}" is not available`);
  }

  const isExternal = active.name === "groq" || active.name === "openai";
  if (isExternal && env.AUDIT_AI_REQUIRE_SHOP_CONSENT && shopSettings?.aiExplanationsConsent !== true) {
    throw new AiProviderUnavailable("Shop has not consented to external AI explanations");
  }

  const { payload: redacted, report } = redactForExternalAi(payload, {
    allowAttachments: env.AUDIT_AI_ALLOW_ATTACHMENTS,
  });

  // Belt and braces: never dispatch anything that still looks identifying.
  if (isExternal && containsLikelyPii(redacted)) {
    throw new AiProviderUnavailable("Redaction check failed; refusing to send payload externally");
  }

  const maxAttempts = env.AUDIT_AI_MAX_RETRIES + 1;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await withTimeout(active[method](redacted), env.AUDIT_AI_TIMEOUT_MS);
      return { response, provider: active.name, redactionReport: report, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (error instanceof AiProviderUnavailable) break;
    }
  }
  throw lastError ?? new Error("AUDIT_AI_FAILED");
}

// ── explanations ──────────────────────────────────────────────

function deterministicExplanation(finding, language) {
  const rules = finding.triggeredRules ?? [];
  const lines = rules.map((rule) => {
    const name = rule.name ?? rule.ruleCode;
    return `${name} (${rule.severity}, contributed ${rule.scoreContribution} points)`;
  });
  const amount = finding.amountPaise ? `₹${(finding.amountPaise / 100).toFixed(2)}` : "an unrecorded amount";
  const summary = [
    `Potential inconsistency detected on this ${String(finding.sourceEntityType ?? "record").toLowerCase().replace("_", " ")} involving ${amount}.`,
    rules.length
      ? `${rules.length} deterministic rule${rules.length === 1 ? "" : "s"} triggered: ${lines.join("; ")}.`
      : "No rules are currently triggering for this record.",
    `Risk score ${finding.riskScore}/100 (${finding.riskLevel}), confidence ${finding.confidence}.`,
    "This needs review; it is not a conclusion about anyone's conduct.",
  ].join(" ");

  return {
    text: summary,
    language,
    source: "deterministic_fallback",
    provider: "none",
    degraded: true,
    whatToCheck: rules.map((rule) => rule.remediation).filter(Boolean),
    suggestedEvidence: [...new Set(rules.flatMap((rule) => RULES_BY_CODE[rule.ruleCode]?.evidenceTypes ?? []))],
    disclaimer: AUDIT_AI_DISCLAIMER,
  };
}

export async function explainFinding({ finding, language = "en", provider = null, shopSettings = null }) {
  const normalizedLanguage = SUPPORTED_LANGUAGES.has(language) ? language : "en";
  const fallback = deterministicExplanation(finding, normalizedLanguage);

  try {
    const payload = {
      language: normalizedLanguage,
      sourceEntityType: finding.sourceEntityType,
      riskScore: finding.riskScore,
      riskLevel: finding.riskLevel,
      confidence: finding.confidence,
      amountRupees: finding.amountPaise === null || finding.amountPaise === undefined ? null : Number((finding.amountPaise / 100).toFixed(2)),
      scoreBreakdown: {
        formula: finding.scoreBreakdown?.formula,
        baseScore: finding.scoreBreakdown?.baseScore,
        materialityMultiplier: finding.scoreBreakdown?.materialityMultiplier,
        historyMultiplier: finding.scoreBreakdown?.historyMultiplier,
      },
      triggeredRules: (finding.triggeredRules ?? []).map((rule) => ({
        ruleCode: rule.ruleCode,
        name: rule.name,
        description: rule.description,
        severity: rule.severity,
        category: rule.category,
        scoreContribution: rule.scoreContribution,
        remediation: rule.remediation,
        evidenceTypes: RULES_BY_CODE[rule.ruleCode]?.evidenceTypes ?? [],
        details: rule.details,
      })),
      allowedEvidenceTypes: [...new Set((finding.triggeredRules ?? []).flatMap((rule) => RULES_BY_CODE[rule.ruleCode]?.evidenceTypes ?? []))],
    };

    const { response, provider: providerName, attempts } = await callProvider("explainFinding", payload, { provider, shopSettings });
    const parsed = explanationSchema.safeParse(response);
    if (!parsed.success) return { ...fallback, failureReason: "invalid_provider_output" };

    const violation = violatesLanguagePolicy(`${parsed.data.summary} ${parsed.data.whatToCheck.join(" ")}`);
    if (violation) {
      return { ...fallback, failureReason: `provider_language_policy_violation:${violation}` };
    }

    return {
      text: parsed.data.summary,
      language: normalizedLanguage,
      source: "ai_provider",
      provider: providerName,
      degraded: false,
      attempts,
      whatToCheck: parsed.data.whatToCheck,
      // Only evidence types the deterministic rules actually asked for survive.
      suggestedEvidence: parsed.data.suggestedEvidence.filter((type) => payload.allowedEvidenceTypes.includes(type)),
      disclaimer: AUDIT_AI_DISCLAIMER,
    };
  } catch (error) {
    return { ...fallback, failureReason: error?.code ?? error?.message ?? "provider_error" };
  }
}

export async function summarizeCase({ findings = [], totalAmountPaise = 0, provider = null, shopSettings = null }) {
  const fallback = {
    summary: `${findings.length} related potential inconsistencies are grouped in this case.`,
    financialImpact: `Combined amount under review: ₹${(totalAmountPaise / 100).toFixed(2)}.`,
    recommendedNextStep: "Start with the highest-risk finding and collect its requested evidence.",
    source: "deterministic_fallback",
    provider: "none",
    degraded: true,
    disclaimer: AUDIT_AI_DISCLAIMER,
  };

  try {
    const payload = {
      totalAmountPaise,
      findings: findings.map((finding) => ({
        riskScore: finding.riskScore,
        riskLevel: finding.riskLevel,
        sourceEntityType: finding.sourceEntityType,
        ruleCodes: (finding.triggeredRules ?? []).map((rule) => rule.ruleCode),
      })),
    };
    const { response, provider: providerName } = await callProvider("summarizeCase", payload, { provider, shopSettings });
    const parsed = caseSummarySchema.safeParse(response);
    if (!parsed.success) return { ...fallback, failureReason: "invalid_provider_output" };
    const violation = violatesLanguagePolicy(`${parsed.data.summary} ${parsed.data.recommendedNextStep}`);
    if (violation) return { ...fallback, failureReason: `provider_language_policy_violation:${violation}` };
    return { ...parsed.data, source: "ai_provider", provider: providerName, degraded: false, disclaimer: AUDIT_AI_DISCLAIMER };
  } catch (error) {
    return { ...fallback, failureReason: error?.code ?? error?.message ?? "provider_error" };
  }
}

export async function classifyEvidence({ description, allowedEvidenceTypes = [], provider = null, shopSettings = null }) {
  const fallback = {
    evidenceType: null,
    confidence: 0,
    reasoning: "Automatic classification unavailable; a reviewer must classify this evidence.",
    source: "deterministic_fallback",
    provider: "none",
    degraded: true,
    disclaimer: AUDIT_AI_DISCLAIMER,
  };

  try {
    const { response, provider: providerName } = await callProvider(
      "classifyEvidence",
      { description, allowedEvidenceTypes },
      { provider, shopSettings }
    );
    const parsed = evidenceClassificationSchema.safeParse(response);
    if (!parsed.success) return { ...fallback, failureReason: "invalid_provider_output" };
    if (allowedEvidenceTypes.length && !allowedEvidenceTypes.includes(parsed.data.evidenceType)) {
      return { ...fallback, failureReason: "provider_returned_disallowed_evidence_type" };
    }
    return { ...parsed.data, source: "ai_provider", provider: providerName, degraded: false, disclaimer: AUDIT_AI_DISCLAIMER };
  } catch (error) {
    return { ...fallback, failureReason: error?.code ?? error?.message ?? "provider_error" };
  }
}

export function auditAiStatus() {
  const provider = getAuditAIProvider();
  return {
    provider: provider.name,
    available: Boolean(provider.available),
    requiresShopConsent: env.AUDIT_AI_REQUIRE_SHOP_CONSENT,
    attachmentsAllowed: env.AUDIT_AI_ALLOW_ATTACHMENTS,
    timeoutMs: env.AUDIT_AI_TIMEOUT_MS,
    maxRetries: env.AUDIT_AI_MAX_RETRIES,
    note: "The deterministic engine runs regardless of this status.",
  };
}
