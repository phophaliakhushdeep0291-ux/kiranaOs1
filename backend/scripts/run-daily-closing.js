import "dotenv/config";
import db from "../src/db.js";
import { env } from "../src/config/env.js";
import { addJob, closeQueues, isQueueEnabled } from "../src/lib/queue.js";
import { closeRedis } from "../src/lib/redis.js";
import { QUEUE_NAMES, JOB_NAMES } from "../src/workers/queueNames.js";
import { generateDailyClosingSnapshot } from "../src/modules/reports/dailyClosingSnapshot.service.js";
import { createAuditLog } from "../src/modules/audit/audit.service.js";

function arg(name) {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found ? found.split("=").slice(1).join("=") : null;
}

function dateInTimeZone(date, timeZone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function defaultYesterday(timeZone = "Asia/Kolkata") {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return dateInTimeZone(yesterday, timeZone);
}

async function main() {
  const shopId = arg("shopId");
  const date = arg("date") || defaultYesterday(env.DAILY_CLOSING_TIMEZONE);
  const shops = shopId
    ? await db.shop.findMany({ where: { id: shopId }, select: { id: true } })
    : await db.shop.findMany({ select: { id: true } });

  const results = [];
  for (const shop of shops) {
    if (isQueueEnabled()) {
      const queued = await addJob(QUEUE_NAMES.reportsQueue, JOB_NAMES.GENERATE_DAILY_CLOSING, {
        shopId: shop.id,
        date,
        requestedAt: new Date().toISOString(),
        source: "schedule",
      }, { jobId: `daily-closing:${shop.id}:${date}` });
      await createAuditLog({
        shopId: shop.id,
        action: "DAILY_CLOSING_SCHEDULED",
        entityType: "DailyClosingSnapshot",
        metadata: { date, queued: queued.queued, queueName: QUEUE_NAMES.reportsQueue },
      });
      results.push({ shopId: shop.id, date, mode: "queued", ...queued });
    } else {
      const snapshot = await generateDailyClosingSnapshot(shop.id, date, { source: "worker" });
      await createAuditLog({
        shopId: shop.id,
        action: "DAILY_CLOSING_SCHEDULED",
        entityType: "DailyClosingSnapshot",
        entityId: snapshot?.snapshot?.id ?? null,
        metadata: { date, queued: false, generatedDirectly: true, skipped: snapshot?.snapshot?.skipped ?? false },
      });
      results.push({ shopId: shop.id, date, mode: "direct", snapshotId: snapshot?.snapshot?.id ?? null, skipped: snapshot?.snapshot?.skipped ?? false });
    }
  }

  console.log(JSON.stringify({ success: true, date, count: results.length, results }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ success: false, code: error?.code || "DAILY_CLOSING_RUN_FAILED", error: error?.message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues().catch(() => null);
    await closeRedis().catch(() => null);
    await db.$disconnect().catch(() => null);
  });
