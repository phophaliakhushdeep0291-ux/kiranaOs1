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
 * - Read-only by default: it never creates bills/products during the run.
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
    return token;
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
  return token;
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
  const token = await getToken();
  const authHeaders = { authorization: `Bearer ${token}`, "x-device-id": DEVICE_ID, "x-device-name": "Loadtest runner" };

  // Warm the device auto-activation once so it doesn't skew the first scenario.
  await json("/api/products", { headers: authHeaders });

  const scenarios = [
    { name: "health (no auth)", opts: { url: `${BASE_URL}/api/health` } },
    { name: "products list", opts: { url: `${BASE_URL}/api/products`, headers: authHeaders } },
    { name: "customers list", opts: { url: `${BASE_URL}/api/customers`, headers: authHeaders } },
    { name: "bills list", opts: { url: `${BASE_URL}/api/bills`, headers: authHeaders } },
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
