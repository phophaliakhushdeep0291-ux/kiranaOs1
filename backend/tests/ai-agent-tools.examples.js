/**
 * The agent's safety properties, asserted rather than assumed.
 *
 * The loop lets a language model read a shop's real data and propose changes to
 * it. That is only defensible because of a handful of structural facts, and a
 * structural fact that nothing checks is a convention waiting to be broken by
 * the next person who adds a tool in a hurry.
 *
 * These run without a network or a provider: every property here is a property
 * of the contract and the registry, not of any particular model's behaviour.
 */
import assert from "node:assert/strict";
import { defineTool, toolAvailableTo, TOOL_RISK } from "../src/modules/ai/agent/tool-contract.js";
import { registerTools, toolsFor, getTool, registrySnapshot, ownerOf } from "../src/modules/ai/agent/tool-registry.js";
import { __agentInternals } from "../src/modules/ai/agent/agent.service.js";
import { agentChatSchema } from "../src/modules/ai/ai.schema.js";
import { CORE_READ_TOOLS } from "../src/modules/ai/agent/tools/core-read.js";
import { CORE_WRITE_TOOLS } from "../src/modules/ai/agent/tools/core-write.js";
import { RESTAURANT_TOOLS } from "../src/verticals/restaurant/ai/tools.js";
import "../src/modules/ai/agent/register-core.js";

const ok = (label) => console.log(`  ok ${label}`);

/* ---------------------------------------------------------------- contract */

// A model cannot name another shop if there is no parameter that means "shop".
// This is the tenant boundary, and it is worth failing the build over.
for (const forbidden of ["shopId", "userId", "tenantId"]) {
  assert.throws(
    () => defineTool({
      name: "bad_tool",
      kind: "read",
      risk: TOOL_RISK.SAFE,
      description: "A tool that should never be constructible at all.",
      parameters: { type: "object", properties: { [forbidden]: { type: "string" } }, additionalProperties: false },
      handler: async () => ({}),
    }),
    new RegExp(forbidden),
    `${forbidden} must be rejected as a model-supplied parameter`,
  );
}
ok("a tool cannot accept a tenant identifier from the model");

// A read runs unattended inside the loop. There is no confirmation step there to
// honour a higher risk level, so a non-safe read would silently run anyway.
assert.throws(() => defineTool({
  name: "risky_read",
  kind: "read",
  risk: TOOL_RISK.CONFIRM,
  description: "A read that pretends it will be confirmed before running.",
  handler: async () => ({}),
}), /must be risk "safe"/);
ok("a read tool cannot claim a confirmation it will never get");

// The mirror image: a write marked safe would be a write with no gate.
assert.throws(() => defineTool({
  name: "ungated_write",
  kind: "write",
  risk: TOOL_RISK.SAFE,
  description: "A write that would slip through without any confirmation.",
  summarize: () => "x",
  handler: async () => ({}),
}), /cannot be risk "safe"/);
ok("a write tool cannot be marked safe");

// The shopkeeper confirms a sentence, not a JSON blob.
assert.throws(() => defineTool({
  name: "silent_write",
  kind: "write",
  risk: TOOL_RISK.CONFIRM,
  description: "A write with nothing a human could read before agreeing to it.",
  handler: async () => ({}),
}), /summarize/);
ok("a write tool must be able to describe itself in words");

/* ---------------------------------------------------------------- registry */

assert.throws(
  () => registerTools("core", [CORE_READ_TOOLS[0]]),
  /already registered/,
  "a duplicate tool name must not silently shadow another trade's tool",
);
ok("tool names are globally unique");

/* ------------------------------------------------------------- core tools */

const coreTools = [...CORE_READ_TOOLS, ...CORE_WRITE_TOOLS];
assert.ok(coreTools.length >= 12, "the core tool set cannot silently shrink");

for (const tool of coreTools) {
  const properties = tool.parameters?.properties ?? {};
  for (const forbidden of ["shopId", "userId", "tenantId"]) {
    assert.ok(!(forbidden in properties), `${tool.name} must not expose ${forbidden}`);
  }
  assert.equal(tool.parameters?.additionalProperties, false, `${tool.name} must reject unknown arguments`);
  if (tool.kind === "read") assert.equal(tool.risk, TOOL_RISK.SAFE, `${tool.name} is a read and must be safe`);
  if (tool.kind === "write") {
    assert.notEqual(tool.risk, TOOL_RISK.SAFE, `${tool.name} is a write and needs a gate`);
    assert.equal(typeof tool.summarize, "function", `${tool.name} must summarize itself`);
    const sentence = tool.summarize(sampleArgsFor(tool), { labelFor: () => "Sugar" });
    assert.ok(typeof sentence === "string" && sentence.length > 8, `${tool.name} must produce a readable sentence`);
  }
}
ok(`all ${coreTools.length} core tools honour the contract`);

// Money and stock are the two things a wrong proposal costs real money, so both
// sit behind the owner PIN rather than a tap-through confirmation.
const byName = Object.fromEntries(coreTools.map((tool) => [tool.name, tool]));
assert.equal(byName.update_product_price.risk, TOOL_RISK.OWNER_PIN, "a price change needs the owner PIN");
assert.equal(byName.correct_stock.risk, TOOL_RISK.OWNER_PIN, "a stock correction needs the owner PIN");
ok("price and stock changes sit behind the owner PIN");

/* -------------------------------------------------------- vertical packing */

// The isolation guarantee, from the assistant's side: a grocer must never be
// offered a restaurant tool, whatever the model asks for.
const kirana = { businessType: "kirana", role: "owner", features: { has: () => true } };
const restaurant = { businessType: "restaurant", role: "owner", features: { has: () => true } };

const kiranaNames = toolsFor(kirana).map((tool) => tool.name);
const restaurantNames = toolsFor(restaurant).map((tool) => tool.name);

for (const tool of RESTAURANT_TOOLS) {
  assert.ok(!kiranaNames.includes(tool.name), `a kirana shop must not be offered ${tool.name}`);
  assert.ok(restaurantNames.includes(tool.name), `a restaurant must be offered ${tool.name}`);
  assert.equal(ownerOf(tool.name), "restaurant");
}
assert.ok(kiranaNames.includes("search_products"), "core tools reach every trade");
ok("restaurant tools reach restaurants only");

// A Counter shop — takeaway, no floor — has not bought the table features, and
// is not told they exist.
const counter = {
  businessType: "restaurant",
  role: "owner",
  features: { has: (name) => name === "restaurant_menu" },
};
const counterNames = toolsFor(counter).map((tool) => tool.name);
assert.ok(counterNames.includes("restaurant_menu_board"), "Counter keeps the menu");
assert.ok(!counterNames.includes("restaurant_list_tables"), "Counter is not offered tables it cannot use");
assert.ok(!counterNames.includes("restaurant_kitchen_tickets"), "Counter is not offered kitchen tickets");
ok("an unentitled feature hides its tools rather than refusing them later");

/* ------------------------------------------------------------------ roles */

const rolebound = defineTool({
  name: "owner_only_probe",
  kind: "read",
  risk: TOOL_RISK.SAFE,
  description: "A probe used only to prove role filtering actually filters.",
  roles: ["owner"],
  handler: async () => ({}),
});
assert.equal(toolAvailableTo(rolebound, { role: "owner", features: { has: () => true } }), true);
assert.equal(toolAvailableTo(rolebound, { role: "staff", features: { has: () => true } }), false);
ok("role-bound tools are hidden from the wrong role");

/* --------------------------------------------------------------- registry */

/* --------------------------------------------------- tool result encoding */

// Prisma returns BigInt for every `*Paise` shadow column, and JSON.stringify
// throws on one. This was a real failure: get_customer_khata queried correctly,
// then died at serialisation, and the trace recorded the same call as both ok
// and error. Any tool reading a money row would have hit it.
const encoded = __agentInternals.toolResultMessage("call_1", "get_customer_khata", {
  balancePaise: 123456789012345678n,
  paidAt: new Date("2026-08-30T00:00:00.000Z"),
  name: "Ramesh",
});
const decoded = JSON.parse(encoded.content);
assert.equal(decoded.result.balancePaise, "123456789012345678", "a paise BigInt must survive as an exact string");
assert.equal(decoded.result.paidAt, "2026-08-30T00:00:00.000Z");
assert.equal(decoded.untrustedData, true, "tool output must be labelled as data, not instructions");
ok("tool results encode BigInt money without throwing");

// Encoding must never take the turn down, whatever a service hands back.
const circular = { name: "loop" };
circular.self = circular;
const safe = __agentInternals.toolResultMessage("call_2", "search_products", circular);
assert.ok(JSON.parse(safe.content).error, "an unencodable result becomes a reported error, not a crash");
ok("an unencodable result degrades instead of crashing the turn");

/* --------------------------------------------------------------- language */

// Hindi is this app's default language, so a request that omits the field must
// not quietly mean English. The service treats undefined as Hindi; the schema's
// job is only to keep the field optional and to refuse anything it cannot map.
assert.equal(agentChatSchema.safeParse({ message: "चीनी कितनी है?" }).success, true, "language is optional");
assert.equal(agentChatSchema.safeParse({ message: "hi", language: "hi" }).success, true);
assert.equal(agentChatSchema.safeParse({ message: "hi", language: "en" }).success, true);
assert.equal(agentChatSchema.safeParse({ message: "hi", language: "fr" }).success, false, "an unsupported language is refused, not guessed");
assert.equal(agentChatSchema.safeParse({ message: "hi", planId: "x" }).success, false, "the chat body stays strict");
ok("the chat schema carries the shop's language and refuses the rest");

/* --------------------------------------------------------------- registry */

const snapshot = registrySnapshot();
assert.ok(snapshot.every((row) => row.owner === "core" || row.owner === "restaurant"));
assert.equal(getTool("search_products")?.kind, "read");
assert.equal(getTool("nonexistent_tool"), null);
ok("the registry reports what it holds");

/** Plausible arguments for a write tool, so summarize() can be exercised. */
function sampleArgsFor(tool) {
  const sample = {};
  for (const [key, spec] of Object.entries(tool.parameters?.properties ?? {})) {
    if (Array.isArray(spec.enum)) sample[key] = spec.enum[0];
    else if (spec.type === "number" || spec.type === "integer") sample[key] = 5;
    else if (spec.type === "boolean") sample[key] = true;
    else sample[key] = "sample";
  }
  return sample;
}

console.log("ai-agent-tools.examples.js OK");
