import autocannon from "autocannon";
import "./src/config/env.js";
import app from "./src/app.js";
import db from "./src/db.js";

const PORT = 31994;
const server = app.listen(PORT);
await new Promise((r) => server.on("listening", r));
const BASE = `http://127.0.0.1:${PORT}/api`, DEV = "perf-device-1";
const login = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Id": DEV }, body: JSON.stringify({ mobile: "9812345601", password: "Perf@12345" }) }).then((r) => r.json());
const headers = { authorization: `Bearer ${login.data.accessToken}`, "x-device-id": DEV };

const run = (url) => new Promise((res, rej) =>
  autocannon({ url, headers, duration: 6, connections: 20 }, (e, r) => (e ? rej(e) : res(r))));

console.log("\nSustained throughput, 20 concurrent connections, one Node process:\n");
console.log("endpoint                    req/s      p50      p99   non-2xx");
console.log("-".repeat(62));
for (const [label, path] of [
  ["daily closing",            "/reports/daily-closing?source=live"],
  ["monthly breakdown",        "/reports/monthly-breakdown?year=2026"],
  ["products (full catalogue)","/products"],
  ["bills list",               "/bills?limit=50"],
]) {
  const r = await run(BASE + path);
  console.log(
    label.padEnd(26) +
    String(Math.round(r.requests.average)).padStart(6) +
    `${r.latency.p50}ms`.padStart(9) +
    `${r.latency.p99}ms`.padStart(9) +
    String(r.non2xx || 0).padStart(10)
  );
}
server.close(); await db.$disconnect(); process.exit(0);
