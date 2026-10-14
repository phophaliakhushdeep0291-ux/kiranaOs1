/**
 * KiranaOS API load test (autocannon).
 *
 * Usage:
 *   npm run loadtest                  # 10s/25conn per scenario vs http://localhost:3000
 *   npm run loadtest:smoke            # 5s/10conn quick pass (CI-friendly thresholds)
 *   LOADTEST_BASE_URL=https://api.example.com LOADTEST_MOBILE=98... LOADTEST_PASSWORD=... npm run loadtest
 *
 * Notes:
 * - Raise the API limiter on the TARGET while testing, or you measure 429s:
 *     API_RATE_LIMIT_MAX=1000000 AUTH_RATE_LIMIT_MAX=100000
 * - Against a fresh local server it registers a throwaway shop; against a real
 *   environment pass LOADTEST_MOBILE/LOADTEST_PASSWORD for an existing login.
 * - Read-only DURING the run: nothing is written while autocannon is firing.
 * - It DOES seed products, customers and a day of sales, ONLY into a throwaway shop it
 *   registered itself. Passing LOADTEST_MOBILE/LOADTEST_PASSWORD means a real
 *   account, and seeding is then disabled outright. LOADTEST_SEED_PRODUCTS,
 *   LOADTEST_SEED_CUSTOMERS and LOADTEST_SEED_BILLS independently size the seed.
 * - Why seed at all: a report over an empty shop touches none of the per-row work
 *   that makes it expensive. Benchmarking it against zero bills reports a
 *   throughput no real shop will ever see.
 */
import autocannon from "autocannon";
import fs from "node:fs";
import path from "node:path";
import { wholeNumber, summarize, exceedsBudget } from "./metrics.js";

// Invalidate an older successful report before any network/setup can fail.
if (process.env.LOADTEST_REPORT_PATH) {
  fs.mkdirSync(path.dirname(path.resolve(process.env.LOADTEST_REPORT_PATH)), { recursive: true });
  fs.writeFileSync(process.env.LOADTEST_REPORT_PATH, JSON.stringify({ status: "incomplete", startedAt: new Date().toISOString() }) + "\n");
}

const SMOKE = process.argv.includes("--smoke");
// 127.0.0.1 (not localhost): Node's fetch may resolve localhost to ::1 while
// the server listens on IPv4 — a classic Windows/Node flake.
const BASE_URL = process.env.LOADTEST_BASE_URL || "http://127.0.0.1:3000";
const DURATION = wholeNumber(process.env.LOADTEST_DURATION || (SMOKE ? 5 : 10), "LOADTEST_DURATION", { min: 1, max: 300 });
const CONNECTIONS = wholeNumber(process.env.LOADTEST_CONNECTIONS || (SMOKE ? 10 : 25), "LOADTEST_CONNECTIONS", { min: 1, max: 100 });
const LATENCY_BUDGET_MS = Number(process.env.LOADTEST_P97_5_MS || process.env.LOADTEST_P95_MS || 800);
const ERROR_BUDGET = Number(process.env.LOADTEST_ERROR_RATE || 0.01);
const DEVICE_ID = process.env.LOADTEST_DEVICE_ID || "loadtest-device-1";
// A day's worth of sales for one counter. Seeded only into a throwaway shop.
const SEED_BILLS = wholeNumber(process.env.LOADTEST_SEED_BILLS ?? (SMOKE ? 60 : 400), "LOADTEST_SEED_BILLS");
const SEED_PRODUCTS = wholeNumber(process.env.LOADTEST_SEED_PRODUCTS ?? (SMOKE ? 100 : 1000), "LOADTEST_SEED_PRODUCTS");
const SEED_CUSTOMERS = wholeNumber(process.env.LOADTEST_SEED_CUSTOMERS ?? (SMOKE ? 20 : 200), "LOADTEST_SEED_CUSTOMERS");
if (!Number.isFinite(LATENCY_BUDGET_MS) || LATENCY_BUDGET_MS <= 0 || !Number.isFinite(ERROR_BUDGET) || ERROR_BUDGET < 0 || ERROR_BUDGET > 1) throw new Error("Invalid load-test budgets");
const SEED_PIN = "2468";


async function json(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function pickToken(body) {
  return body?.data?.accessToken || body?.accessToken || body?.data?.token || body?.token || null;
}

async function getToken() {
  const mobile = process.env.LOADTEST_MOBILE;
  const password = process.env.LOADTEST_PASSWORD;
  if (mobile && password) {
    const login = await json("/api/auth/login", { method: "POST", body: JSON.stringify({ mobile, password }) });
    const token = pickToken(login.body);
    if (!token) throw new Error(`Login failed (${login.status}): ${JSON.stringify(login.body).slice(0, 200)}`);
    // A real account. Never seed into it.
    return { token, throwaway: false };
  }
  // Throwaway shop for local/staging runs.
  const suffix = String(Date.now()).slice(-9);
  const freshMobile = `9${suffix}`;
  const register = await json("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      shopName: `Loadtest Shop ${suffix}`,
      ownerName: "Load Tester",
      city: "Jaipur",
      address: "Load test lane 42",
      mobile: freshMobile,
      password: "loadtest-pass-123",
      ownerPin: SEED_PIN,
    }),
  });
  let token = pickToken(register.body);
  if (!token) {
    const login = await json("/api/auth/login", { method: "POST", body: JSON.stringify({ mobile: freshMobile, password: "loadtest-pass-123" }) });
    token = pickToken(login.body);
  }
  if (!token) throw new Error(`Could not obtain a token (register status ${register.status}). Pass LOADTEST_MOBILE/LOADTEST_PASSWORD.`);
  return { token, throwaway: true };
}

/**
 * Seed one day of sales so the report scenarios have something to report on.
 *
 * Probes with a single bill first: if the payload shape is wrong this says so
 * loudly instead of leaving the run to quietly measure an empty table.
 */
async function seedBills(authHeaders, count) {
  const body = (i) => {
    const rate = 20 + (i % 180);
    const quantity = 1 + (i % 4);
    return JSON.stringify({
      billType: "normal_sale",
      gstMode: "none",
      customerName: `Load Customer ${i % 50}`,
      items: [{ name: `Load item ${i % 120}`, quantity, enteredUnit: "pc", ratePerRateUnit: rate }],
      payments: [{ mode: i % 3 === 0 ? "upi" : "cash", amount: rate * quantity }],
      idempotencyKey: `loadtest-seed-${process.pid}-${i}`,
    });
  };
  const post = (i) => json("/api/bills/confirm", { method: "POST", headers: authHeaders, body: body(i) });

  const probe = await post(0);
  if (probe.status < 200 || probe.status >= 300) {
    return { created: 0, error: `probe bill rejected (${probe.status}): ${JSON.stringify(probe.body).slice(0, 300)}` };
  }

  // Modest concurrency: the point is to fill the table, not to load-test the writes.
  const queue = Array.from({ length: count - 1 }, (_, i) => i + 1);
  let created = 1;
  let error = null;
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
      const res = await post(i);
      if (res.status >= 200 && res.status < 300) created += 1;
      else if (!error) error = `bill ${i} rejected (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`;
    }
  }));
  return { created, error };
}

async function seedCatalogue(authHeaders) {
  // Called only after this process registered a new synthetic shop. Use real
  // API writes so stock, search indexes and feed rows match ordinary products.
  for (const [kind, count] of [["products", SEED_PRODUCTS], ["customers", SEED_CUSTOMERS]]) {
    for (let i = 0; i < count; i++) {
      const body = kind === "products" ? {
        name: `Load product ${String(i).padStart(6, "0")}`, category: `Category ${i % 20}`,
        sku: `LOAD-${i}`, barcode: `900${String(i).padStart(10, "0")}`,
        defaultPricePerRateUnit: 20, costPerRateUnit: 10, stockBaseQty: 100,
      } : { name: `Load customer ${String(i).padStart(6, "0")}`, mobile: `8${String(i).padStart(9, "0")}` };
      const result = await json(`/api/${kind}`, { method: "POST", headers: { ...authHeaders, "x-owner-pin": SEED_PIN }, body: JSON.stringify(body) });
      if (result.status !== 201) throw new Error(`${kind} seed ${i} failed (${result.status}): ${JSON.stringify(result.body).slice(0, 200)}`);
    }
    const probe = await json(`/api/${kind}`, { headers: authHeaders });
    const rows = probe.body?.data;
    if (probe.status !== 200 || !Array.isArray(rows) || rows.length !== count) throw new Error(`${kind} catalogue probe did not contain all ${count} seeded rows`);
    console.log(`Verified ${count} ${kind} through the listing API.`);
  }
}

function run(name, opts) {
  return new Promise((resolve, reject) => {
    autocannon({ duration: DURATION, connections: CONNECTIONS, ...opts }, (err, result) => {
      if (err) return reject(err);
      resolve({ name, result });
    });
  });
}

async function main() {
  const health = await json("/api/health").catch(() => null);
  if (!health || health.status !== 200) {
    console.error(`Target ${BASE_URL} is not healthy (${health?.status ?? "unreachable"}). Start the backend first.`);
    process.exit(2);
  }

  console.log(`Target: ${BASE_URL} · ${DURATION}s × ${CONNECTIONS} connections per scenario`);
  const { token, throwaway } = await getToken();
  const authHeaders = { authorization: `Bearer ${token}`, "x-device-id": DEVICE_ID, "x-device-name": "Loadtest runner" };

  // Warm the device auto-activation once so it doesn't skew the first scenario.
  await json("/api/products", { headers: authHeaders });

  if (!throwaway) {
    console.log("Existing account supplied — seeding skipped. Report scenarios measure whatever data that shop already has.");
  } else {
    await seedCatalogue(authHeaders);
  }
  if (throwaway && SEED_BILLS > 0) {
    process.stdout.write(`Seeding ${SEED_BILLS} bills into the throwaway shop... `);
    const { created, error } = await seedBills(authHeaders, SEED_BILLS);
    console.log(`${created} created.`);
    if (error) console.warn(`  warning: ${error}`);
    if (created !== SEED_BILLS) {
      console.error("Bill seeding was incomplete; refusing to certify a smaller workload than requested.");
      process.exit(2);
    }
  }

  // Prove the report actually sees the seeded day before timing it. Measuring a
  // daily closing over zero bills is the specific mistake this guard exists to stop.
  const closingProbe = await json("/api/reports/daily-closing?source=live", { headers: authHeaders });
  const closingBills = closingProbe.body?.data?.totalBills;
  if (closingProbe.status !== 200) {
    console.error(`Daily closing probe failed (${closingProbe.status}): ${JSON.stringify(closingProbe.body).slice(0, 300)}`);
    process.exit(2);
  }
  console.log(`Daily closing sees ${closingBills} bills for today.`);
  if (throwaway && closingBills !== SEED_BILLS) {
    console.error("Daily closing does not see the exact seeded bill count — aborting.");
    process.exit(2);
  }

  const scenarios = [
    { name: "health (no auth)", opts: { url: `${BASE_URL}/api/health` } },
    { name: "products list", opts: { url: `${BASE_URL}/api/products`, headers: authHeaders } },
    { name: "product search", opts: { url: `${BASE_URL}/api/products?search=Load%20product%20000`, headers: authHeaders } },
    { name: "customers list", opts: { url: `${BASE_URL}/api/customers`, headers: authHeaders } },
    { name: "bills list", opts: { url: `${BASE_URL}/api/bills`, headers: authHeaders } },
    // source=live on purpose: the default path serves a locked snapshot when one
    // exists, which would benchmark a cache read instead of the report.
    { name: `daily closing (${closingBills} bills)`, opts: { url: `${BASE_URL}/api/reports/daily-closing?source=live`, headers: authHeaders } },
  ];

  const rows = [];
  for (const scenario of scenarios) {
    // Time nothing until one real request has come back 2xx.
    //
    // The run holds ONE access token for its whole life, and seeding a large shop
    // can outlast it — a 15-minute token and a 1500-bill seed is enough. Every
    // scenario after that point measures how fast the API can reject an expired
    // token, which reads as a triumph rather than a failure: 6424 req/s at a p50 of
    // 2ms, next to a number in the last column that says 100. The error budget does
    // catch it, but only after a table that looks like the best result yet has been
    // printed, and believed. This names the request that failed and stops.
    const probe = await fetch(scenario.opts.url, { headers: scenario.opts.headers ?? {} });
    if (!probe.ok) {
      const body = await probe.text().catch(() => "");
      console.error(
        `"${scenario.name}" answers ${probe.status} before the run starts, so timing it would measure rejections, not work — aborting.\n`
        + `  ${scenario.opts.url}\n  ${body.slice(0, 300)}`,
      );
      process.exit(2);
    }
    const outcome = await run(scenario.name, scenario.opts);
    rows.push(summarize(outcome));
  }

  console.table(rows.map(row => ({ scenario: row.scenario, "req/s": Math.round(row.requestsPerSecond), "p50 ms": row.p50Ms, "p97.5 ms": row.p97_5Ms, "p99 ms": row.p99Ms, "err %": Math.round(row.errorRate * 10000) / 100 })));
  const budgets = { latencyMs: LATENCY_BUDGET_MS, errorRate: ERROR_BUDGET };
  const failures = rows.filter((row) => exceedsBudget(row, budgets));
  if (process.env.LOADTEST_REPORT_PATH) {
    const filename = path.resolve(process.env.LOADTEST_REPORT_PATH);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, JSON.stringify({
      status: failures.length ? "failed" : "passed", generatedAt: new Date().toISOString(),
      revision: process.env.LOADTEST_REVISION ?? null, databaseEngine: process.env.LOADTEST_DATABASE_ENGINE ?? "unspecified",
      workingTreeDirty: process.env.LOADTEST_WORKTREE_DIRTY === undefined ? null : process.env.LOADTEST_WORKTREE_DIRTY === "true",
      durationSeconds: DURATION, connections: CONNECTIONS, latencyPercentile: 97.5, budgets,
      seeded: throwaway ? { products: SEED_PRODUCTS, customers: SEED_CUSTOMERS, bills: SEED_BILLS } : null,
      closingBills, rows, limitations: ["Local read workload; not a production capacity or concurrent-write guarantee.", "Physical hardware and external providers are not exercised."],
    }, null, 2) + "\n");
  }
  if (failures.length > 0) {
    console.error(`FAIL: ${failures.map((f) => f.scenario).join(", ")} exceeded budgets (p97.5 ≤ ${LATENCY_BUDGET_MS}ms, errors ≤ ${ERROR_BUDGET * 100}%).`);
    process.exit(1);
  }
  console.log(`PASS: all scenarios within budgets (p97.5 ≤ ${LATENCY_BUDGET_MS}ms, errors ≤ ${ERROR_BUDGET * 100}%).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(2);
});
