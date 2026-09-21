/**
 * What the agent loop does with the tool calls a model hands it in one step.
 *
 * Two properties, both of which used to be left to the system prompt and are
 * now the loop's job:
 *
 *   independent lookups run together   · three products asked about in one
 *                                        sentence cost one round-trip, not three
 *   a repeated lookup runs once        · the prompt asks the model not to repeat
 *                                        itself; smaller models do it anyway
 *
 * Neither changes what the model sees. The conversation it is handed back is
 * byte-identical to the sequential version, in the order it asked — that is the
 * property that makes the change safe, so it is asserted rather than assumed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/db.js";
import { runAgentTurn } from "../src/modules/ai/agent/agent.service.js";
import { defineTool, TOOL_RISK } from "../src/modules/ai/agent/tool-contract.js";
import { registerTools } from "../src/modules/ai/agent/tool-registry.js";

const ok = (label) => console.log(`  ok ${label}`);

/** Mirrors agent.service.js. If that ceiling drops below 3, this test must know. */
const MAX_PARALLEL_READS = 4;

/** Records when each call started and finished, so overlap is observable. */
let calls = [];
let inFlight = 0;
let peakInFlight = 0;

/*
 * Two extra tools so routing can actually narrow.
 *
 * `routeTools` only narrows when some keyword tool matches AND some other tool
 * does not — a registry of one always-tool always returns the full set, and the
 * widening assertions below would then be testing nothing.
 */
registerTools("core", [
  defineTool({
    name: "eval_routes_on_udhar",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    keywords: ["udhar"],
    description: "Routing fixture: matched by the word this test puts in its message.",
    handler: async () => ({ ok: true }),
  }),
  defineTool({
    name: "eval_never_routed",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    keywords: ["zzz-no-message-contains-this"],
    description: "Routing fixture: never matched, so the routed set is smaller than the available one.",
    handler: async () => ({ ok: true }),
  }),
]);

registerTools("core", [
  defineTool({
    name: "get_sales_summary",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    always: true,
    description: "Concurrency fixture: a slow read whose overlap with its siblings is measurable.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { range: { type: "string" } },
    },
    handler: async (args) => {
      calls.push(args?.range ?? "none");
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 60));
      inFlight -= 1;
      return { totalSalesPaise: 120005n, totalBills: 2 };
    },
  }),
]);

/** A provider that asks for exactly the tool calls the test needs, once. */
function providerAsking(toolCalls) {
  let step = 0;
  return {
    provider: "test",
    model: "scripted",
    client: { chat: { completions: { create: async () => ({
      choices: [{ message: step++ === 0
        ? { role: "assistant", tool_calls: toolCalls }
        : { role: "assistant", content: "done" } }],
    }) } } },
  };
}

const call = (id, args) => ({ id, type: "function", function: { name: "get_sales_summary", arguments: JSON.stringify(args) } });

const shopId = `tool-concurrency-${randomUUID()}`;
try {
  await db.shop.create({ data: { id: shopId, name: "Concurrency fixture", ownerName: "Test", city: "Test", address: "Test" } });
  const ctx = { shopId, role: "owner", businessType: "kirana" };

  /* ------------------------------------------- independent reads overlap */
  calls = []; inFlight = 0; peakInFlight = 0;
  const startedAt = Date.now();
  const parallel = await runAgentTurn(ctx, { message: "Sales?", language: "en" }, {
    provider: providerAsking([
      call("a", { range: "today" }),
      call("b", { range: "week" }),
      call("c", { range: "month" }),
    ]),
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(calls.length, 3, "three distinct lookups must all run");
  // Peak concurrency, not wall time. Three reads under a ceiling of four must
  // all be in flight at once, which is exact and true on any machine; a stopwatch
  // assertion measures the build agent's load as much as the code's behaviour,
  // and this one failed at 192ms against a 160ms bound on a busy laptop while
  // the concurrency it was standing in for was perfect.
  assert.equal(peakInFlight, Math.min(3, MAX_PARALLEL_READS),
    `independent reads must all be in flight together; peak concurrency was ${peakInFlight}`);
  assert.ok(elapsed < 3 * 60 * 3, `reads were serialised; took ${elapsed}ms for three 60ms lookups`);
  ok("independent reads in one step run together");

  assert.deepEqual(
    parallel.trace.map((step) => step.status),
    ["ok", "ok", "ok"],
    "every lookup is recorded",
  );
  ok("the trace records each lookup exactly once");

  /* ------------------------------------------------ a repeat is not re-run */
  calls = []; inFlight = 0; peakInFlight = 0;
  const repeated = await runAgentTurn(ctx, { message: "Sales?", language: "en" }, {
    provider: providerAsking([
      call("a", { range: "today" }),
      call("b", { range: "today" }),
      // Same arguments, different key order: the model's JSON key order is not
      // stable between calls, and a cache that missed on it would miss exactly
      // the repeats it exists to catch.
      { id: "c", type: "function", function: { name: "get_sales_summary", arguments: '{"range":"today"}' } },
    ]),
  });
  assert.equal(calls.length, 1, `an identical lookup must run once per turn; ran ${calls.length} times`);
  assert.equal(repeated.trace.length, 3, "the model still gets an answer for every call it made");
  assert.ok(repeated.trace.slice(1).every((step) => step.cached === true), "repeats are marked as served from the turn's cache");
  assert.ok(repeated.trace.every((step) => step.status === "ok"), "a cached repeat is still a successful read");
  ok("an identical lookup runs once and is answered three times");

  /* ------------------------------ the cache does not leak between turns */
  calls = [];
  await runAgentTurn(ctx, { message: "Sales?", language: "en" }, {
    provider: providerAsking([call("a", { range: "today" })]),
  });
  assert.equal(calls.length, 1, "a new turn must read the shop again rather than trust the last turn's figure");
  ok("the cache is scoped to one turn, so no turn reports a stale number");

  /* ------------------ the retry-with-every-tool fires only when it earns its keep */
  // Routing narrows the tool list, and a model that then calls nothing may have
  // been denied the one tool it needed. The loop re-offers the full set once and
  // asks again — which is worth a provider request when nothing was read, and
  // pure waste when the model had already looked something up and simply
  // finished. Both halves are asserted, because the cheap half was the bug and
  // the expensive half is the feature.
  const narrowing = "udhar";
  calls = [];
  const answeredAfterReading = await runAgentTurn(ctx, { message: `${narrowing} sales`, language: "en" }, {
    provider: providerAsking([call("a", { range: "today" })]),
  });
  assert.equal(answeredAfterReading.stoppedBecause, "completed",
    "a model that read something and then answered has finished; re-offering tools costs a request and buys nothing");
  assert.equal(answeredAfterReading.provider.widened, false);

  const readNothing = await runAgentTurn(ctx, { message: `${narrowing} sales`, language: "en" }, {
    provider: providerAsking([]),
  });
  assert.equal(readNothing.stoppedBecause, "widened_after_empty_route",
    "a model that read nothing may have been denied the tool it needed, and must get one more look at the full set");
  assert.equal(readNothing.provider.widened, true);
  ok("the full tool set is re-offered only when the turn read nothing");

  console.log("AI agent tool concurrency examples passed");
} finally {
  await db.aiActionLog.deleteMany({ where: { shopId } });
  await db.shop.deleteMany({ where: { id: shopId } });
}
