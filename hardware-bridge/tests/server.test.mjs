import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

test("bridge binds locally and enforces origin plus pairing token", async (context) => {
  const port = 18_000 + Math.floor(Math.random() * 1_000);
  const token = "test-pairing-token-123456789-abcdef";
  const directory = await mkdtemp(path.join(os.tmpdir(), "kiranaos-server-test-"));
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, KIRANA_BRIDGE_PORT: String(port), KIRANA_BRIDGE_TOKEN: token, KIRANA_BRIDGE_ALLOWED_ORIGINS: "https://pos.example.test", KIRANA_BRIDGE_JOB_JOURNAL: path.join(directory, "jobs.json") },
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
});
