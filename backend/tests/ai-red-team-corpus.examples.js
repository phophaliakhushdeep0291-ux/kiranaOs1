import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseAiCommandOutput } from "../src/modules/ai/ai.command-schema.js";
import { groundAiCommand } from "../src/modules/ai/ai.grounding.js";

const corpusPath = new URL("./fixtures/ai-red-team-corpus.v1.json", import.meta.url);
const corpus = JSON.parse(await readFile(corpusPath, "utf8"));

assert.equal(corpus.schemaVersion, 1, "red-team corpus version must be pinned");
assert.ok(Array.isArray(corpus.cases) && corpus.cases.length >= 15, "red-team corpus cannot silently shrink");
assert.equal(new Set(corpus.cases.map((testCase) => testCase.id)).size, corpus.cases.length, "red-team IDs must be unique");

const catalog = corpus.catalog.map((product) => ({
  id: product.id,
  name: product.name,
  aliasesJson: JSON.stringify(product.aliases),
}));

function command(overrides = {}) {
  return {
    intent: "UNKNOWN",
    confidence: 0.95,
    customer: null,
    items: null,
    payment: null,
    target: null,
    discount: null,
    needsConfirmation: false,
    clarificationNeeded: false,
    clarificationQuestion: null,
    messageToUser: "Review the proposed command.",
    ...overrides,
  };
}

let legitimate = 0;
let legitimateAccepted = 0;
let adversarial = 0;
let unsafeAccepted = 0;
const categoryCounts = new Map();

for (const testCase of corpus.cases) {
  categoryCounts.set(testCase.category, (categoryCounts.get(testCase.category) ?? 0) + 1);
  const parsed = parseAiCommandOutput(command(testCase.output));
  assert.equal(parsed.ok, true, `${testCase.id}: fixture output must satisfy the production strict schema`);
  const result = groundAiCommand(parsed.command, { transcript: testCase.transcript, catalog });

  if (testCase.expectedAllowed) {
    legitimate += 1;
    if (result.allowed) legitimateAccepted += 1;
    assert.equal(result.allowed, true, `${testCase.id}: legitimate command was rejected (${result.safety.reasons.join(",")})`);
    assert.equal(result.safety.requiresManualFallback, false, `${testCase.id}: legitimate command should not require fallback`);
  } else {
    adversarial += 1;
    if (result.allowed) unsafeAccepted += 1;
    assert.equal(result.allowed, false, `${testCase.id}: unsafe command was accepted`);
    assert.equal(result.safety.requiresManualFallback, true, `${testCase.id}: unsafe command must fail into manual fallback`);
    for (const reason of testCase.expectedReasons ?? []) {
      assert.ok(result.safety.reasons.includes(reason), `${testCase.id}: missing rejection reason ${reason}; got ${result.safety.reasons.join(",")}`);
    }
  }
}

const legitimateRecall = legitimate === 0 ? 0 : legitimateAccepted / legitimate;
const unsafeAcceptanceRate = adversarial === 0 ? 1 : unsafeAccepted / adversarial;
assert.ok(legitimateRecall >= corpus.policy.minimumLegitimateRecall, `legitimate recall ${legitimateRecall} fell below ${corpus.policy.minimumLegitimateRecall}`);
assert.ok(unsafeAcceptanceRate <= corpus.policy.maximumUnsafeAcceptanceRate, `unsafe acceptance ${unsafeAcceptanceRate} exceeded ${corpus.policy.maximumUnsafeAcceptanceRate}`);

console.log(JSON.stringify({
  suite: corpus.name,
  schemaVersion: corpus.schemaVersion,
  corpusCases: corpus.cases.length,
  categories: Object.fromEntries([...categoryCounts].sort(([left], [right]) => left.localeCompare(right))),
  legitimate,
  legitimateAccepted,
  legitimateRecall,
  adversarial,
  unsafeAccepted,
  unsafeAcceptanceRate,
}));
