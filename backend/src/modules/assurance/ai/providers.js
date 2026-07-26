// AuditAIProvider implementations.
//
// interface AuditAIProvider {
//   name: string
//   explainFinding(input): Promise<{ summary, whatToCheck[], suggestedEvidence[] }>
//   summarizeCase(input): Promise<{ summary, financialImpact, recommendedNextStep }>
//   classifyEvidence(input): Promise<{ evidenceType, confidence, reasoning }>
// }
//
// No provider is ever the authority on numbers. Providers receive already
// redacted, already computed facts and return prose only.
import OpenAI from "openai";
import { env } from "../../../config/env.js";

export class DisabledAuditAIProvider {
  name = "disabled";
  available = false;

  async explainFinding() {
    throw new AiProviderUnavailable("Audit AI provider is disabled");
  }

  async summarizeCase() {
    throw new AiProviderUnavailable("Audit AI provider is disabled");
  }

  async classifyEvidence() {
    throw new AiProviderUnavailable("Audit AI provider is disabled");
  }
}

export class AiProviderUnavailable extends Error {
  constructor(message) {
    super(message);
    this.code = "AUDIT_AI_UNAVAILABLE";
  }
}

/**
 * Deterministic in-process provider. Used by tests and local development: it
 * exercises the whole redact → call → validate → store path with no network.
 */
export class MockAuditAIProvider {
  name = "mock";
  available = true;

  constructor({ failMode = null } = {}) {
    this.failMode = failMode;
  }

  #maybeFail() {
    if (this.failMode === "throw") throw new Error("mock provider failure");
    if (this.failMode === "timeout") return new Promise(() => {}); // never resolves
    if (this.failMode === "malformed") return { nonsense: true };
    return null;
  }

  async explainFinding(input) {
    const forced = this.#maybeFail();
    if (forced) return forced;
    const rules = input.triggeredRules ?? [];
    return {
      summary: `Potential inconsistency detected on this ${String(input.sourceEntityType ?? "record").toLowerCase()}: ${rules
        .map((rule) => rule.name ?? rule.ruleCode)
        .join("; ")}. Risk score ${input.riskScore} (${input.riskLevel}). This is a review prompt, not a conclusion.`,
      whatToCheck: rules.map((rule) => rule.remediation ?? `Review ${rule.ruleCode}`),
      suggestedEvidence: [...new Set(rules.flatMap((rule) => rule.evidenceTypes ?? []))],
    };
  }

  async summarizeCase(input) {
    const forced = this.#maybeFail();
    if (forced) return forced;
    const findings = input.findings ?? [];
    return {
      summary: `${findings.length} related potential inconsistencies grouped for review.`,
      financialImpact: `Combined amount under review: ₹${((input.totalAmountPaise ?? 0) / 100).toFixed(2)}.`,
      recommendedNextStep: "Collect the requested evidence for the highest-risk finding first.",
    };
  }

  async classifyEvidence(input) {
    const forced = this.#maybeFail();
    if (forced) return forced;
    const description = String(input.description ?? "").toLowerCase();
    const guesses = [
      ["PURCHASE_INVOICE", ["invoice", "bill from", "supplier bill"]],
      ["EXPENSE_RECEIPT", ["receipt", "voucher"]],
      ["UPI_REFERENCE", ["upi", "utr", "transaction id"]],
      ["BANK_TRANSACTION", ["bank", "statement", "neft", "imps"]],
      ["STAFF_EXPLANATION", ["explained", "said", "note"]],
    ];
    const match = guesses.find(([, keywords]) => keywords.some((keyword) => description.includes(keyword)));
    return {
      evidenceType: match ? match[0] : "STAFF_EXPLANATION",
      confidence: match ? 0.7 : 0.3,
      reasoning: match ? `Description mentions ${match[1].find((k) => description.includes(k))}.` : "No strong keyword match; defaulting to a written explanation.",
    };
  }
}

/**
 * External provider (Groq or OpenAI, both OpenAI-protocol compatible). Receives
 * only redacted payloads and is asked for strict JSON, which the caller then
 * validates against a zod schema before anything is stored.
 */
export class ExternalAuditAIProvider {
  constructor({ provider, apiKey, model, timeoutMs }) {
    this.name = provider;
    this.available = Boolean(apiKey);
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.client = apiKey
      ? new OpenAI({
          apiKey,
          ...(provider === "groq" ? { baseURL: "https://api.groq.com/openai/v1" } : {}),
          timeout: timeoutMs,
          maxRetries: 0, // retries are handled by the caller with its own budget
        })
      : null;
  }

  async #chat(systemPrompt, userPayload) {
    if (!this.client) throw new AiProviderUnavailable(`${this.name} provider has no API key configured`);
    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) throw new Error("Provider returned an empty response");
    return JSON.parse(raw);
  }

  async explainFinding(input) {
    return this.#chat(EXPLAIN_SYSTEM_PROMPT, input);
  }

  async summarizeCase(input) {
    return this.#chat(SUMMARIZE_SYSTEM_PROMPT, input);
  }

  async classifyEvidence(input) {
    return this.#chat(CLASSIFY_SYSTEM_PROMPT, input);
  }
}

const SHARED_GUARDRAILS = `You are assisting a continuous financial-control review tool for small Indian retail shops.
Hard rules you must follow:
- The numbers, comparisons and risk scores in the input were computed deterministically. Never recompute, dispute or invent any number.
- Never state or imply that fraud, theft or a crime has occurred. Write "potential inconsistency", "needs review", "could not be verified".
- Never give a statutory audit opinion, tax advice, or a legal conclusion. Never mention certification or a Chartered Accountant's sign-off.
- Never invent evidence, documents, names, or events that are not in the input.
- Identifiers in the input are pseudonyms (for example CUSTOMER_1). Use them as-is; do not guess real identities.
- Reply with a single JSON object and nothing else.`;

const EXPLAIN_SYSTEM_PROMPT = `${SHARED_GUARDRAILS}
Task: explain to a shop owner, in plain language, why this record was flagged.
Respond as JSON: {"summary": string, "whatToCheck": string[], "suggestedEvidence": string[]}
- summary: 2-3 sentences, calm and factual, mentioning the amounts from the input.
- whatToCheck: concrete next actions the owner or staff can take.
- suggestedEvidence: evidence type names taken only from the input's evidence list.
If a language other than "en" is requested, write summary and whatToCheck in that language (hi = Hindi in Devanagari, hinglish = Hindi written in Latin script). Keep JSON keys in English.`;

const SUMMARIZE_SYSTEM_PROMPT = `${SHARED_GUARDRAILS}
Task: summarize a group of related findings as one investigation case.
Respond as JSON: {"summary": string, "financialImpact": string, "recommendedNextStep": string}`;

const CLASSIFY_SYSTEM_PROMPT = `${SHARED_GUARDRAILS}
Task: classify a user's description of a document into one of the allowed evidence types supplied in the input.
Respond as JSON: {"evidenceType": string, "confidence": number, "reasoning": string}
- evidenceType MUST be one of the allowed values in the input.
- confidence is between 0 and 1. Classification is advisory; a human still verifies the evidence.`;

let cachedProvider = null;
let cachedKey = null;

export function getAuditAIProvider({ override = null } = {}) {
  if (override) return override;

  const providerName = env.AUDIT_AI_PROVIDER;
  const apiKey = providerName === "groq" ? env.GROQ_API_KEY : providerName === "openai" ? env.OPENAI_API_KEY : null;
  const key = `${providerName}:${apiKey ? "keyed" : "nokey"}:${env.AUDIT_AI_MODEL ?? ""}`;
  if (cachedProvider && cachedKey === key) return cachedProvider;

  let provider;
  if (providerName === "disabled") {
    provider = new DisabledAuditAIProvider();
  } else if (providerName === "mock") {
    provider = new MockAuditAIProvider();
  } else {
    const defaultModel = providerName === "groq" ? env.GROQ_MODEL : env.OPENAI_MODEL;
    provider = new ExternalAuditAIProvider({
      provider: providerName,
      apiKey,
      model: env.AUDIT_AI_MODEL || defaultModel,
      timeoutMs: env.AUDIT_AI_TIMEOUT_MS,
    });
  }

  cachedProvider = provider;
  cachedKey = key;
  return provider;
}

export function resetAuditAIProviderCache() {
  cachedProvider = null;
  cachedKey = null;
}
