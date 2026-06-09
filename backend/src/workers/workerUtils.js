import { logger } from "../lib/logger.js";
import { recordWorkerJob } from "../lib/metrics.js";
import { captureWorkerError } from "../lib/errorTracking.js";

const SECRET_KEY_PATTERN = /pin|password|token|secret|authorization|signature|phone|mobile|email|payload/i;

export function sanitizeJobPayload(payload = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (SECRET_KEY_PATTERN.test(key)) {
      safe[key] = "[REDACTED]";
      continue;
    }
    if (["shopId", "userId", "entityId", "exportJobId", "requestId", "date", "storeId", "requestedAt", "reportType"].includes(key)) {
      safe[key] = value;
    }
  }
  return safe;
}

export function sanitizeError(error) {
  return {
    errorCode: error?.code ?? error?.name ?? "JOB_ERROR",
    errorMessage: String(error?.message ?? "Job failed").replace(/(pin|password|token|secret|authorization|signature)=?[^\s&]+/gi, "$1=[REDACTED]"),
  };
}

export function logJobStart({ queueName, jobName, jobId, payload, attempt }) {
  logger.info({
    type: "job_start",
    queueName,
    jobName,
    jobId,
    shopId: payload?.shopId ?? null,
    attempt,
    payload: sanitizeJobPayload(payload),
  });
}

export function logJobSuccess({ queueName, jobName, jobId, durationMs }) {
  recordWorkerJob({ jobName, status: "completed" });
  logger.info({ type: "job_success", queueName, jobName, jobId, durationMs });
}

export function logJobFailure({ queueName, jobName, jobId, attempt, error }) {
  recordWorkerJob({ jobName, status: "failed" });
  captureWorkerError(error, { queueName, jobName, jobId, attempt });
  logger.error({ type: "job_failure", queueName, jobName, jobId, attempt, ...sanitizeError(error) });
}

export async function runLoggedJob(job, handler) {
  const queueName = job?.queueName ?? "unknown";
  const jobName = job?.name ?? "unknown";
  const jobId = job?.id ?? null;
  const startedAt = Date.now();
  const attempt = Number(job?.attemptsMade ?? 0) + 1;
  logJobStart({ queueName, jobName, jobId, payload: job?.data, attempt });
  try {
    const result = await handler(job);
    logJobSuccess({ queueName, jobName, jobId, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    logJobFailure({ queueName, jobName, jobId, attempt, error });
    throw error;
  }
}
