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
 * - It DOES seed a day of sales beforehand, but ONLY into a throwaway shop it
 *   registered itself. Passing LOADTEST_MOBILE/LOADTEST_PASSWORD means a real
 *   account, and seeding is then disabled outright. LOADTEST_SEED_BILLS=0 skips
 *   seeding on a throwaway shop too.
 * - Why seed at all: a report over an empty shop touches none of the per-row work
 *   that makes it expensive. Benchmarking it against zero bills reports a
 *   throughput no real shop will ever see.
 */
import autocannon from "autocannon";

const SMOKE = process.argv.includes("--smoke");
// 127.0.0.1 (not localhost): Node's fetch may resolve localhost to ::1 while
// the server listens on IPv4 — a classic Windows/Node flake.
const BASE_URL = process.env.LOADTEST_BASE_URL || "http://127.0.0.1:3000";
const DURATION = Number(process.env.LOADTEST_DURATION || (SMOKE ? 5 : 10));
const CONNECTIONS = Number(process.env.LOADTEST_CONNECTIONS || (SMOKE ? 10 : 25));
const P95_BUDGET_MS = Number(process.env.LOADTEST_P95_MS || 800);
const ERROR_BUDGET = Number(process.env.LOADTEST_ERROR_RATE || 0.01);
const DEVICE_ID = process.env.LOADTEST_DEVICE_ID || "loadtest-device-1";
// A day's worth of sales for one counter. Seeded only into a throwaway shop.
const SEED_BILLS = Number(process.env.LOADTEST_SEED_BILLS ?? (SMOKE ? 60 : 400));

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

function run(name, opts) {
  return new Promise((resolve, reject) => {
    autocannon({ duration: DURATION, connections: CONNECTIONS, ...opts }, (err, result) => {
      if (err) return reject(err);
      resolve({ name, result });
    });
  });
}

function summarize({ name, result }) {
  const total = result.requests.total || 1;
  const errors = result.errors + result.timeouts + (result.non2xx || 0);
  return {
    scenario: name,
    "req/s": Math.round(result.requests.average),
    "p50 ms": result.latency.p50,
    "p95 ms": result.latency.p97_5 ?? result.latency.p95 ?? result.latency.p99,
    "p99 ms": result.latency.p99,
    "non-2xx": result.non2xx || 0,
    "err %": Math.round((errors / total) * 10000) / 100,
  };
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
  } else if (SEED_BILLS > 0) {
    process.stdout.write(`Seeding ${SEED_BILLS} bills into the throwaway shop... `);
    const { created, error } = await seedBills(authHeaders, SEED_BILLS);
    console.log(`${created} created.`);
    if (error) console.warn(`  warning: ${error}`);
    if (created === 0) {
      console.error("Seeding produced no bills. The report scenarios would measure an empty shop, which is meaningless — aborting.");
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
  if (throwaway && SEED_BILLS > 0 && !(closingBills > 0)) {
    console.error("Daily closing reports zero bills despite seeding — the scenario below would measure an empty report. Aborting.");
    process.exit(2);
  }

  const scenarios = [
    { name: "health (no auth)", opts: { url: `${BASE_URL}/api/health` } },
    { name: "products list", opts: { url: `${BASE_URL}/api/products`, headers: authHeaders } },
    { name: "customers list", opts: { url: `${BASE_URL}/api/customers`, headers: authHeaders } },
    { name: "bills list", opts: { url: `${BASE_URL}/api/bills`, headers: authHeaders } },
    // source=live on purpose: the default path serves a locked snapshot when one
    // exists, which would benchmark a cache read instead of the report.
    { name: `daily closing (${closingBills} bills)`, opts: { url: `${BASE_URL}/api/reports/daily-closing?source=live`, headers: authHeaders } },
  ];

  const rows = [];
  for (const scenario of scenarios) {
    const outcome = await run(scenario.name, scenario.opts);
    rows.push(summarize(outcome));
  }

  console.table(rows);

  const failures = rows.filter((row) => row["p95 ms"] > P95_BUDGET_MS || row["err %"] > ERROR_BUDGET * 100);
  if (failures.length > 0) {
    console.error(`FAIL: ${failures.map((f) => f.scenario).join(", ")} exceeded budgets (p95 ≤ ${P95_BUDGET_MS}ms, errors ≤ ${ERROR_BUDGET * 100}%).`);
    process.exit(1);
  }
  console.log(`PASS: all scenarios within budgets (p95 ≤ ${P95_BUDGET_MS}ms, errors ≤ ${ERROR_BUDGET * 100}%).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(2);
});
