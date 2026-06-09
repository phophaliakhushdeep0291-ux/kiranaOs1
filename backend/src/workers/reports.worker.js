import { generateDailyClosingSnapshot } from "../modules/reports/dailyClosingSnapshot.service.js";
import { JOB_NAMES } from "./queueNames.js";

export async function handleReportsJob(job) {
  switch (job.name) {
    case JOB_NAMES.GENERATE_DAILY_CLOSING:
      return generateDailyClosing(job.data);
    default: {
      const error = new Error(`Unknown reports job: ${job.name}`);
      error.code = "UNKNOWN_REPORTS_JOB";
      throw error;
    }
  }
}

async function generateDailyClosing(payload = {}) {
  const { shopId, date } = payload;
  if (!shopId || !date) {
    const error = new Error("shopId and date are required for GENERATE_DAILY_CLOSING");
    error.code = "INVALID_DAILY_CLOSING_PAYLOAD";
    throw error;
  }

  // Phase 12: persist a DailyClosingSnapshot idempotently per shop/date.
  // This worker never performs POS financial writes; it only reads
  // authoritative DB rows and upserts the report snapshot. Locked snapshots are
  // returned unchanged and are not silently overwritten.
  const snapshot = await generateDailyClosingSnapshot(shopId, date, {
    storeId: payload.storeId ?? null,
    source: "worker",
    userId: payload.requestedByUserId ?? null,
  });

  return {
    status: snapshot?.snapshot?.skipped ? "skipped_locked_snapshot" : "daily_closing_snapshot_generated",
    snapshotId: snapshot?.snapshot?.id ?? null,
    locked: Boolean(snapshot?.snapshot?.lockedAt),
    shopId,
    date,
  };
}
