import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createPairingRecord, consumePairingCode } from "../src/pairing.mjs";
import { saveBridgeConfig } from "../src/config.mjs";

test("pairing code expires and is single-use", () => {
  const created = createPairingRecord({ code: "ABC234", now: 1_000, ttlMs: 500 });
  const valid = structuredClone(created.pairing);
  consumePairingCode(valid, "abc234", 1_200);
  assert.equal(valid.consumedAt, 1_200);
  assert.throws(() => consumePairingCode(valid, "ABC234", 1_300), (error) => error.status === 409 && /already used/i.test(error.message));
  assert.throws(() => consumePairingCode(structuredClone(created.pairing), "ABC234", 1_500), (error) => error.status === 410 && /expired/i.test(error.message));
});

test("local HTTP exchange returns the long token once and persists consumption", async (context) => {
  const port = 19_000 + Math.floor(Math.random() * 500);
  const directory = await mkdtemp(path.join(os.tmpdir(), "kiranaos-pair-test-"));
  const configPath = path.join(directory, "config.json");
  const { pairing } = createPairingRecord({ code: "XYZ789" });
  const token = "device-token-1234567890-abcdefghijklmnopqrstuvwxyz";
  await saveBridgeConfig(configPath, {
    version: 1,
    token,
    allowedOrigins: ["https://pos.example.test"],
    printer: { transport: "", name: "", host: "", port: 9100 },
    pairing,
    updateManifestUrl: "",
  });
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, KIRANA_BRIDGE_PORT: String(port), KIRANA_BRIDGE_CONFIG: configPath, KIRANA_BRIDGE_JOB_JOURNAL: path.join(directory, "jobs.json") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => { child.kill(); await rm(directory, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Bridge did not start")), 5_000);
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("listening")) { clearTimeout(timer); resolve(); } });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Bridge exited early (${code})`)); });
  });
  const pair = () => fetch(`http://127.0.0.1:${port}/v1/pair`, {
    method: "POST",
    headers: { origin: "https://pos.example.test", "content-type": "application/json" },
    body: JSON.stringify({ code: "XYZ789" }),
  });
  const first = await pair();
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, token });
  const replay = await pair();
  assert.equal(replay.status, 409);
  assert.match((await replay.json()).message, /already used/i);
  const evilOrigin = await fetch(`http://127.0.0.1:${port}/v1/pair`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ code: "XYZ789" }) });
  assert.equal(evilOrigin.status, 403);
  const persisted = JSON.parse(await readFile(configPath, "utf8"));
  assert.ok(Number(persisted.pairing.consumedAt) > 0);
});
