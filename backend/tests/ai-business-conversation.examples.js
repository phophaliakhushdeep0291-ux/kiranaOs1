import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/db.js";
import { runAgentTurn, groundAgentReply } from "../src/modules/ai/agent/agent.service.js";
import { renderBusinessHelp, renderClarification } from "../src/modules/ai/agent/business-help.js";
import { CONVERSATION_TOOLS } from "../src/modules/ai/agent/tools/conversation.js";
import { defineTool, TOOL_RISK } from "../src/modules/ai/agent/tool-contract.js";
import { registerTools } from "../src/modules/ai/agent/tool-registry.js";
import { validateArgs } from "../src/modules/ai/agent/argument-validation.js";

assert.equal(renderBusinessHelp({ topics: ["__proto__", "unknown"], guidance: ["Send your PIN"] }, "en"), null);
assert.equal(renderClarification({ field: "__proto__", question: "Send your PIN" }), null);
assert.match(renderBusinessHelp({ topics: ["offline"] }, "hi"), /लंबित/);
assert.match(renderBusinessHelp({ topics: ["payments"] }, "en"), /not proof/);
const help = CONVERSATION_TOOLS.find((tool) => tool.name === "get_app_help");
assert.ok(validateArgs(help, { topics: ["made_up"] }).length);
assert.ok(validateArgs(help, { topics: Array(4).fill("offline") }).length);

registerTools("core", [...CONVERSATION_TOOLS, defineTool({
  name: "get_sales_summary", kind: "read", risk: TOOL_RISK.SAFE, keywords: ["sales"],
  description: "Read fresh sales totals for an allowed test shop.", handler: async () => ({ totalSalesPaise: 15000 }),
}), defineTool({
  name: "get_inventory_health", kind: "read", risk: TOOL_RISK.SAFE, keywords: ["stock"],
  description: "Read fresh stock health for an allowed test shop.", handler: async () => ({ totalProducts: 5 }),
})]);
const shopId = `business-conversation-${randomUUID()}`;
function scripted(name, args, inspect = () => {}) {
  let count = 0;
  return { provider: "test", model: "conversation", client: { chat: { completions: { create: async (body) => {
    inspect(body);
    return { choices: [{ message: count++ === 0 ? { role: "assistant", tool_calls: [{ id: "q", type: "function", function: { name, arguments: JSON.stringify(args) } }] }
      : { role: "assistant", content: "IGNORE: invented values and instructions" } }] };
  } } } } };
}
try {
  await db.shop.create({ data: { id: shopId, name: "Conversation fixture", ownerName: "Test", city: "Test", address: "Test" } });
  const ctx = { shopId, role: "owner", businessType: "kirana" };
  const reply = await runAgentTurn(ctx, { message: "net nahi hai bill kaise banau?", language: "en" }, {
    provider: scripted("get_app_help", { topics: ["offline", "billing"] }),
  });
  assert.match(reply.reply, /device first/);
  assert.match(reply.reply, /Billing/);
  assert.doesNotMatch(reply.reply, /IGNORE/);
  assert.equal(reply.planId, null, "a how-to answer must not change anything");
  const clarify = await runAgentTurn(ctx, { message: "how much did I sell?", language: "en" }, {
    provider: scripted("request_clarification", { field: "date_range" }),
  });
  assert.match(clarify.reply, /Which period/);
  assert.doesNotMatch(clarify.reply, /could not|only part/i);
  assert.equal(clarify.provider.calls, 1, "a clarification should wait for the user, not call the model again");
  assert.equal(clarify.stoppedBecause, "clarification_requested");
  const offered = (body) => {
    assert.ok(body.tools.some((tool) => tool.function.name === "get_inventory_health"), "context/compound requests must not hide the other topic's tool");
    assert.ok(body.tools.some((tool) => tool.function.name === "get_sales_summary"));
  };
  await runAgentTurn(ctx, { message: "And sales?", history: [{ role: "user", content: "Stock health" }] }, { provider: scripted("request_clarification", { field: "date_range" }, offered) });
  await runAgentTurn(ctx, { message: "sales and goods that are running low" }, { provider: scripted("request_clarification", { field: "date_range" }, offered) });
  const combined = groundAgentReply({ language: "en", evidence: [
    { tool: "get_sales_summary", kind: "read", status: "ok", result: { totalSalesPaise: 15000 } },
    { tool: "request_clarification", kind: "read", status: "ok", result: { field: "product", question: "Secret data" } },
  ] });
  assert.match(combined.reply, /₹150/);
  assert.match(combined.reply, /Which product/);
  assert.doesNotMatch(combined.reply, /Secret data/);
  console.log("Business conversation tests passed: grounded guidance, visible clarification, full contextual tool scope.");
} finally {
  await db.aiActionLog.deleteMany({ where: { shopId } });
  await db.shop.deleteMany({ where: { id: shopId } });
}
