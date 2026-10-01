import test from "node:test";
import assert from "node:assert/strict";
import { validateArgs } from "../src/modules/ai/agent/argument-validation.js";
import { runChatCompletion, runTranscription, __resetProviderGatewayForTests } from "../src/modules/ai/provider-gateway.js";

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

test("a per-vendor body is worded for whoever actually answers, not for whoever was asked first", async () => {
  __resetProviderGatewayForTests();
  const seen = [];
  const capture = (provider, behaviour) => ({
    provider, model: `${provider}-model`,
    client: { chat: { completions: { create: async (request) => {
      seen.push({ provider, responseFormat: request.response_format?.type, model: request.model });
      return behaviour();
    } } } },
  });
  const groq = capture("groq", () => { throw Object.assign(new Error("down"), { status: 500 }); });
  const openai = capture("openai", () => ({ choices: [] }));

  const answered = await runChatCompletion({
    deadline: Date.now() + 10_000,
    candidates: [groq, openai],
    // Exactly the shape the command parser and the incident reporter use.
    body: (candidate) => ({
      temperature: 0,
      response_format: candidate.provider === "openai"
        ? { type: "json_schema", json_schema: { name: "x", strict: true, schema: {} } }
        : { type: "json_object" },
    }),
  });

  assert.equal(answered.provider, "openai", "the failover target answered");
  assert.equal(answered.failedOver, true);
  // The point of the whole mechanism: had the body been built once, up front,
  // OpenAI would have been sent Groq's weaker json_object and the schema the
  // caller depends on would have gone silently unenforced.
  assert.equal(seen.at(0).responseFormat, "json_object", "Groq is asked for plain JSON");
  assert.equal(seen.at(-1).responseFormat, "json_schema", "OpenAI is asked to enforce the schema");
  assert.equal(seen.at(-1).model, "openai-model", "each attempt carries its own vendor's model");
  __resetProviderGatewayForTests();
});

test("transcription opens the audio again for every attempt instead of re-sending a spent stream", async () => {
  __resetProviderGatewayForTests();
  let opened = 0;
  const destroyed = [];
  // A read stream is consumed by the attempt that fails. Handing the same one
  // to the retry would upload nothing and be reported as empty speech, so the
  // gateway must be given a factory and must call it once per attempt.
  const openAudio = () => {
    const handle = { id: ++opened, destroy() { destroyed.push(this.id); } };
    return handle;
  };
  const uploads = [];
  const transcriber = (provider, behaviour) => ({
    provider, model: `${provider}-whisper`,
    client: { audio: { transcriptions: { create: async (request) => {
      uploads.push({ provider, audioId: request.file.id, model: request.model, prompt: request.prompt });
      return behaviour();
    } } } },
  });
  const groq = transcriber("groq", () => { throw Object.assign(new Error("down"), { status: 503 }); });
  const openai = transcriber("openai", () => ({ text: "  do kilo chini  " }));

  const answered = await runTranscription({
    deadline: Date.now() + 10_000,
    candidates: [groq, openai],
    prompt: "kirana",
    openAudio,
  });

  assert.equal(answered.transcript, "do kilo chini", "the transcript is trimmed for the parser");
  assert.equal(answered.provider, "openai");
  assert.equal(answered.failedOver, true, "a silenced voice feature is the failure this prevents");
  assert.equal(uploads.length, opened, "every attempt opened its own audio");
  assert.equal(new Set(uploads.map((row) => row.audioId)).size, uploads.length, "no attempt re-sent a spent stream");
  assert.deepEqual(destroyed, uploads.map((row) => row.audioId), "and every one of them was closed again");
  assert.equal(uploads.at(-1).model, "openai-whisper", "each vendor is asked for its own transcription model");
  assert.equal(uploads.at(-1).prompt, "kirana", "the domain prompt survives failover");
  __resetProviderGatewayForTests();
});
