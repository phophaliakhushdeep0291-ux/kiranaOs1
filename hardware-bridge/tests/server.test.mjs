import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("bridge binds locally and enforces origin plus pairing token", async (context) => {
  const port = 18_000 + Math.floor(Math.random() * 1_000);
  const token = "test-pairing-token-123456789-abcdef";
  const directory = await mkdtemp(path.join(os.tmpdir(), "kiranaos-server-test-"));
  const capturePath = path.join(directory, "customer-display.json");
  const displayFixture = fileURLToPath(new URL("./fixtures/capture-display.mjs", import.meta.url));
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      KIRANA_BRIDGE_PORT: String(port),
      KIRANA_BRIDGE_TOKEN: token,
      KIRANA_BRIDGE_ALLOWED_ORIGINS: "https://pos.example.test",
      KIRANA_BRIDGE_CONFIG: path.join(directory, "missing-config.json"),
      KIRANA_BRIDGE_JOB_JOURNAL: path.join(directory, "jobs.json"),
      KIRANA_BRIDGE_DISPLAY_EXECUTABLE: process.execPath,
      KIRANA_BRIDGE_DISPLAY_ARGS_JSON: JSON.stringify([displayFixture, capturePath]),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => { child.kill(); await rm(directory, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Bridge did not start")), 5_000);
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("listening")) { clearTimeout(timer); resolve(); } });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Bridge exited early (${code})`)); });
  });

  const base = `http://127.0.0.1:${port}`;
  const unauthorized = await fetch(`${base}/v1/health`, { headers: { origin: "https://pos.example.test" } });
  assert.equal(unauthorized.status, 401);
  const wrongOrigin = await fetch(`${base}/v1/health`, { headers: { origin: "https://evil.example", authorization: `Bearer ${token}` } });
  assert.equal(wrongOrigin.status, 403);
  const health = await fetch(`${base}/v1/health`, { headers: { origin: "https://pos.example.test", authorization: `Bearer ${token}` } });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.equal(health.headers.get("access-control-allow-origin"), "https://pos.example.test");

  const headers = { origin: "https://pos.example.test", authorization: `Bearer ${token}`, "content-type": "application/json" };
  const invalidDisplay = await fetch(`${base}/v1/customer-display/show`, {
    method: "POST",
    headers,
    body: JSON.stringify({ revision: 1, state: "sale", itemCount: 1, totalPaise: 10.5 }),
  });
  assert.equal(invalidDisplay.status, 400);

  const display = await fetch(`${base}/v1/customer-display/show`, {
    method: "POST",
    headers,
    body: JSON.stringify({ revision: 20, state: "sale", itemCount: 2, totalPaise: 12_345 }),
  });
  assert.equal(display.status, 200);
  assert.deepEqual(JSON.parse(await readFile(capturePath, "utf8")), {
    revision: 20,
    state: "sale",
    itemCount: 2,
    totalPaise: 12_345,
    width: 20,
    lines: ["2 ITEMS", "TOTAL INR 123.45"],
  });

  const staleDisplay = await fetch(`${base}/v1/customer-display/show`, {
    method: "POST",
    headers,
    body: JSON.stringify({ revision: 19, state: "idle", itemCount: 0, totalPaise: 0 }),
  });
  assert.deepEqual(await staleDisplay.json(), { ok: true, stale: true, revision: 20 });
});
