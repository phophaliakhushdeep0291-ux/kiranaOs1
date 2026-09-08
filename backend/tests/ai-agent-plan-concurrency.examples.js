import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/db.js";
import { executeApprovedPlan, rejectPlan } from "../src/modules/ai/agent/agent.service.js";
import { defineTool, TOOL_RISK } from "../src/modules/ai/agent/tool-contract.js";
import { registerTools } from "../src/modules/ai/agent/tool-registry.js";

const suffix = randomUUID();
const shopA = `ai-claim-a-${suffix}`;
const shopB = `ai-claim-b-${suffix}`;
let mutationCount = 0;
let foreignMutationCount = 0;
let gate = null;
let completedWrite = null;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function newGate() {
  gate = { started: deferred(), release: deferred() };
  return gate;
}

const confirmTool = defineTool({
  name: "atomic_write_probe",
  kind: "write",
  risk: TOOL_RISK.CONFIRM,
  always: true,
  description: "Test-only write used to prove an approved AI plan executes no more than once.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: { marker: { type: "string" } },
    required: ["marker"],
  },
  summarize: ({ marker }) => `Apply test marker ${marker}`,
  handler: async ({ marker }, ctx) => {
    mutationCount += 1;
    gate?.started.resolve();
    if (gate) await gate.release.promise;
    await db.shop.update({ where: { id: ctx.shopId }, data: { city: marker } });
    completedWrite?.resolve();
    return { marker, mutationCount, amountPaise: 9007199254740993n };
  },
});

const ownerPinTool = defineTool({
  name: "owner_pin_write_probe",
  kind: "write",
  risk: TOOL_RISK.OWNER_PIN,
  always: true,
  description: "Test-only write used to prove current owner PIN risk is checked before claiming a plan.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: { marker: { type: "string" } },
    required: ["marker"],
  },
  summarize: ({ marker }) => `Apply protected test marker ${marker}`,
  handler: async ({ marker }, ctx) => {
    mutationCount += 1;
    await db.shop.update({ where: { id: ctx.shopId }, data: { city: marker } });
    return { marker };
  },
});

const restaurantOnlyTool = defineTool({
  name: "restaurant_write_probe",
  kind: "write",
  risk: TOOL_RISK.CONFIRM,
  always: true,
  description: "Test-only restaurant write used to prove business-type access is checked again at execution.",
  parameters: { type: "object", additionalProperties: false, properties: {} },
  summarize: () => "Run a restaurant-only test action",
  handler: async () => {
    foreignMutationCount += 1;
    return { changed: true };
  },
});

const invalidClientOutput = defineTool({
  name: "client_bad_output_probe", kind: "write", target: "client", risk: TOOL_RISK.CONFIRM, always: true,
  description: "Test-only bill preparation whose unencodable output must never be reported as applied.",
  summarize: () => "Prepare test bill lines",
  handler: async () => { const output = {}; output.self = output; return output; },
});
registerTools("core", [confirmTool, ownerPinTool, invalidClientOutput]);
registerTools("restaurant", [restaurantOnlyTool]);

const ctxA = { shopId: shopA, userId: null, role: "owner", businessType: "kirana", deviceId: "test-device" };
const ctxB = { ...ctxA, shopId: shopB };

async function createPlan({ tool = confirmTool.name, risk = TOOL_RISK.CONFIRM, args = { marker: randomUUID() } } = {}) {
  const row = await db.aiActionLog.create({
    data: {
      shopId: shopA,
      userId: null,
      transcript: "test-only approved action",
      permissionLevel: risk,
      status: "parsed",
      parsedActionJson: JSON.stringify({
        kind: "agent_turn",
        plan: [{ ref: "1", tool, risk, args, summary: `Apply ${tool}` }],
      }),
    },
  });
  return row.id;
}

async function assertStatus(id, status) {
  const row = await db.aiActionLog.findUnique({ where: { id }, select: { status: true } });
  assert.equal(row?.status, status);
}

try {
  await db.shop.createMany({
    data: [
      { id: shopA, name: "Atomic AI A", ownerName: "Owner", city: "before", address: "test", settingsJson: JSON.stringify({ businessType: "kirana" }) },
      { id: shopB, name: "Atomic AI B", ownerName: "Owner", city: "before", address: "test", settingsJson: JSON.stringify({ businessType: "kirana" }) },
    ],
  });

  // Two confirms overlap while the first handler is paused. The second request
  // must lose the database compare-and-set before it reaches the handler.
  const doubleConfirmPlan = await createPlan({ args: { marker: "double-confirm-winner" } });
  const doubleGate = newGate();
  const firstConfirm = executeApprovedPlan(ctxA, { planId: doubleConfirmPlan });
  await doubleGate.started.promise;
  await assertStatus(doubleConfirmPlan, "executing");
  await assert.rejects(
    executeApprovedPlan(ctxA, { planId: doubleConfirmPlan }),
    (error) => error?.code === "AI_PLAN_ALREADY_RESOLVED" && error?.statusCode === 409,
  );
  doubleGate.release.resolve();
  const firstResult = await firstConfirm;
  assert.equal(firstResult.allSucceeded, true);
  assert.equal(firstResult.executionStatus, "executed");
  assert.equal(firstResult.results[0].output.amountPaise, "9007199254740993");
  assert.doesNotThrow(() => JSON.stringify(firstResult));
  assert.equal(mutationCount, 1, "parallel confirm requests must enter the write handler once");
  await assertStatus(doubleConfirmPlan, "executed");

  // Reject cannot race a write already claimed for execution.
  const confirmVsRejectPlan = await createPlan({ args: { marker: "confirm-beats-reject" } });
  const raceGate = newGate();
  const racingConfirm = executeApprovedPlan(ctxA, { planId: confirmVsRejectPlan });
  await raceGate.started.promise;
  await assert.rejects(
    rejectPlan(ctxA, { planId: confirmVsRejectPlan }),
    (error) => error?.code === "AI_PLAN_ALREADY_RESOLVED" && error?.statusCode === 409,
  );
  raceGate.release.resolve();
  await racingConfirm;
  assert.equal(mutationCount, 2);
  await assertStatus(confirmVsRejectPlan, "executed");

  // The current tool definition is authoritative if risk increased after the
  // plan was stored. Missing verification must leave the plan claimable.
  gate = null;
  const pinPlan = await createPlan({
    tool: ownerPinTool.name,
    risk: TOOL_RISK.CONFIRM,
    args: { marker: "pin-verified" },
  });
  await assert.rejects(
    executeApprovedPlan(ctxA, { planId: pinPlan, ownerPinVerified: false }),
    (error) => error?.code === "OWNER_PIN_REQUIRED",
  );
  await assertStatus(pinPlan, "parsed");
  assert.equal(mutationCount, 2, "a missing PIN must not claim or enter the handler");
  await executeApprovedPlan(ctxA, { planId: pinPlan, ownerPinVerified: true });
  assert.equal(mutationCount, 3);

  // Tenant identity comes only from authenticated context. Another shop sees a
  // 404 and cannot consume the rightful shop's plan.
  const tenantPlan = await createPlan({ args: { marker: "tenant-owner-only" } });
  await assert.rejects(
    executeApprovedPlan(ctxB, { planId: tenantPlan }),
    (error) => error?.code === "AI_PLAN_NOT_FOUND" && error?.statusCode === 404,
  );
  await assertStatus(tenantPlan, "parsed");
  const tenantGate = newGate();
  const rightfulConfirm = executeApprovedPlan(ctxA, { planId: tenantPlan });
  await tenantGate.started.promise;
  tenantGate.release.resolve();
  await rightfulConfirm;

  // A plan for a tool outside the shop's current business type is consumed as a
  // failed stale plan and never invokes that foreign vertical's handler.
  gate = null;
  const foreignPlan = await createPlan({ tool: restaurantOnlyTool.name, args: {} });
  const foreignResult = await executeApprovedPlan(ctxA, { planId: foreignPlan });
  assert.equal(foreignResult.allSucceeded, false);
  assert.equal(foreignResult.executionStatus, "failed");
  assert.equal(foreignMutationCount, 0);
  await assertStatus(foreignPlan, "failed");

  // Decline itself is a compare-and-set too: exactly one simultaneous request
  // records the decision and the loser receives a conflict.
  const rejectPlanId = await createPlan();
  const declines = await Promise.allSettled([
    rejectPlan(ctxA, { planId: rejectPlanId }),
    rejectPlan(ctxA, { planId: rejectPlanId }),
  ]);
  assert.equal(declines.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(declines.filter((item) => item.status === "rejected" && item.reason?.code === "AI_PLAN_ALREADY_RESOLVED").length, 1);
  await assertStatus(rejectPlanId, "rejected");

  // Force both requests to observe `parsed` before either tries to claim it.
  // The reads remain real SQL reads; only their delivery is synchronised.
  const staleReadPlan = await createPlan();
  const originalFindFirst = db.aiActionLog.findFirst.bind(db.aiActionLog);
  const bothRead = deferred();
  let readers = 0;
  db.aiActionLog.findFirst = async (query) => {
    const result = await originalFindFirst(query);
    if (query.where.id === staleReadPlan) {
      assert.equal(result.status, "parsed");
      readers += 1;
      if (readers === 2) bothRead.resolve();
      await bothRead.promise;
    }
    return result;
  };
  try {
    const before = mutationCount;
    const requests = await Promise.allSettled([
      executeApprovedPlan(ctxA, { planId: staleReadPlan }),
      executeApprovedPlan(ctxA, { planId: staleReadPlan }),
    ]);
    assert.equal(readers, 2);
    assert.equal(requests.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(requests.filter((result) => result.status === "rejected" && result.reason?.code === "AI_PLAN_ALREADY_RESOLVED").length, 1);
    assert.equal(mutationCount, before + 1);
  } finally {
    db.aiActionLog.findFirst = originalFindFirst;
  }

  // A timed-out handler can still commit. Leave the plan uncertain and skip
  // later steps, then prove the late commit never makes the plan replayable.
  const timeoutPlan = await createPlan({ args: { marker: "late-write" } });
  const timeoutRow = await db.aiActionLog.findUnique({ where: { id: timeoutPlan } });
  const timeoutParsed = JSON.parse(timeoutRow.parsedActionJson);
  timeoutParsed.plan.push({ ...timeoutParsed.plan[0], ref: "2", args: { marker: "must-not-run" } });
  await db.aiActionLog.update({ where: { id: timeoutPlan }, data: { parsedActionJson: JSON.stringify(timeoutParsed) } });
  const timeoutGate = newGate();
  completedWrite = deferred();
  const beforeTimeout = mutationCount;
  const timedOut = await executeApprovedPlan(ctxA, { planId: timeoutPlan });
  assert.equal(timedOut.executionStatus, "uncertain");
  assert.equal(timedOut.requiresReview, true);
  assert.equal(timedOut.results[0].outcomeUnknown, true);
  assert.equal(timedOut.results[1].skipped, true);
  assert.equal(mutationCount, beforeTimeout + 1);
  timeoutGate.release.resolve();
  await completedWrite.promise;
  assert.equal((await db.shop.findUnique({ where: { id: shopA } })).city, "late-write");
  await assertStatus(timeoutPlan, "uncertain");
  await assert.rejects(executeApprovedPlan(ctxA, { planId: timeoutPlan }), { code: "AI_PLAN_ALREADY_RESOLVED" });
  assert.equal(mutationCount, beforeTimeout + 1);
  completedWrite = null;

  const corruptPlan = await createPlan();
  await db.aiActionLog.update({ where: { id: corruptPlan }, data: { parsedActionJson: JSON.stringify({ kind: "agent_turn", plan: [null] }) } });
  await assert.rejects(executeApprovedPlan(ctxA, { planId: corruptPlan }), { code: "AI_PLAN_CORRUPT" });
  await assertStatus(corruptPlan, "parsed");

  const badClientPlan = await createPlan({ tool: invalidClientOutput.name, args: {} });
  const badClientResult = await executeApprovedPlan(ctxA, { planId: badClientPlan });
  assert.equal(badClientResult.allSucceeded, false);
  assert.deepEqual(badClientResult.clientActions, []);
  assert.match(badClientResult.results[0].error, /could not be delivered/);

  console.log("AI agent atomic plan execution examples passed");
} finally {
  gate?.release.resolve();
  await db.aiActionLog.deleteMany({ where: { shopId: { in: [shopA, shopB] } } }).catch(() => undefined);
  await db.shop.deleteMany({ where: { id: { in: [shopA, shopB] } } }).catch(() => undefined);
  await db.$disconnect();
}
