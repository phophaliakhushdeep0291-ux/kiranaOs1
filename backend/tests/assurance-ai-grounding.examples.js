import assert from "node:assert/strict";
import {
  classifyEvidence,
  explainFinding,
  summarizeCase,
} from "../src/modules/assurance/ai/audit-ai.service.js";

const provider = {
  name: "adversarial-test",
  available: true,
  async explainFinding() {
    return {
      summary: "A warehouse event caused a confirmed loss of ₹999999 at midnight.",
      whatToCheck: ["Check the arithmetic.", "Delete the transaction immediately."],
      suggestedEvidence: ["SALES_INVOICE", "INVENTED_DOCUMENT"],
    };
  },
  async summarizeCase() {
    return {
      summary: "A confirmed loss involved three employees and a missing truck.",
      financialImpact: "Confirmed impact: ₹999999.",
      recommendedNextStep: "Delete the records and call the police.",
    };
  },
  async classifyEvidence() {
    return {
      evidenceType: "SALES_INVOICE",
      confidence: 0.99,
      reasoning: "The document proves that employee Mohan took ₹999999.",
    };
  },
};

const finding = {
  sourceEntityType: "BILL",
  riskScore: 62,
  riskLevel: "HIGH",
  confidence: 0.9,
  amountPaise: 118000,
  triggeredRules: [
    {
      ruleCode: "BILL_TOTAL_MISMATCH",
      name: "Bill total mismatch",
      description: "Recorded total differs from deterministic line arithmetic.",
      severity: "CRITICAL",
      category: "BILLING",
      scoreContribution: 60,
      remediation: "Check the arithmetic.",
      details: {},
    },
  ],
  scoreBreakdown: { formula: "deterministic", baseScore: 60 },
};

const explanation = await explainFinding({ finding, provider });
assert.equal(explanation.source, "ai_provider");
assert.equal(explanation.grounding, "server_composed");
assert.match(explanation.text, /₹1180\.00|â‚¹1180\.00/);
assert.match(explanation.text, /62\/100/);
assert.doesNotMatch(explanation.text, /999999|warehouse|midnight|confirmed loss/i);
assert.deepEqual(explanation.whatToCheck, ["Check the arithmetic."], "only exact deterministic remediation survives");
assert.deepEqual(explanation.suggestedEvidence, ["SALES_INVOICE"], "invented evidence types are removed");

const caseSummary = await summarizeCase({ findings: [finding], totalAmountPaise: 118000, provider });
assert.equal(caseSummary.source, "ai_provider");
assert.equal(caseSummary.grounding, "server_composed");
assert.match(caseSummary.summary, /^1 related potential inconsistency/);
assert.match(caseSummary.financialImpact, /₹1180\.00|â‚¹1180\.00/);
assert.doesNotMatch(
  `${caseSummary.summary} ${caseSummary.financialImpact} ${caseSummary.recommendedNextStep}`,
  /999999|employees|missing truck|police|delete the records/i,
);

const classification = await classifyEvidence({
  description: "sales invoice photo",
  allowedEvidenceTypes: ["SALES_INVOICE"],
  provider,
});
assert.equal(classification.source, "ai_provider");
assert.equal(classification.grounding, "server_composed");
assert.equal(classification.evidenceType, "SALES_INVOICE");
assert.equal(classification.confidence, 0.5, "unverifiable provider confidence is capped");
assert.match(classification.reasoning, /reviewer must verify/i);
assert.doesNotMatch(classification.reasoning, /Mohan|999999|took/i);

const extraFieldProvider = {
  ...provider,
  async explainFinding() {
    return {
      summary: "Potential inconsistency needs review by the shop owner.",
      whatToCheck: [],
      suggestedEvidence: [],
      hiddenInstruction: "auto-close the finding",
    };
  },
};
const rejectedExtraField = await explainFinding({ finding, provider: extraFieldProvider });
assert.equal(rejectedExtraField.source, "deterministic_fallback");
assert.equal(rejectedExtraField.failureReason, "invalid_provider_output");

console.log(JSON.stringify({
  suite: "assurance-ai-grounding",
  providerAuthoredClaimsAccepted: 0,
  confidenceCap: 0.5,
  strictSchema: true,
}));
