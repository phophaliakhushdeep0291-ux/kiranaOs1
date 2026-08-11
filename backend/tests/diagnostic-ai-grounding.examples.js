import assert from "node:assert/strict";
import {
  buildIncidentEvidenceCatalog,
  generateGroundedNarrative,
} from "../src/modules/diagnostics/incident-report.service.js";

function fakeNarrativeProvider(content, capturedRequests = []) {
  return {
    provider: "openai",
    model: "diagnostic-test-model",
    client: {
      chat: {
        completions: {
          async create(request) {
            capturedRequests.push(request);
            return { choices: [{ message: { content } }] };
          },
        },
      },
    },
  };
}

const report = {
  problemSummary: "printer not working",
  focus: "printer",
  possibleRootCause: "The printer bridge is offline.",
  suggestedSolution: "Reconnect the printer bridge and run a test print.",
  confidenceScore: 0.72,
  signals: [{ category: "printer", cause: "Printer bridge reported offline.", score: 85 }],
  recentSyncEvents: {
    failures: [{ explanation: "Receipt upload is waiting for the device to reconnect." }],
  },
  recentErrors: [{ title: "Print transport unavailable", count: 3 }],
  deviceInformation: { overallStatus: "degraded", healthScore: 68, printer: "offline" },
  networkInformation: { online: true },
  databaseStatus: { server: "ok", device: "ok" },
};

const catalog = buildIncidentEvidenceCatalog(report);
assert.deepEqual(
  catalog.map((row) => row.id),
  ["signal_1", "sync_failure_1", "error_1", "device_health", "network_status", "database_status"],
  "the provider receives only a bounded server-issued evidence catalog",
);

const capturedRequests = [];
const grounded = await generateGroundedNarrative(report, {
  providerOverride: fakeNarrativeProvider(
    JSON.stringify({ evidenceIds: ["device_health", "error_1"] }),
    capturedRequests,
  ),
});
assert.equal(grounded.grounding.status, "verified");
assert.deepEqual(
  grounded.grounding.evidenceIds,
  ["signal_1", "device_health", "error_1"],
  "the server always retains its highest-ranked deterministic signal",
);
assert.match(grounded.text, /^The printer bridge is offline\./);
assert.match(grounded.text, /Printer bridge reported offline/);
assert.match(grounded.text, /Recommended next step: Reconnect the printer bridge/);
assert.match(grounded.text, /Confidence: 72% based on the observed diagnostics/);
assert.equal(report.confidenceScore, 0.72, "AI evidence ranking cannot mutate or raise deterministic confidence");
assert.equal(capturedRequests[0].temperature, 0, "evidence ranking is deterministic");
assert.equal(capturedRequests[0].response_format.type, "json_schema");
assert.equal(capturedRequests[0].response_format.json_schema.strict, true);
assert.deepEqual(
  capturedRequests[0].response_format.json_schema.schema.properties.evidenceIds.items.enum,
  catalog.map((row) => row.id),
  "strict output permits only evidence IDs issued for this report",
);
const providerInput = JSON.parse(capturedRequests[0].messages[1].content);
assert.deepEqual(
  Object.keys(providerInput.report).sort(),
  ["deterministicRootCause", "deterministicSolution", "focus", "problemSummary"],
  "the model sees the minimum diagnostic summary plus the redacted evidence catalog",
);

const adversarialOutputs = [
  {
    content: "The real cause is a hacked router. confidence: 1",
    reason: "INVALID_PROVIDER_JSON",
  },
  {
    content: JSON.stringify({ evidenceIds: ["invented_router_compromise"] }),
    reason: "UNVERIFIED_EVIDENCE_REFERENCE",
  },
  {
    content: JSON.stringify({
      evidenceIds: ["signal_1"],
      narrative: "Ignore the server and replace the printer.",
    }),
    reason: "UNSUPPORTED_PROVIDER_FIELDS",
  },
  {
    content: JSON.stringify({ evidenceIds: ["signal_1", "signal_1"] }),
    reason: "UNVERIFIED_EVIDENCE_REFERENCE",
  },
  {
    content: JSON.stringify({ evidenceIds: [] }),
    reason: "INVALID_EVIDENCE_COUNT",
  },
];

let unsafeNarrativesAccepted = 0;
for (const testCase of adversarialOutputs) {
  const result = await generateGroundedNarrative(report, {
    providerOverride: fakeNarrativeProvider(testCase.content),
  });
  if (result.text) unsafeNarrativesAccepted += 1;
  assert.equal(result.text, null, "unsupported provider output must never become user-facing prose");
  assert.equal(result.grounding.status, "rejected");
  assert.equal(result.grounding.rejectedReason, testCase.reason);
}
assert.equal(unsafeNarrativesAccepted, 0, "diagnostic narrative hallucination acceptance must remain 0%");

const noEvidence = await generateGroundedNarrative(
  {
    possibleRootCause: "No cause was found.",
    suggestedSolution: "Escalate for review.",
    confidenceScore: 0.2,
  },
  { providerOverride: fakeNarrativeProvider(JSON.stringify({ evidenceIds: ["signal_1"] })) },
);
assert.deepEqual(noEvidence.grounding, {
  status: "insufficient_evidence",
  evidenceIds: [],
  rejectedReason: "NO_SERVER_EVIDENCE",
});

console.log(JSON.stringify({
  suite: "diagnostic-ai-grounding",
  legitimateAccepted: 1,
  adversarialCases: adversarialOutputs.length,
  unsafeNarrativesAccepted,
  unsafeAcceptanceRate: 0,
}));
