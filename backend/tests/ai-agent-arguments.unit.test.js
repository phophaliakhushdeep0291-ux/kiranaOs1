import test from "node:test";
import assert from "node:assert/strict";
import { validateArgs } from "../src/modules/ai/agent/argument-validation.js";
import { runChatCompletion, __resetProviderGatewayForTests } from "../src/modules/ai/provider-gateway.js";

const cartTool = { name: "add_items_to_bill", parameters: {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", minItems: 1, maxItems: 20, items: {
    type: "object", additionalProperties: false, required: ["query", "quantity"],
    properties: { query: { type: "string" }, quantity: { type: "number", exclusiveMinimum: 0 } },
  } } },
} };

test("agent accepts bill lines and rejects invalid nested arguments before proposing them", () => {
  assert.deepEqual(validateArgs(cartTool, { items: [{ query: "QA Soap", quantity: 2 }] }), []);
  for (const args of [null, [], "items", { items: {} }, { items: [] },
    { items: Array(21).fill({ query: "QA Soap", quantity: 1 }) },
    { items: [null] }, { items: [{ query: "QA Soap", quantity: 0 }] },
    { items: [{ query: "QA Soap", quantity: -1 }] },
    { items: [{ query: "QA Soap", quantity: Infinity }] },
    { items: [{ query: "QA Soap", quantity: "2" }] },
    { items: [{ query: "", quantity: 2 }] },
    { items: [{ query: "QA Soap", quantity: 2, shopId: "another-shop" }] }]) {
    assert.ok(validateArgs(cartTool, args).length > 0, JSON.stringify(args));
  }
});

test("provider timeout aborts a stalled request without an SDK retry", async () => {
  __resetProviderGatewayForTests();
  let requestOptions;
  const stalled = { provider: "stub", model: "stub", client: { chat: { completions: { create: async (_body, options) => {
    requestOptions = options;
    return new Promise(() => {});
  } } } } };
  await assert.rejects(
    runChatCompletion({ body: {}, deadline: Date.now() + 1_600, candidates: [stalled] }),
    { code: "AI_TURN_TIMEOUT" },
  );
  assert.equal(requestOptions.signal.aborted, true, "a stalled request must be aborted, not left running");
  assert.equal(requestOptions.maxRetries, 0, "the SDK must not retry behind the gateway's own budget");
  assert.ok(requestOptions.timeout <= 1_600, "the request may only spend what is left of the turn");
  // Already past the deadline: never reached for at all.
  await assert.rejects(
    runChatCompletion({ body: {}, deadline: Date.now() - 1, candidates: [stalled] }),
    { code: "AI_TURN_TIMEOUT" },
  );
});

test("provider completion preserves a successful response", async () => {
  __resetProviderGatewayForTests();
  const ok = { provider: "stub", model: "stub", client: { chat: { completions: { create: async () => ({ choices: [] }) } } } };
  const answered = await runChatCompletion({ body: {}, deadline: Date.now() + 10_000, candidates: [ok] });
  assert.deepEqual(answered.completion, { choices: [] });
  assert.equal(answered.provider, "stub");
  assert.equal(answered.failedOver, false);
});

test("a failing provider hands the turn to the next one instead of failing the shopkeeper", async () => {
  __resetProviderGatewayForTests();
  let primaryCalls = 0;
  const down = { provider: "primary", model: "p", client: { chat: { completions: { create: async () => {
    primaryCalls += 1;
    throw Object.assign(new Error("service unavailable"), { status: 503 });
  } } } } };
  const up = { provider: "secondary", model: "s", client: { chat: { completions: { create: async () => ({ choices: [{ message: { content: "hi" } }] }) } } } };
  const answered = await runChatCompletion({ body: {}, deadline: Date.now() + 10_000, candidates: [down, up] });
  assert.equal(answered.provider, "secondary", "the second provider must serve the turn");
  assert.equal(answered.failedOver, true);
  assert.equal(primaryCalls, 3, "a 503 is retried within its own provider before failing over");
});

test("a request we built wrong is not retried and does not fail over", async () => {
  __resetProviderGatewayForTests();
  let primaryCalls = 0;
  let secondaryCalls = 0;
  const bad = { provider: "primary", model: "p", client: { chat: { completions: { create: async () => {
    primaryCalls += 1;
    throw Object.assign(new Error("invalid tool schema"), { status: 400 });
  } } } } };
  const other = { provider: "secondary", model: "s", client: { chat: { completions: { create: async () => {
    secondaryCalls += 1;
    return { choices: [] };
  } } } } };
  await assert.rejects(runChatCompletion({ body: {}, deadline: Date.now() + 10_000, candidates: [bad, other] }), { status: 400 });
  assert.equal(primaryCalls, 1, "a 400 is our bug; sending it again only spends the deadline");
  assert.equal(secondaryCalls, 0, "a second vendor rejects a malformed request just as firmly");
});

test("a provider that keeps failing is taken out of rotation", async () => {
  __resetProviderGatewayForTests();
  let calls = 0;
  const flapping = { provider: "flapping", model: "f", client: { chat: { completions: { create: async () => {
    calls += 1;
    throw Object.assign(new Error("boom"), { status: 500 });
  } } } } };
  // Three attempts per call, threshold four: the breaker opens during the
  // second request, so the third never reaches the network at all.
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(runChatCompletion({ body: {}, deadline: Date.now() + 10_000, candidates: [flapping] }));
  }
  const before = calls;
  await assert.rejects(
    runChatCompletion({ body: {}, deadline: Date.now() + 10_000, candidates: [flapping] }),
    { code: "AI_PROVIDERS_UNAVAILABLE" },
  );
  assert.equal(calls, before, "an open circuit must not pay the latency of a dead endpoint");
  __resetProviderGatewayForTests();
});
