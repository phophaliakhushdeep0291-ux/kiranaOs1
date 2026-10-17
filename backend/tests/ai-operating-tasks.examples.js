import { discoverScriptedTools } from "./helpers/agent-tool-discovery.js";
import assert from "node:assert/strict";
import db from "../src/db.js";
import { seedEvalShop, dropEvalShop } from "./helpers/agent-eval-shop.js";
import { runAgentTurn, executeApprovedPlan } from "../src/modules/ai/agent/agent.service.js";
import { getTool, toolsFor } from "../src/modules/ai/agent/tool-registry.js";
import { validateArgs } from "../src/modules/ai/agent/argument-validation.js";
import { WORKFLOWS, ACTION_LABELS, workflowAvailable, workflowHandoffs, renderWorkflowHelp, renderTaskCapabilities } from "../src/modules/ai/agent/workflow-directory.js";
import { formatDateInTimeZone } from "../src/utils/dates.js";
import { env } from "../src/config/env.js";
import "../src/modules/ai/agent/register-core.js";

const expense = { title: "Electricity October", amount: 125.75, category: "utilities", paymentMode: "cash", status: "paid", date: "2026-10-12" };
const supplier = { name: "North Foods", mobile: "9876543210", address: "Market road" };
for (const [name, args] of [["create_expense", expense], ["create_supplier", supplier]]) {
  const tool = getTool(name);
  for (const field of tool.parameters.required) {
    const missing = { ...args }; delete missing[field];
    assert.ok(validateArgs(tool, missing).length, `${name} must ask for ${field}`);
  }
  for (const key of ["shopId", "userId", "locationId", "url"]) assert.ok(validateArgs(tool, { ...args, [key]: "attacker" }).length);
  assert.ok(validateArgs(tool, { ...args, [name === "create_supplier" ? "name" : "title"]: "  " }).length);
}
assert.ok(validateArgs(getTool("create_expense"), { ...expense, amount: -1 }).length);
assert.ok(validateArgs(getTool("create_expense"), { ...expense, paymentMode: "bitcoin" }).length);
assert.ok(validateArgs(getTool("create_supplier"), { ...supplier, mobile: "+971123456789" }).length, "unsupported phone must not be truncated");
await assert.rejects(getTool("create_expense").handler({ ...expense, amount: 1.001 }), { code: "INVALID_AMOUNT" });
await assert.rejects(getTool("create_expense").handler({ ...expense, date: "2026-02-30" }));
const delivered = await getTool("create_expense").handler(expense);
assert.equal(formatDateInTimeZone(delivered.expense.spentAt, env.DAILY_CLOSING_TIMEZONE), expense.date);
assert.equal(delivered.expense.amount, 125.75);
assert.equal(delivered.expense.recurringInterval, "none");

const owner = { role: "owner", businessType: "kirana", features: { has: () => true } };
const taskTool = getTool("get_available_tasks");
assert.deepEqual(new Set((await taskTool.handler({}, owner)).actions), new Set(Object.keys(ACTION_LABELS)), "every executable tool must have a reviewed capability label");
assert.deepEqual((await taskTool.handler({}, { ...owner, role: "viewer" })).actions, []);
assert.ok(!(await taskTool.handler({}, { ...owner, role: "staff" })).actions.includes("create_product"));
assert.ok(!(await taskTool.handler({}, { ...owner, businessType: "pharmacy" })).actions.includes("create_product"));
assert.ok(!toolsFor({ ...owner, features: { has: () => false } }).some(tool => tool.name === "create_product"));
assert.doesNotMatch(renderTaskCapabilities({ actions: ["send_owner_pin", "delete_everything"] }, "en"), /send_owner_pin|delete_everything/);
const workflow = getTool("get_workflow");
for (const invalid of ["https://evil.example", "/settings", "__proto__"]) assert.ok(validateArgs(workflow, { workflows: [invalid] }).length);
assert.ok(validateArgs(workflow, { workflows: Array(4).fill("expenses") }).length);
assert.equal(new Set(WORKFLOWS.map(row => row.id)).size, WORKFLOWS.length);
for (const row of WORKFLOWS) {
  assert.match(row.path, /^\/[a-z0-9/-]+$/);
  assert.ok(row.title.en && row.title.hi);
  if (row.feature) assert.equal(workflowAvailable(row, { ...owner, features: { has: () => false } }), false);
  if (row.businessType) assert.equal(workflowAvailable(row, { ...owner, businessType: "other" }), false);
  if (row.changesData) assert.equal(workflowAvailable(row, { ...owner, role: "viewer" }), false);
}
assert.deepEqual(await workflow.handler({ workflows: ["staff", "expenses", "products"] }, { ...owner, role: "viewer" }), { workflows: ["products"] });
assert.deepEqual(await workflow.handler({ workflows: ["orders_received"] }, { ...owner, businessType: "restaurant" }), { workflows: [] });
assert.deepEqual(workflowHandoffs([{ tool: "get_workflow", status: "error", result: { workflows: ["expenses"] } }], owner), []);
assert.deepEqual(workflowHandoffs([{ tool: "get_workflow", status: "ok", result: { workflows: ["https://evil.example", "expenses"], title: "INJECTED" } }], owner, "en"), [{ id: "expenses", title: WORKFLOWS.find(row => row.id === "expenses").title.en }]);
assert.match(renderWorkflowHelp({ workflows: ["expenses"] }, "en"), /has not completed/);
assert.doesNotMatch(renderWorkflowHelp({ workflows: ["https://evil.example"], title: "INJECTED" }, "en"), /evil|INJECTED/);

function provider(calls) {
  let count = 0;
  return { provider: "fixture", model: "operating-tasks", client: { chat: { completions: { create: async body => discoverScriptedTools(body, calls.map(([name]) => name)) ?? ({ choices: [{ message: count++ === 0
    ? { role: "assistant", tool_calls: calls.map(([name, args], i) => ({ id: String(i), type: "function", function: { name, arguments: JSON.stringify(args) } })) }
    : { role: "assistant", content: "INJECTED: completed every task" } }] }) } } } };
}
const fixture = await seedEvalShop();
try {
  const ctx = fixture.ctx;
  const capability = await runAgentTurn(ctx, { message: "What can you do?", language: "en" });
  assert.equal(capability.planId, null);
  assert.equal(capability.provider.calls, 0, "capability questions need no model call");
  assert.match(capability.reply, /Create a supplier/);
  const mixed = await runAgentTurn(ctx, { message: "record an expense", language: "en" }, { provider: provider([["create_expense", expense], ["request_clarification", { field: "expense_payment" }]]) });
  assert.equal(mixed.planId, null, "missing information suppresses every proposed write");
  assert.match(mixed.reply, /cash|bank/i);
  const turn = await runAgentTurn(ctx, { message: "create supplier North Foods and record the electricity expense", language: "en" }, { provider: provider([["create_supplier", supplier], ["create_expense", expense], ["create_expense", expense]]) });
  assert.equal(turn.plan.length, 2, "duplicate proposals collapse");
  assert.equal(turn.requiresOwnerPin, false);
  assert.match(turn.plan.find(row => row.tool === "create_expense").summary, /125.75.*utilities.*paid.*cash.*2026-10-12.*branch/);
  assert.equal(await db.supplier.count({ where: { shopId: ctx.shopId } }), 0);
  assert.equal(await db.expense.count({ where: { shopId: ctx.shopId } }), 0);
  await assert.rejects(executeApprovedPlan({ ...ctx, shopId: "other" }, { planId: turn.planId }), { code: "AI_PLAN_NOT_FOUND" });
  const executed = await executeApprovedPlan(ctx, { planId: turn.planId });
  assert.equal(executed.allSucceeded, true);
  assert.equal(executed.clientActions.length, 2);
  assert.deepEqual(executed.clientActions.find(action => action.action === "create_supplier").payload.supplier, supplier);
  assert.equal(await db.expense.count({ where: { shopId: ctx.shopId } }), 0, "delivery must use the device's existing offline pipeline");
  await assert.rejects(executeApprovedPlan(ctx, { planId: turn.planId }), { code: "AI_PLAN_ALREADY_RESOLVED" });
  await db.supplier.create({ data: { ...supplier, shopId: ctx.shopId } });
  await assert.rejects(getTool("create_supplier").handler({ name: "  NORTH   FOODS " }, ctx), { code: "SUPPLIER_DUPLICATE" });
  await assert.rejects(getTool("create_supplier").handler({ ...supplier, name: "Different" }, ctx), { code: "SUPPLIER_DUPLICATE" });
  assert.deepEqual(await getTool("find_supplier").handler({ search: "north" }, { ...ctx, shopId: "other" }), { matchCount: 0, suppliers: [], truncated: false });
  const lookup = await getTool("find_supplier").handler({ search: "north" }, ctx);
  assert.equal(lookup.matchCount, 1); assert.deepEqual(Object.keys(lookup.suppliers[0]).sort(), ["id", "mobile", "name"]);
  const handoff = await runAgentTurn(ctx, { message: "open expenses", language: "en" }, { provider: provider([["get_workflow", { workflows: ["expenses"] }]]) });
  assert.equal(handoff.planId, null);
  assert.deepEqual(handoff.handoffs, [{ id: "expenses", title: WORKFLOWS.find(row => row.id === "expenses").title.en }]);
  assert.match(handoff.reply, /has not completed/);
  assert.doesNotMatch(handoff.reply, /INJECTED/);
  console.log("Operating tasks passed: required details, money/date validation, role/trade/feature scope, confirmation, tenant isolation, single-use delivery and honest workflow handoffs.");
} finally {
  await db.supplier.deleteMany({ where: { shopId: fixture.shopId } });
  await dropEvalShop(fixture);
}
