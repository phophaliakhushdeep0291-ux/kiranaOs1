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
import { JOB_NAMES } from "./queueNames.js";
import { RUN_TYPES } from "../modules/assurance/assurance.constants.js";
import { collectEntitiesForPeriod, createRun, executeRun } from "../modules/assurance/evaluation.service.js";
import { recomputeShopBaselines } from "../modules/assurance/baseline.service.js";

const DEFAULT_LOOKBACK_HOURS = 26; // a day plus overlap, so a late sync is never missed
const MAX_SHOPS_PER_JOB = 200;

export async function handleAssuranceJob(job) {
  switch (job.name) {
    case JOB_NAMES.RUN_SCHEDULED_ASSURANCE:
      return runScheduledAssurance(job.data ?? {});
    case JOB_NAMES.RECOMPUTE_ASSURANCE_BASELINES:
      return recomputeBaselinesForShops(job.data ?? {});
    case JOB_NAMES.WORKER_HEALTHCHECK:
      return { status: "ok", jobName: JOB_NAMES.WORKER_HEALTHCHECK, time: new Date().toISOString() };
    default: {
      const error = new Error(`Unknown assurance job: ${job.name}`);
      error.code = "UNKNOWN_ASSURANCE_JOB";
      throw error;
    }
  }
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
  const to = new Date();
  const from = new Date(to.getTime() - lookbackHours * 60 * 60 * 1000);

  const shops = payload.shopIds?.length
    ? await db.shop.findMany({ where: { id: { in: payload.shopIds } }, select: { id: true }, take: shopLimit })
    : await activeShopsSince(from, shopLimit);

  const results = [];
  let findingsCreated = 0;
  let findingsUpdated = 0;
  let evaluated = 0;

  for (const shop of shops) {
    try {
      const { entities, truncated } = await collectEntitiesForPeriod(shop.id, { from, to });
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
      });
    } catch (error) {
      // One shop's data problem must never stop the sweep for every other shop.
      results.push({ shopId: shop.id, status: "FAILED", error: error?.message ?? String(error) });
    }
  }

  return {
    jobName: JOB_NAMES.RUN_SCHEDULED_ASSURANCE,
    window: { from: from.toISOString(), to: to.toISOString(), lookbackHours },
    shopsConsidered: shops.length,
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
async function activeShopsSince(from, take) {
  const range = { gte: from };
  const [bills, expenses, stock, ledger] = await Promise.all([
    db.bill.findMany({ where: { createdAt: range }, select: { shopId: true }, distinct: ["shopId"], take }),
    db.expense.findMany({ where: { createdAt: range }, select: { shopId: true }, distinct: ["shopId"], take }),
    db.stockLedger.findMany({ where: { createdAt: range }, select: { shopId: true }, distinct: ["shopId"], take }),
    db.udharLedger.findMany({ where: { createdAt: range }, select: { shopId: true }, distinct: ["shopId"], take }),
  ]);
  const ids = [...new Set([...bills, ...expenses, ...stock, ...ledger].map((row) => row.shopId).filter(Boolean))];
  return ids.slice(0, take).map((id) => ({ id }));
}

/**
 * Refresh behavioural baselines. Outlier rules stay silent until a shop has
 * enough history, so this is what eventually switches them on.
 */
export async function recomputeBaselinesForShops(payload = {}) {
  const shopLimit = boundedInteger(payload.shopLimit, MAX_SHOPS_PER_JOB, 1, 5000);
  const windowDays = boundedInteger(payload.windowDays, 90, 7, 365);
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const shops = payload.shopIds?.length
    ? await db.shop.findMany({ where: { id: { in: payload.shopIds } }, select: { id: true }, take: shopLimit })
    : await activeShopsSince(from, shopLimit);

  let baselinesWritten = 0;
  const failures = [];
  for (const shop of shops) {
    try {
      baselinesWritten += await recomputeShopBaselines(shop.id, { windowDays });
    } catch (error) {
      failures.push({ shopId: shop.id, error: error?.message ?? String(error) });
    }
  }

  return {
    jobName: JOB_NAMES.RECOMPUTE_ASSURANCE_BASELINES,
    windowDays,
    shopsProcessed: shops.length,
    baselinesWritten,
    failures: failures.slice(0, 50),
    failureCount: failures.length,
  };
}
