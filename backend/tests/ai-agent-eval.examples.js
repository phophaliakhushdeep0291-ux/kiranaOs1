/**
 * The accuracy gate.
 *
 * Runs the golden set in replay mode — deterministic, offline, no API key, no
 * spend — and holds the result against the ratchet in the dataset. What it
 * scores is our own code: routing, argument validation, proposal handling,
 * evidence rendering and grounding, with the model's choices held fixed so a
 * change in the number can only have come from us.
 *
 * `node scripts/agent-eval.js --live` runs the same dataset through a real
 * provider and scores the model instead. That one costs money and is stochastic,
 * so it is not here; it is what you run before changing a model or the prompt.
 */
import assert from "node:assert/strict";
import { loadDataset, runEval, checkPolicy, DIMENSIONS } from "../scripts/agent-eval.js";
import { seedEvalShop, dropEvalShop } from "./helpers/agent-eval-shop.js";
import "../src/modules/ai/agent/register-core.js";

const dataset = await loadDataset();

/* ------------------------------------------- the dataset cannot rot quietly */
assert.equal(dataset.schemaVersion, 1, "dataset version must be pinned");
assert.ok(dataset.cases.length >= 14, "the golden set cannot silently shrink");
assert.equal(new Set(dataset.cases.map((row) => row.id)).size, dataset.cases.length, "case ids must be unique");
for (const testCase of dataset.cases) {
  assert.ok(testCase.utterance && testCase.category, `${testCase.id}: every case needs an utterance and a category`);
  assert.ok(testCase.expect && Object.keys(testCase.expect).length > 0, `${testCase.id}: a case that expects nothing scores nothing`);
  assert.ok(Array.isArray(testCase.replay), `${testCase.id}: replay mode needs recorded steps`);
}
// Every write case must state the risk it expects. A proposal test that does not
// pin the risk level would pass while an owner-PIN action quietly became a
// one-tap confirm, which is the exact regression this suite exists to catch.
for (const testCase of dataset.cases) {
  for (const proposal of testCase.expect.proposals ?? []) {
    assert.ok(proposal.risk, `${testCase.id}: proposal ${proposal.tool} must pin an expected risk`);
  }
}

const seeded = await seedEvalShop();
try {
  const report = await runEval({ dataset, ctx: seeded.ctx, refs: seeded.refs, live: false });

  for (const failure of report.failed) {
    console.log(`  FAIL ${failure.id}`);
    for (const line of failure.failures) console.log(`       ${line}`);
  }

  const violations = checkPolicy(report, dataset);
  assert.deepEqual(violations, [], `accuracy fell below the ratchet:\n  ${violations.join("\n  ")}`);

  // Every dimension must actually be exercised. A floor nothing measures is not
  // a gate, and checkPolicy only guards the dimensions the policy names.
  for (const dimension of DIMENSIONS) {
    assert.notEqual(report.scores[dimension], null, `no case exercises ${dimension}; its gate is doing nothing`);
  }

  assert.equal(report.failed.length, 0, "replay mode is deterministic: any failure here is a real regression, not variance");

  for (const [dimension, score] of Object.entries(report.scores)) {
    console.log(`  ok ${dimension}: ${(score * 100).toFixed(1)}%`);
  }

  // The fingerprint is what makes a score attributable. A number without the
  // prompt it was measured against cannot be compared to the next number.
  console.log(JSON.stringify({
    suite: report.suite,
    schemaVersion: report.schemaVersion,
    mode: report.mode,
    policyVersion: report.policyVersion,
    promptFingerprint: report.promptFingerprint,
    cases: report.cases,
    categories: Object.fromEntries(
      [...dataset.cases.reduce((map, row) => map.set(row.category, (map.get(row.category) ?? 0) + 1), new Map())]
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    scores: report.scores,
  }));
  console.log("AI agent accuracy eval passed");
} finally {
  await dropEvalShop(seeded);
}
