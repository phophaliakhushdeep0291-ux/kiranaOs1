import assert from "node:assert/strict";
import db from "../src/db.js";
import { seedEvalShop, dropEvalShop } from "./helpers/agent-eval-shop.js";
import { CREATE_PRODUCT_TOOL, newProductInput } from "../src/modules/ai/agent/tools/product-create.js";
import { validateArgs } from "../src/modules/ai/agent/argument-validation.js";
import { toolAvailableTo } from "../src/modules/ai/agent/tool-contract.js";
import { runAgentTurn, executeApprovedPlan } from "../src/modules/ai/agent/agent.service.js";
import "../src/modules/ai/agent/register-core.js";
import { discoverScriptedTools } from "./helpers/agent-tool-discovery.js";

const args = { name: "New rice", unit: "kg", sellingPrice: 64.5, costPrice: 50, openingStock: 2.5, taxRate: 5 };
for (const field of CREATE_PRODUCT_TOOL.parameters.required) {
  const incomplete = { ...args }; delete incomplete[field];
  assert.ok(validateArgs(CREATE_PRODUCT_TOOL, incomplete).length, `must ask for ${field}`);
}
for (const bad of [{ unit: "box" }, { name: "  " }, { sellingPrice: 0 }, { openingStock: -1 }, { taxRate: 101 }, { shopId: "other" }]) {
  assert.ok(validateArgs(CREATE_PRODUCT_TOOL, { ...args, ...bad }).length);
}
assert.deepEqual(newProductInput(args), { name: "New rice", displayUnit: "kg", rateUnit: "kg", baseUnit: "gram", defaultPricePerRateUnit: 64.5, costPerRateUnit: 50, stockBaseQty: 2500, gstRate: 5, stockTrackingEnabled: true, isLooseItem: true });
assert.equal(newProductInput({ ...args, unit: "litre" }).stockBaseQty, 2500);
assert.equal(newProductInput({ ...args, unit: "piece" }).stockBaseQty, 2.5);
assert.equal(toolAvailableTo(CREATE_PRODUCT_TOOL, { role: "staff", features: { has: () => true } }), false);
assert.equal(toolAvailableTo(CREATE_PRODUCT_TOOL, { role: "owner", features: { has: () => false } }), false);

function provider(steps, inspect = () => {}) {
  let index = 0;
  return { provider: "fixture", model: "task-contract", client: { chat: { completions: { create: async body => {
    inspect(body);
    const discovery = discoverScriptedTools(body, (steps[index] ?? []).map(([name]) => name));
    if (discovery) return discovery;
    const calls = steps[index++];
    return { choices: [{ message: calls ? { role: "assistant", tool_calls: calls.map(([name, arguments_], i) => ({ id: `${index}-${i}`, type: "function", function: { name, arguments: JSON.stringify(arguments_) } })) } : { role: "assistant", content: "Not displayed" } }] };
  } } } } };
}
const fixture = await seedEvalShop();
try {
  const { ctx } = fixture;
  const missing = await runAgentTurn(ctx, { message: "naya rice list kar do", language: "en" }, { provider: provider([[['request_clarification', { field: 'product_unit' }]]]) });
  assert.match(missing.reply, /piece, kg/);
  assert.equal(missing.planId, null);
  const mixed = await runAgentTurn(ctx, { message: "Create new rice", language: "en" }, { provider: provider([[['create_product', args], ['request_clarification', { field: 'tax_rate' }]]]) });
  assert.equal(mixed.planId, null, "a clarification blocks every write, including same-step proposals");
  const turn = await runAgentTurn(ctx, { message: "tax five percent, baaki same", language: "en", history: [{ role: "user", content: "New rice, kg, selling 64.5, cost 50, stock 2.5" }, { role: "assistant", content: "What tax percentage?" }] }, { provider: provider([[['create_product', args], ['create_product', args]]], body => {
    assert.ok(body.messages.some(message => message.content.includes("stock 2.5")));
  }) });
  assert.equal(turn.plan.length, 1, "repeated provider proposals must not multiply tasks");
  assert.equal(turn.requiresOwnerPin, true);
  assert.match(turn.plan[0].summary, /64.5.*50.*kg.*2.5 kg.*5%/);
  assert.equal(await db.product.count({ where: { shopId: ctx.shopId, name: args.name } }), 0, "chat only proposes");
  await assert.rejects(executeApprovedPlan(ctx, { planId: turn.planId }), { code: "OWNER_PIN_REQUIRED" });
  await assert.rejects(executeApprovedPlan({ ...ctx, shopId: "other" }, { planId: turn.planId, ownerPinVerified: true }), { code: "AI_PLAN_NOT_FOUND" });
  const executed = await executeApprovedPlan(ctx, { planId: turn.planId, ownerPinVerified: true });
  assert.equal(executed.allSucceeded, true);
  assert.deepEqual(executed.clientActions[0].payload.product, newProductInput(args));
  assert.equal(await db.product.count({ where: { shopId: ctx.shopId, name: args.name } }), 0, "server hands creation to the offline-first till");
  await assert.rejects(executeApprovedPlan(ctx, { planId: turn.planId, ownerPinVerified: true }), { code: "AI_PLAN_ALREADY_RESOLVED" });
  await assert.rejects(CREATE_PRODUCT_TOOL.handler({ ...args, name: "Sugar" }, ctx), { code: "PRODUCT_NAME_DUPLICATE" });
  await assert.rejects(CREATE_PRODUCT_TOOL.handler(args, { ...ctx, businessType: "pharmacy" }), { code: "AI_PRODUCT_FORM_REQUIRED" });
  console.log("Product tasks passed: required details, follow-up context, clarification blocks writes, PIN, tenant, duplicate and single-use guards; local-first delivery.");
} finally { await dropEvalShop(fixture); }
