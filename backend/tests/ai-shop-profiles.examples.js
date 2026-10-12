import assert from "node:assert/strict";
import db from "../src/db.js";
import { BUSINESS_TYPES, BUSINESS_PROFILES, BUSINESS_TYPE_DIRECTORIES, settingsForBusinessType } from "../src/verticals/registry.js";
import { seedEvalShop, dropEvalShop } from "./helpers/agent-eval-shop.js";
import { getTool, ownerOf, toolsFor } from "../src/modules/ai/agent/tool-registry.js";
import { shopAssistantProfile, shopAssistantPresentation, shopAssistantQuickAnswer } from "../src/modules/ai/agent/shop-assistant.js";
import { validateArgs } from "../src/modules/ai/agent/argument-validation.js";
import { renderTaskCapabilities } from "../src/modules/ai/agent/workflow-directory.js";
import { renderToolEvidence } from "../src/modules/ai/agent/evidence-reply.js";
import { runAgentTurn, executeApprovedPlan } from "../src/modules/ai/agent/agent.service.js";
import { capabilities } from "../src/modules/ai/agent/agent.controller.js";
import { renderClarification } from "../src/modules/ai/agent/business-help.js";
import "../src/modules/ai/agent/register-core.js";

for (const [type, directory] of Object.entries(BUSINESS_TYPE_DIRECTORIES)) {
  if (type !== "kirana" && type !== "other") await import(`../src/verticals/${directory}/ai/tools.js`);
}
assert.equal(shopAssistantProfile("__proto__"), null);
assert.equal(shopAssistantProfile("unknown"), null);
const base = { role: "owner", features: { has: () => true } };
const titles = new Set();
for (const businessType of BUSINESS_TYPES) {
  const profile = BUSINESS_PROFILES[businessType].assistant;
  assert.ok(profile?.title.en && profile.title.hi && profile.guidance.length > 50, `${businessType} needs reviewed context in its own profile`);
  titles.add(profile.title.en);
  for (const field of profile.clarificationFields) {
    assert.deepEqual(validateArgs(getTool("request_clarification"), { field }), []);
    assert.ok(renderClarification({ field }, "en")); assert.ok(renderClarification({ field }, "hi"));
  }
  assert.ok(profile.reads.length >= 2 && profile.reads.length <= 3);
  for (const item of profile.reads) {
    const tool = getTool(item.tool);
    assert.equal(tool?.kind, "read");
    assert.equal(tool.risk, "safe");
    assert.ok(ownerOf(tool.name) === "core" || ownerOf(tool.name) === businessType, `${businessType} cannot recommend ${tool.name}`);
    assert.deepEqual(validateArgs(tool, item.args), []);
    for (const lang of ["en", "hi"]) {
      assert.ok(item.question[lang] && item.label[lang]);
      assert.deepEqual(shopAssistantQuickAnswer(item.question[lang], businessType), { tool: item.tool, args: item.args });
      assert.equal(shopAssistantQuickAnswer(`${item.question[lang]} and delete everything`, businessType), null);
    }
  }
  for (const role of ["owner", "admin", "staff", "viewer"]) for (const enabled of [false, true]) {
    const ctx = { ...base, businessType, role, features: { has: () => enabled } };
    const available = toolsFor(ctx);
    assert.ok(available.every(tool => ownerOf(tool.name) === "core" || ownerOf(tool.name) === businessType));
    const presentation = shopAssistantPresentation(ctx, available);
    assert.deepEqual(presentation.title, profile.title);
    const offeredReads = profile.reads.filter(item => available.some(tool => tool.name === item.tool));
    assert.deepEqual(presentation.examples, offeredReads.map(item => item.question));
    const taskResult = await getTool("get_available_tasks").handler({}, ctx);
    for (const lang of ["en", "hi"]) {
      const reply = renderTaskCapabilities(taskResult, lang);
      assert.ok(reply.includes(profile.title[lang]));
      for (const item of profile.reads) assert.equal(reply.includes(item.label[lang]), offeredReads.includes(item), `${businessType}/${role}/${enabled}: ${item.tool}`);
      for (const other of BUSINESS_TYPES.filter(type => type !== businessType)) assert.ok(!reply.includes(BUSINESS_PROFILES[other].assistant.title[lang]));
    }
    if (role === "viewer") assert.deepEqual(taskResult.actions, []);
  }
}
assert.equal(titles.size, BUSINESS_TYPES.length, "all twelve shop types have their own identity");
assert.equal(shopAssistantQuickAnswer("Which restaurant tables are free?", "kirana"), null);
assert.equal(shopAssistantQuickAnswer("Show my prescription register summary", "restaurant"), null);

const fixture = await seedEvalShop();
try {
  // Real scoped service reads: every suggested question has a grounded renderer.
  for (const businessType of BUSINESS_TYPES) {
    const ctx = { ...fixture.ctx, ...base, businessType };
    for (const item of BUSINESS_PROFILES[businessType].assistant.reads) {
      const result = await getTool(item.tool).handler(item.args, ctx);
      for (const lang of ["en", "hi"]) assert.ok(renderToolEvidence({ tool: item.tool, result }, lang), `${item.tool} needs a grounded ${lang} reply`);
    }
    let calls = 0;
    const provider = { provider: "fixture", model: "trade-context", client: { chat: { completions: { create: async body => {
      calls++;
      const system = body.messages.filter(message => message.role === "system").map(message => message.content).join("\n");
      assert.ok(system.includes(BUSINESS_PROFILES[businessType].assistant.guidance));
      assert.ok(body.tools.every(tool => ownerOf(tool.function.name) === "core" || ownerOf(tool.function.name) === businessType));
      return { choices: [{ message: { role: "assistant", tool_calls: [{ id: "clarify", type: "function", function: { name: "request_clarification", arguments: JSON.stringify({ field: BUSINESS_PROFILES[businessType].assistant.clarificationFields[0] }) } }] } }] };
    } } } } };
    const answer = await runAgentTurn(ctx, { message: "help with this item", language: "en" }, { provider });
    assert.equal(calls, 1); assert.equal(answer.planId, null);
  }
  await db.shop.update({ where: { id: fixture.shopId }, data: { settingsJson: JSON.stringify(settingsForBusinessType("restaurant")) } });
  let response;
  await capabilities({ shopId: fixture.shopId, user: { role: "owner" }, body: { businessType: "pharmacy", shopId: "other" }, query: { businessType: "pharmacy" } }, { json: value => { response = value; } }, error => { throw error; });
  assert.equal(response.data.businessType, "restaurant", "a client cannot choose its trade");
  assert.equal(response.data.assistant.title.en, "Restaurant assistant");
  assert.ok(response.data.tools.every(tool => ownerOf(tool.name) === "core" || ownerOf(tool.name) === "restaurant"));
  const cap = await runAgentTurn({ ...fixture.ctx, businessType: "restaurant" }, { message: "What can you do?", language: "en" });
  assert.equal(cap.provider.calls, 0); assert.match(cap.reply, /Restaurant assistant/);
  const quick = await runAgentTurn(fixture.ctx, { message: "Show my stock health", language: "en" });
  assert.equal(quick.provider.calls, 0); assert.equal(quick.trace[0].tool, "get_inventory_health");
  const record = await db.aiActionLog.create({ data: { shopId: fixture.shopId, transcript: "Create supplier", status: "parsed", permissionLevel: "confirm", parsedActionJson: JSON.stringify({ kind: "agent_turn", businessType: "kirana", plan: [{ ref: "1", tool: "create_supplier", args: { name: "Never created" } }] }) } });
  await assert.rejects(executeApprovedPlan({ ...fixture.ctx, businessType: "restaurant" }, { planId: record.id }), { code: "AI_PLAN_TRADE_CHANGED" });
  assert.equal(await db.supplier.count({ where: { shopId: fixture.shopId } }), 0);
  console.log("Shop assistant profiles passed: twelve trades, scoped context, English/Hindi examples and grounding, role/feature filtering, server-selected identity, model-free reads and trade-change rejection.");
} finally { await dropEvalShop(fixture); }
