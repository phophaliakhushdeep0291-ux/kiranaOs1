// SCHEDULED assurance runs — the "continuous" in continuous financial control.
//
// A scheduled run sweeps a recent window for every active shop and evaluates
// whatever changed. It is the durable safety net behind the in-process
// post-commit hook: because evaluation is idempotent and findings de-duplicate
// per entity, re-covering a period that the hook already handled costs a little
// read work and creates nothing new.
//
// Isolation rules, same as everywhere else in this module: read-only toward
// canonical financial tables, and one shop's failure never stops the sweep.
import db from "../db.js";
import { scheduledActivity } from "../modules/assurance/scheduled-activity.js";
import { JOB_NAMES } from "./queueNames.js";
import { ENTITY_TYPES, RUN_TYPES } from "../modules/assurance/assurance.constants.js";
import { collectEntitiesForPeriod, createRun, executeRun } from "../modules/assurance/evaluation.service.js";
import { recomputeShopBaselines } from "../modules/assurance/baseline.service.js";

const DEFAULT_LOOKBACK_HOURS = 26; // a day plus overlap, so a late sync is never missed
const MAX_SHOPS_PER_JOB = 200;

export async function handleAssuranceJob(job) {
  switch (job.name) {
    case JOB_NAMES.RUN_TRANSACTION_ASSURANCE:
      return runTransactionTriggeredAssurance(job.data ?? {});
    case JOB_NAMES.RUN_SCHEDULED_ASSURANCE:
      return requireCompleteSweep(await runScheduledAssurance({ ...job.data, to: job.timestamp ?? Date.now() }));
    case JOB_NAMES.RECOMPUTE_ASSURANCE_BASELINES:
      return requireCompleteSweep(await recomputeBaselinesForShops({ ...job.data, to: job.timestamp ?? Date.now() }));
    case JOB_NAMES.WORKER_HEALTHCHECK:
      return { status: "ok", jobName: JOB_NAMES.WORKER_HEALTHCHECK, time: new Date().toISOString() };
    default: {
      const error = new Error(`Unknown assurance job: ${job.name}`);
      error.code = "UNKNOWN_ASSURANCE_JOB";
      throw error;
    }
  }
}

const SUPPORTED_ENTITY_TYPES = new Set(Object.values(ENTITY_TYPES));

function requiredText(value, code) {
  const normalized = String(value ?? "").trim();
  if (normalized) return normalized;
  const error = new Error(code === "ASSURANCE_JOB_SHOP_REQUIRED" ? "Assurance job shop scope is required" : "Assurance job entity identity is required");
  error.code = code;
  throw error;
}

/**
 * Durable post-commit evaluation. Canonical money has already committed; this
 * worker only writes assurance runs/findings and is safe to retry.
 */
export async function runTransactionTriggeredAssurance(payload = {}) {
  const shopId = requiredText(payload.shopId, "ASSURANCE_JOB_SHOP_REQUIRED");
  const entityId = requiredText(payload.entityId, "ASSURANCE_JOB_ENTITY_REQUIRED");
  const entityType = requiredText(payload.entityType, "ASSURANCE_JOB_ENTITY_REQUIRED").toUpperCase();
  if (!SUPPORTED_ENTITY_TYPES.has(entityType)) {
    const error = new Error(`Unsupported assurance entity type: ${entityType}`);
    error.code = "ASSURANCE_JOB_ENTITY_UNSUPPORTED";
    throw error;
  }
  const actorUserId = payload.actorUserId ? String(payload.actorUserId) : null;
  const run = await createRun(shopId, {
    runType: RUN_TYPES.TRANSACTION_TRIGGERED,
    scope: { entityCount: 1, trigger: "durable_post_commit_job" },
    triggeredByUserId: actorUserId,
  });
  const outcome = await executeRun(
    shopId,
    run,
    [{ entityType, entityId }],
    { actorUserId },
  );
  // BullMQ retries rejected jobs. Returning a FAILED outcome would acknowledge
  // the job and permanently lose the post-commit check.
  if (outcome.status !== "COMPLETED") {
    const error = new Error(`Audit run ${outcome.runId} did not complete`);
    error.code = "ASSURANCE_EVALUATION_INCOMPLETE";
    error.runId = outcome.runId;
    throw error;
  }
  return {
    jobName: JOB_NAMES.RUN_TRANSACTION_ASSURANCE,
    runId: outcome.runId,
    status: outcome.status,
    evaluated: outcome.evaluated,
    findingsCreated: outcome.findingsCreated,
    findingsUpdated: outcome.findingsUpdated,
    failureCount: outcome.failures.length,
  };
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

/**
 * Evaluate every shop that has been active in the window.
 *
 * @param {{ lookbackHours?: number, shopIds?: string[], shopLimit?: number }} payload
 */
export async function runScheduledAssurance(payload = {}) {
  const lookbackHours = boundedInteger(payload.lookbackHours, DEFAULT_LOOKBACK_HOURS, 1, 24 * 30);
  const shopLimit = boundedInteger(payload.shopLimit, MAX_SHOPS_PER_JOB, 1, 5000);
  const to = new Date(payload.to ?? Date.now());
  if (!Number.isFinite(to.getTime())) throw new Error("Invalid assurance window end");
  const from = new Date(to.getTime() - lookbackHours * 60 * 60 * 1000);

  const shops = activeShopPages({ from, to, pageSize: shopLimit, shopIds: payload.shopIds });
  let shopsConsidered = 0;

  const results = [];
  let findingsCreated = 0;
  let findingsUpdated = 0;
  let evaluated = 0;

  for await (const shop of shops) {
    shopsConsidered += 1;
    try {
      const { entities, truncated } = await collectEntitiesForPeriod(shop.id, { from, to, includeRecentChanges: true });
      if (!entities.length) {
        results.push({ shopId: shop.id, skipped: true, reason: "NO_ACTIVITY" });
        continue;
      }
      const run = await createRun(shop.id, {
        runType: RUN_TYPES.SCHEDULED,
        scope: { from: from.toISOString(), to: to.toISOString(), entityCount: entities.length, truncated, trigger: "scheduler" },
        periodFrom: from,
        periodTo: to,
      });
      const outcome = await executeRun(shop.id, run, entities);
      evaluated += outcome.evaluated;
      findingsCreated += outcome.findingsCreated;
      findingsUpdated += outcome.findingsUpdated;
      results.push({
        shopId: shop.id,
        runId: outcome.runId,
        status: outcome.status,
        evaluated: outcome.evaluated,
        findingsCreated: outcome.findingsCreated,
        failures: outcome.failures.length,
        ruleFailures: outcome.ruleFailures.length,
        truncated: outcome.truncated,
      });
    } catch (error) {
      // One shop's data problem must never stop the sweep for every other shop.
      results.push({ shopId: shop.id, status: "FAILED", error: error?.message ?? String(error) });
    }
  }

  return {
    jobName: JOB_NAMES.RUN_SCHEDULED_ASSURANCE,
    window: { from: from.toISOString(), to: to.toISOString(), lookbackHours },
    shopsConsidered,
    complete: results.every((row) => row.skipped || row.status === "COMPLETED"),
    shopsPartial: results.filter((row) => row.status === "PARTIAL").length,
    shopsEvaluated: results.filter((row) => row.runId).length,
    shopsFailed: results.filter((row) => row.status === "FAILED").length,
    evaluated,
    findingsCreated,
    findingsUpdated,
    results: results.slice(0, 100),
  };
}

/**
 * Shops with any financial activity in the window. Cheaper and far kinder to a
 * multi-tenant database than sweeping every shop that has ever existed.
 */
async function* activeShopPages({ from, to, pageSize, shopIds }) {
  // shopLimit is retained as an input name for compatibility; it now bounds
  // one query's size, never the number of customers receiving their audit.
  const activity = scheduledActivity({ gte: from, lte: to });
  const where = shopIds?.length
    ? { id: { in: [...new Set(shopIds)] } }
    : { OR: Object.entries(activity).map(([relation, filter]) => ({ [relation]: { some: filter } })) };
  let cursor;
  while (true) {
    const page = await db.shop.findMany({ where, select: { id: true }, take: pageSize,
      orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const shop of page) yield shop;
    if (page.length < pageSize) return;
    cursor = page.at(-1).id;
  }
}

function requireCompleteSweep(result) {
  if (result.complete) return result;
  const error = new Error("Scheduled assurance is incomplete; review failed or partial audit runs");
  error.code = "ASSURANCE_SWEEP_INCOMPLETE";
  // Finish other tenants first, then reject so queue retry and failed-job
  // monitoring remain effective. Tenant failure details stay in audit records.
  throw error;
}

/**
 * Refresh behavioural baselines. Outlier rules stay silent until a shop has
 * enough history, so this is what eventually switches them on.
 */
export async function recomputeBaselinesForShops(payload = {}) {
  const shopLimit = boundedInteger(payload.shopLimit, MAX_SHOPS_PER_JOB, 1, 5000);
  const windowDays = boundedInteger(payload.windowDays, 90, 7, 365);
  const to = new Date(payload.to ?? Date.now());
  if (!Number.isFinite(to.getTime())) throw new Error("Invalid assurance window end");
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const shops = activeShopPages({ from, to, pageSize: shopLimit, shopIds: payload.shopIds });
  let shopsConsidered = 0;

  let baselinesWritten = 0;
  const failures = [];
  for await (const shop of shops) {
    shopsConsidered += 1;
    try {
      baselinesWritten += await recomputeShopBaselines(shop.id, { windowDays });
    } catch (error) {
      failures.push({ shopId: shop.id, error: error?.message ?? String(error) });
    }
  }

  return {
    jobName: JOB_NAMES.RECOMPUTE_ASSURANCE_BASELINES,
    windowDays,
    shopsProcessed: shopsConsidered,
    complete: failures.length === 0,
    baselinesWritten,
    failures: failures.slice(0, 50),
    failureCount: failures.length,
  };
}
