import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/db.js";
import "../src/modules/ai/agent/register-core.js";
import "../src/verticals/restaurant/ai/tools.js";
import { toolsFor, routeTools } from "../src/modules/ai/agent/tool-registry.js";
import { createToolOffer, DISCOVERY_TOOL, CLARIFICATION_TOOL } from "../src/modules/ai/agent/tool-discovery.js";
import { runAgentTurn } from "../src/modules/ai/agent/agent.service.js";

const ctx = { role: "owner", businessType: "restaurant", features: { has: () => true } };
const available = toolsFor(ctx);
const offer = createToolOffer(available, available);
assert.equal(offer.discoveryOnly, true, "the real expanded catalogue must not overflow a short greeting");
assert.ok(Buffer.byteLength(JSON.stringify(offer.tools)) < 10_000);
const allNames = offer.tools[0].function.parameters.properties.names.items.enum;
assert.deepEqual(allNames, available.map(tool => tool.name), "every permitted task remains discoverable");
for (const args of [null, [], {}, { names: [] }, { names: ["__proto__"] }, { names: ["get_available_tasks"], shopId: "other" }, { names: ["get_available_tasks", "get_available_tasks"] }, { names: allNames.slice(0, 5) }]) {
  assert.ok(offer.load(args).error);
  assert.equal(offer.discoveryOnly, true, "invalid discovery cannot change the offer");
}
assert.deepEqual(offer.load({ names: ["create_product", "search_products"] }).loaded, ["create_product", "search_products"]);
assert.equal(offer.discoveryOnly, false);
assert.deepEqual(offer.tools.slice(0, -1).map(tool => tool.function.name), ["create_product", "search_products", CLARIFICATION_TOOL]);
assert.ok(offer.load({ names: ["receive_purchase_order"] }).loaded, "a later step can load a different task");
assert.equal(offer.tools[0].function.name, "receive_purchase_order");
offer.widen();
assert.equal(offer.discoveryOnly, true);

const viewer = toolsFor({ ...ctx, role: "viewer" });
const viewerOffer = createToolOffer(viewer, viewer);
assert.ok(!viewerOffer.tools.some(tool => tool.function.name === "create_product"));
const denied = viewerOffer.load({ names: ["create_product"] });
assert.ok(!denied || denied.error, "discovery never grants a role a write");
const narrowed = createToolOffer(available, routeTools(available, "open products"));
assert.ok(narrowed.tools.some(tool => tool.function.name === "get_workflow"), "known short routes still avoid an extra discovery call");

const shopId = `tool-discovery-${randomUUID()}`;
const call = (name, args, id) => ({ role: "assistant", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
try {
  await db.shop.create({ data: { id: shopId, name: "Discovery fixture", ownerName: "Test", city: "Test", address: "Test" } });
  for (const [language, message, tool, args] of [
    ["en", "Hello", "get_available_tasks", {}],
    ["hi", "बिलिंग खोलो", "get_workflow", { workflows: ["billing"] }],
    ["auto", "open products", "get_workflow", { workflows: ["products"] }],
  ]) {
    let calls = 0;
    const sizes = [];
    const provider = { provider: "discovery-test", model: "fixture", client: { chat: { completions: { create: async body => {
      sizes.push(Buffer.byteLength(JSON.stringify(body)));
      if (body.tools) assert.ok(body.tools.some(row => row.function.name === CLARIFICATION_TOOL), "clarification remains callable when the execution policy requires it");
      assert.ok(sizes.at(-1) < 20_000, "short commands stay well below the rejected 9,259-token request");
      if (body.tool_choice === "required") {
        assert.ok(body.messages.some(row => row.content === message), "discovery preserves the user's language and wording");
        calls++;
        return { choices: [{ message: call(DISCOVERY_TOOL, { names: [tool] }, "load") }] };
      }
      if (!body.tools) return { choices: [{ message: { content: "{}" } }] }; // automatic localization may safely fall back
      assert.ok(body.messages[0].content.includes("Tools that change data are proposals"), "execution always restores the complete security policy");
      assert.ok(body.tools.some(row => row.function.name === tool));
      const alreadyRead = body.messages.some(row => row.role === "tool" && row.content.includes(`\"tool\":\"${tool}\"`));
      calls++;
      return { choices: [{ message: alreadyRead ? { role: "assistant", content: "done" } : call(tool, args, "read") }] };
    } } } } };
    const result = await runAgentTurn({ shopId, role: "owner", businessType: "restaurant" }, { language, message }, { provider });
    assert.equal(result.planId, null);
    assert.equal(result.requiresConfirmation, false);
    assert.ok(result.trace.some(row => row.tool === tool && row.status === "ok"));
    assert.ok(!result.trace.some(row => row.tool === DISCOVERY_TOOL), "loading schemas must not be reported as business work");
    assert.ok(calls <= 3);
    console.log(message, "request bytes:", sizes.join(", "));
  }
  // Reproduce the live provider rejection: it validates the returned function
  // name against request.tools before the server can inspect the response.
  for (const afterLoad of [false, true]) {
    let calls = 0;
    const provider = { provider: "clarification-test", model: "fixture", client: { chat: { completions: { create: async body => {
      calls++;
      if (afterLoad && calls === 1) return { choices: [{ message: call(DISCOVERY_TOOL, { names: ["create_product"] }, "load-product") }] };
      if (!body.tools?.some(row => row.function.name === CLARIFICATION_TOOL)) {
        throw Object.assign(new Error("attempted to call tool 'request_clarification' which was not in request.tools"), { status: 400, code: "tool_use_failed" });
      }
      return { choices: [{ message: call(CLARIFICATION_TOOL, { field: "product_name" }, "ask-name") }] };
    } } } } };
    const result = await runAgentTurn({ shopId, role: "owner", businessType: "restaurant" }, { language: "en", message: "add a product" }, { provider });
    assert.equal(result.stoppedBecause, "clarification_requested");
    assert.equal(result.planId, null);
    assert.deepEqual(result.trace.map(row => row.tool), [CLARIFICATION_TOOL]);
    assert.equal(calls, afterLoad ? 2 : 1);
  }
  // A provider may emit extra calls despite forced tool_choice. Loading and
  // calling a business tool in the same planning response cannot execute it.
  let hostileCalls = 0;
  const hostileProvider = { provider: "discovery-test", model: "fixture", client: { chat: { completions: { create: async body => {
    hostileCalls++;
    if (hostileCalls === 1) {
      assert.equal(body.tool_choice, "required");
      return { choices: [{ message: { role: "assistant", tool_calls: [
        ...call(DISCOVERY_TOOL, { names: ["get_available_tasks"] }, "load").tool_calls,
        ...call("get_available_tasks", {}, "premature-read").tool_calls,
      ] } }] };
    }
    assert.ok(body.messages.some(row => row.tool_call_id === "premature-read" && row.content.includes("only load schemas")));
    return { choices: [{ message: { role: "assistant", content: "Unable to continue." } }] };
  } } } } };
  const guarded = await runAgentTurn({ shopId, role: "owner", businessType: "restaurant" }, { language: "en", message: "Hello" }, { provider: hostileProvider });
  assert.equal(guarded.trace.length, 0, "planning cannot read or propose business work even after loading its schema");
  assert.equal(guarded.planId, null);
} finally {
  await db.aiActionLog.deleteMany({ where: { shopId } });
  await db.shop.deleteMany({ where: { id: shopId } });
}
console.log("Tool discovery passed: real catalogue budget, language preservation, role isolation, malformed selections and grounded read/handoff flows.");
