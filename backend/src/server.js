import { env } from "./config/env.js";
import app from "./app.js";
import db from "./db.js";
import { initErrorTracking, captureException } from "./lib/errorTracking.js";
import { closeRedis } from "./lib/redis.js";
import { seedPlans } from "./modules/subscription/subscription.service.js";
import { recoverWebhookDeliveries } from "./modules/integrations/integrations.service.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
let httpServer = null;
let shutdownStarted = false;

async function main() {
  initErrorTracking();
  // Test database connection before accepting traffic
  await db.$connect();
  console.log(JSON.stringify({ type: "startup", message: "Database connected", time: new Date().toISOString() }));

  // Sync plan configs (device limits, features) to DB on every start so deployments
  // pick up plan changes without a separate migration step.
  try {
    await seedPlans();
    console.log(JSON.stringify({ type: "startup", message: "Plans seeded/updated", time: new Date().toISOString() }));
  } catch (err) {
    console.error(JSON.stringify({ type: "startup_warn", message: "Plan seed failed (non-fatal)", error: err.message, time: new Date().toISOString() }));
  }

  try {
    const recovery = await recoverWebhookDeliveries();
    console.log(JSON.stringify({ type: "startup", message: "Webhook delivery recovery scheduled", ...recovery, time: new Date().toISOString() }));
  } catch (err) {
    console.error(JSON.stringify({ type: "startup_warn", message: "Webhook delivery recovery failed (non-fatal)", error: err.message, time: new Date().toISOString() }));
  }

  httpServer = app.listen(env.PORT, () => {
    console.log(
      JSON.stringify({
        type: "startup",
        message: "KiranaOS backend started",
        environment: env.NODE_ENV,
        port: env.PORT,
        health: `/api/health`,
        readiness: `/health/ready`,
        time: new Date().toISOString(),
      })
    );
  });

  // Behind a load balancer / reverse proxy the app's keep-alive must outlive the
  // LB's idle timeout (commonly 60s), or the LB reuses a socket the app just
  // closed → intermittent 502s under load. headersTimeout must exceed
  // keepAliveTimeout; requestTimeout bounds slow/stuck clients.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.requestTimeout = 30_000;
}

main().catch((err) => {
  captureException(err, { type: "startup_error" });
  console.error(JSON.stringify({ type: "startup_error", message: err.message, time: new Date().toISOString() }));
  process.exit(1);
});

function closeHttpServer() {
  if (!httpServer) return Promise.resolve();
  return new Promise((resolve) => {
    httpServer.close((error) => {
      if (error) {
        console.error(JSON.stringify({ type: "shutdown_error", component: "http", message: error.message, time: new Date().toISOString() }));
      }
      resolve();
    });
    httpServer.closeIdleConnections?.();
  });
}

async function shutdown(signal, exitCode = 0) {
  if (shutdownStarted) return;
  shutdownStarted = true;

  const forceExit = setTimeout(() => {
    console.error(JSON.stringify({ type: "shutdown_forced", signal, timeoutMs: SHUTDOWN_TIMEOUT_MS, time: new Date().toISOString() }));
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref?.();

  console.log(JSON.stringify({ type: "shutdown_start", signal, time: new Date().toISOString() }));

  try {
    await closeHttpServer();
    await closeRedis();
    await db.$disconnect();
    console.log(JSON.stringify({ type: "shutdown", signal, time: new Date().toISOString() }));
    clearTimeout(forceExit);
    process.exit(exitCode);
  } catch (err) {
    captureException(err, { type: "shutdown_error", signal });
    console.error(JSON.stringify({ type: "shutdown_error", signal, message: err.message, time: new Date().toISOString() }));
    clearTimeout(forceExit);
    process.exit(1);
  }
}

process.on("uncaughtException", (err) => {
  captureException(err, { type: "uncaught_exception" });
  console.error(JSON.stringify({ type: "uncaught_exception", message: err.message, time: new Date().toISOString() }));
  shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  captureException(err, { type: "unhandled_rejection" });
  console.error(JSON.stringify({ type: "unhandled_rejection", message: err.message, time: new Date().toISOString() }));
  shutdown("unhandledRejection", 1);
});

// Graceful shutdown
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
