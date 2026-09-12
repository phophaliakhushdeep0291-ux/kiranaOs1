import test from "node:test";
import assert from "node:assert/strict";
import { validateArgs } from "../src/modules/ai/agent/argument-validation.js";
import { providerCompletion } from "../src/modules/ai/agent/provider-completion.js";

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
  let requestOptions;
  const selected = { client: { chat: { completions: { create: (_body, options) => {
    requestOptions = options;
    return new Promise(() => {});
  } } } } };
  await assert.rejects(providerCompletion(selected, {}, Date.now() + 30), { code: "AI_TURN_TIMEOUT" });
  assert.equal(requestOptions.signal.aborted, true);
  assert.equal(requestOptions.maxRetries, 0);
  assert.ok(requestOptions.timeout <= 30);
  await assert.rejects(providerCompletion(selected, {}, Date.now() - 1), { code: "AI_TURN_TIMEOUT" });
});

test("provider completion preserves a successful response", async () => {
  const selected = { client: { chat: { completions: { create: async () => ({ choices: [] }) } } } };
  assert.deepEqual(await providerCompletion(selected, {}, Date.now() + 1000), { choices: [] });
});
