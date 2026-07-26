// TRANSACTION_TRIGGERED evaluation — the "audit after commit" path.
//
// Design constraints this file exists to satisfy:
//   * the source financial transaction has already committed before we are called;
//   * an audit failure must never surface to the user or fail the business op;
//   * billing latency must not include audit work, so callers never await us;
//   * work is bounded — a burst of bills cannot spawn unbounded concurrency.
//
// Implementation: a small in-process FIFO queue drained by a single worker.
// This is deliberately modest: the durable retry path is the SCHEDULED run,
// which re-evaluates a period and is idempotent, so anything dropped here (a
// crash, a queue overflow) is picked up by the next scheduled run rather than
// lost. When QUEUES_ENABLED is on, the same entry point can be moved onto the
// jobs infrastructure without changing callers.
import { env } from "../../config/env.js";
import { RUN_TYPES } from "./assurance.constants.js";
import { createRun, executeRun } from "./evaluation.service.js";

const MAX_QUEUE_LENGTH = 500;
const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 250;

const queue = [];
let draining = false;
let timer = null;

const stats = {
  enqueued: 0,
  dropped: 0,
  evaluated: 0,
  runs: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
};

/**
 * Queue an entity for post-commit evaluation. Fire-and-forget by design:
 * returns immediately and never throws.
 *
 * @param {string} shopId
 * @param {string} entityType  one of ENTITY_TYPES
 * @param {string} entityId
 * @param {{ userId?: string|null }} [actor]
 */
export function scheduleAuditEvaluation(shopId, entityType, entityId, actor = {}) {
  try {
    if (!env.AUDIT_TRANSACTION_TRIGGERED_ENABLED) return false;
    if (!shopId || !entityType || !entityId) return false;

    if (queue.length >= MAX_QUEUE_LENGTH) {
      // Shed load rather than grow without bound; the scheduled run covers it.
      stats.dropped += 1;
      return false;
    }

    queue.push({ shopId, entityType: String(entityType).toUpperCase(), entityId, actorUserId: actor.userId ?? null });
    stats.enqueued += 1;
    scheduleDrain();
    return true;
  } catch {
    // A hook can never be the reason a request fails.
    return false;
  }
}

function scheduleDrain() {
  if (draining || timer) return;
  // Batch briefly so one bill's bill+customer+product entities share a run.
  timer = setTimeout(() => {
    timer = null;
    void drain();
  }, BATCH_DELAY_MS);
  // Never hold the process open for audit work.
  if (typeof timer?.unref === "function") timer.unref();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, BATCH_SIZE);
      const byShop = new Map();
      for (const item of batch) {
        const list = byShop.get(item.shopId) ?? [];
        list.push(item);
        byShop.set(item.shopId, list);
      }

      for (const [shopId, items] of byShop) {
        // De-duplicate within the batch so a retry storm collapses to one evaluation.
        const seen = new Set();
        const entities = items.filter((item) => {
          const key = `${item.entityType}:${item.entityId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        try {
          const run = await createRun(shopId, {
            runType: RUN_TYPES.TRANSACTION_TRIGGERED,
            scope: { entityCount: entities.length, trigger: "post_commit_hook" },
            triggeredByUserId: entities[0]?.actorUserId ?? null,
          });
          const outcome = await executeRun(
            shopId,
            run,
            entities.map((item) => ({ entityType: item.entityType, entityId: item.entityId })),
            { actorUserId: entities[0]?.actorUserId ?? null }
          );
          stats.runs += 1;
          stats.evaluated += outcome.evaluated;
          stats.failures += outcome.failures.length;
          stats.lastRunAt = new Date().toISOString();
        } catch (error) {
          stats.failures += 1;
          stats.lastError = error?.message ?? String(error);
          // Log for operators; the scheduled run remains the durable safety net.
          console.error("Assurance transaction-triggered run failed", error);
        }
      }
    }
  } finally {
    draining = false;
  }
}

/** Test/ops helper: wait until the queue is empty. */
export async function flushAuditQueue({ timeoutMs = 30000 } = {}) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const startedAt = Date.now();
  await drain();
  while ((queue.length || draining) && Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 25));
    // eslint-disable-next-line no-await-in-loop
    await drain();
  }
  return { pending: queue.length, draining };
}

export function auditQueueStats() {
  return { ...stats, pending: queue.length, draining, enabled: env.AUDIT_TRANSACTION_TRIGGERED_ENABLED };
}
