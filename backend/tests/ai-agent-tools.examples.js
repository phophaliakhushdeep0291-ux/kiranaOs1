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
