#!/usr/bin/env node
import { setTimeout as sleep } from "timers/promises";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const expectWorker = process.env.SMOKE_EXPECT_WORKER === "true";
const expectRedis = process.env.SMOKE_EXPECT_REDIS === "true";
const expectStorage = process.env.SMOKE_EXPECT_STORAGE === "true";
const metricsExpected = process.env.SMOKE_METRICS_EXPECTED !== "false";
const allowProductionSmoke = process.env.ALLOW_PRODUCTION_SMOKE === "true";
const metricsToken = process.env.SMOKE_METRICS_TOKEN || process.env.METRICS_TOKEN || "";

function looksLikeProductionUrl(url) {
  return /^https:\/\//i.test(url) && !/(localhost|127\.0\.0\.1|staging|dev|test|railway\.app|render\.com)/i.test(url);
}

function assertNoSecrets(json) {
  const text = JSON.stringify(json || {});
  const suspicious = /(password|ownerPin|jwt|refreshToken|razorpay_key_secret|redis:\/\/[^@]+@|storage_secret_access_key)/i;
  if (suspicious.test(text)) throw new Error("smoke response appears to expose a secret-like field");
}

async function getJson(path, { allowNonOk = false, metrics = false } = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { Accept: metrics && path === "/metrics" ? "text/plain" : "application/json" };
  if (metricsToken) headers.Authorization = `Bearer ${metricsToken}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (metrics && path === "/metrics" && res.ok && text.includes("#")) return { prometheusText: text, status: res.status };
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${path} did not return JSON: ${text.slice(0, 120)}`); }
  assertNoSecrets(json);
  if (!allowNonOk && !res.ok) {
    const error = new Error(`${path} failed with ${res.status}`);
    error.response = json;
    throw error;
  }
  return json;
}

async function check(name, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    console.log(JSON.stringify({ type: "smoke_check", status: "ok", name, durationMs: Date.now() - startedAt }));
    return result;
  } catch (error) {
    console.error(JSON.stringify({ type: "smoke_check", status: "failed", name, errorMessage: error.message, response: error.response ?? null }));
    throw error;
  }
}

async function main() {
  if (looksLikeProductionUrl(baseUrl) && !allowProductionSmoke) {
    throw new Error("Refusing production smoke test unless ALLOW_PRODUCTION_SMOKE=true");
  }

  await sleep(Number(process.env.SMOKE_STARTUP_DELAY_MS || 0));

  await check("api_health", async () => {
    const health = await getJson("/api/health");
    if (!health.status) throw new Error("missing health.status");
  });

  await check("readiness", async () => {
    const ready = await getJson("/health/ready");
    if (!ready.checks?.database) throw new Error("missing database readiness check");
    if (expectRedis && ready.checks.redis !== "ok") throw new Error(`redis not ok: ${ready.checks.redis}`);
    if (expectStorage && ready.checks.storage !== "ok") throw new Error(`storage not ok: ${ready.checks.storage}`);
    if (expectWorker && ready.workerRequired !== true) throw new Error("workerRequired flag was not true");
  });

  if (metricsExpected) {
    await check("metrics_shape", async () => {
      const metrics = await getJson("/api/health/metrics", { allowNonOk: true });
      if (metrics.code === "METRICS_UNAUTHORIZED") return;
      if (!metrics.success || !metrics.data || !Array.isArray(metrics.data.counters)) throw new Error("invalid metrics JSON shape");
      const prom = await getJson("/metrics", { allowNonOk: true, metrics: true });
      if (prom.code === "METRICS_UNAUTHORIZED") return;
      if (!prom.prometheusText?.includes("http_requests_total") && !prom.prometheusText?.includes("KiranaOS")) {
        throw new Error("invalid Prometheus metrics shape");
      }
    });
  }

  if (expectWorker) {
    await check("jobs_status_requires_auth", async () => {
      const res = await fetch(`${baseUrl}/api/jobs/status`);
      if (![401, 403].includes(res.status)) throw new Error(`expected auth rejection, got ${res.status}`);
    });
  }

  console.log(JSON.stringify({ type: "smoke_test", status: "passed", baseUrl, time: new Date().toISOString() }));
}

main().catch(() => process.exit(1));
