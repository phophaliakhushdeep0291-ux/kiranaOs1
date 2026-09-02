import assert from "node:assert/strict";
import {
  __aiFeedbackInternals,
  getAiFeedbackSummary,
  submitAiFeedback,
  summarizeAiFeedbackMetadata,
  wilsonInterval,
} from "../src/modules/ai/ai.feedback.service.js";
import { getMetricsSnapshot } from "../src/lib/metrics.js";

const actionLog = {
  id: "ai-turn-1",
  shopId: "shop-1",
  userId: "user-1",
  parsedActionJson: JSON.stringify({
    kind: "agent_turn",
    evaluation: {
      provider: "openai",
      model: "canary-model",
      policyVersion: "2026-09-02.1",
      promptFingerprint: "0123456789abcdef",
    },
  }),
};
const audits = [];
const database = {
  aiActionLog: {
    async findFirst({ where }) {
      return where.id === actionLog.id
        && where.shopId === actionLog.shopId
        && where.userId === actionLog.userId
        ? { id: actionLog.id, parsedActionJson: actionLog.parsedActionJson }
        : null;
    },
  },
  auditLog: {
    async create({ data }) {
      if (audits.some((row) => row.id === data.id)) throw Object.assign(new Error("unique"), { code: "P2002" });
      audits.push(data);
      return data;
    },
    async findMany() {
      return audits.map(({ metadataJson }) => ({ metadataJson }));
    },
  },
};

const first = await submitAiFeedback({
  shopId: "shop-1",
  userId: "user-1",
  actionLogId: "ai-turn-1",
  outcome: "unsafe",
  reasonCode: "UNSAFE_ACTION",
}, { database });
assert.deepEqual(first, {
  actionLogId: "ai-turn-1",
  outcome: "unsafe",
  reasonCode: "UNSAFE_ACTION",
  recorded: true,
  duplicate: false,
});
assert.equal(audits.length, 1);
const metadata = JSON.parse(audits[0].metadataJson);
assert.deepEqual(metadata, {
  actionLogId: "ai-turn-1",
  outcome: "unsafe",
  reasonCode: "UNSAFE_ACTION",
  kind: "agent_turn",
  provider: "openai",
  model: "canary-model",
  policyVersion: "2026-09-02.1",
  promptFingerprint: "0123456789abcdef",
});
assert.doesNotMatch(audits[0].metadataJson, /transcript|customer|phone|mobile/i);

const duplicate = await submitAiFeedback({
  shopId: "shop-1",
  userId: "user-1",
  actionLogId: "ai-turn-1",
  outcome: "unsafe",
  reasonCode: "UNSAFE_ACTION",
}, { database });
assert.equal(duplicate.duplicate, true, "retry must not create or count a second label");
assert.equal(audits.length, 1);

await assert.rejects(
  submitAiFeedback({
    shopId: "another-shop",
    userId: "user-1",
    actionLogId: "ai-turn-1",
    outcome: "correct",
  }, { database }),
  (error) => error?.code === "AI_RESULT_NOT_FOUND",
  "one tenant must not label another tenant's AI result",
);

const interval = wilsonInterval(1, 10);
assert.ok(interval.low >= 0 && interval.high <= 1 && interval.low < interval.rate && interval.rate < interval.high);
assert.equal(wilsonInterval(0, 0), null);

const insufficient = summarizeAiFeedbackMetadata(audits, 30);
assert.equal(insufficient.evidenceStatus, "insufficient_sample");
assert.equal(insufficient.sampleSize, 1);
assert.equal(insufficient.counts.unsafe, 1);
const measuredRows = Array.from({ length: 30 }, (_, index) => ({
  metadataJson: JSON.stringify({ outcome: index < 27 ? "correct" : index < 29 ? "misunderstood" : "unsafe" }),
}));
const measured = summarizeAiFeedbackMetadata(measuredRows, 30);
assert.equal(measured.evidenceStatus, "measured");
assert.deepEqual(measured.counts, { correct: 27, misunderstood: 2, unsafe: 1 });
assert.equal(measured.correct.rate, 0.9);

const fromDatabase = await getAiFeedbackSummary("shop-1", { database, minimumSamples: 1 });
assert.equal(fromDatabase.evidenceStatus, "measured");

const metric = getMetricsSnapshot().data.counters.find((row) => row.name === "ai_feedback_total");
assert.ok(metric, "a newly recorded label must emit evaluation telemetry");
assert.deepEqual(metric.labels, {
  kind: "agent_turn",
  model: "canary-model",
  outcome: "unsafe",
  policyVersion: "2026-09-02.1",
  provider: "openai",
  reasonCode: "UNSAFE_ACTION",
});
assert.equal(Object.keys(metric.labels).some((key) => /shop|user|transcript|customer/i.test(key)), false);

assert.equal(
  __aiFeedbackInternals.feedbackAuditId("shop-1", "user-1", "ai-turn-1"),
  __aiFeedbackInternals.feedbackAuditId("shop-1", "user-1", "ai-turn-1"),
  "feedback audit identity must be deterministic for retry idempotency",
);

console.log("AI privacy-safe feedback examples passed");

