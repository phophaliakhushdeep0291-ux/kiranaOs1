import "dotenv/config";

process.env.DATABASE_URL ||= "file:./prisma/test.db";
process.env.JWT_SECRET ||= "worker-health-jwt-secret-32-characters-minimum";
process.env.LICENSE_SIGNING_SECRET ||= "worker-health-license-secret-32-characters-minimum";
process.env.NODE_ENV ||= "test";

async function main() {
  const [{ getWorkerHeartbeats }, { closeRedis }, { closeQueues }] = await Promise.all([
    import("../src/lib/workerHeartbeat.js"),
    import("../src/lib/redis.js"),
    import("../src/lib/queue.js"),
  ]);

  try {
    const heartbeat = await getWorkerHeartbeats();
    if (!heartbeat.required) {
      console.log(JSON.stringify({ type: "worker_health_skipped", reason: "QUEUES_DISABLED", heartbeat, time: new Date().toISOString() }));
      return;
    }
    if (!heartbeat.healthy) {
      const error = new Error("No fresh worker heartbeat found. Start `npm run worker` and verify Redis connectivity.");
      error.code = "WORKER_HEARTBEAT_STALE_OR_MISSING";
      error.details = heartbeat;
      throw error;
    }
    console.log(JSON.stringify({ type: "worker_health_passed", heartbeat, time: new Date().toISOString() }));
  } finally {
    await closeQueues().catch(() => null);
    await closeRedis().catch(() => null);
  }
}

main().catch(async (error) => {
  try {
    const [{ closeRedis }, { closeQueues }] = await Promise.all([import("../src/lib/redis.js"), import("../src/lib/queue.js")]);
    await closeQueues().catch(() => null);
    await closeRedis().catch(() => null);
  } catch {}
  console.error(JSON.stringify({
    type: "worker_health_failed",
    errorCode: error?.code ?? error?.name ?? "WORKER_HEALTH_FAILED",
    errorMessage: error?.message,
    time: new Date().toISOString(),
  }));
  process.exit(1);
});
