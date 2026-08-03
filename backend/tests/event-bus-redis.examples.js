import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Proves the §11 Redis event-bus transport against a real RESP2 socket driven by
// the real ioredis client — the command my code issues, its arguments, and its
// failure handling, rather than a stub of my own function. No Redis server and
// no extra dependency required: tests/helpers/ contains a minimal RESP2 server.
//
// Each scenario runs in its own process because config/env.js parses
// process.env once at import, so a single process cannot exercise two
// configurations.

const scenarios = [
  ["publish path", "event-bus-redis-publish.mjs"],
  ["fault path", "event-bus-redis-fault.mjs"],
];

for (const [label, script] of scenarios) {
  const result = spawnSync(process.execPath, [path.join("tests", "helpers", script)], {
    encoding: "utf8",
    cwd: process.cwd(),
    timeout: 60000,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(
    result.status,
    0,
    `event bus ${label} failed:\n${output}`,
  );
  assert.ok(!/\bFAIL\b/.test(output), `event bus ${label} reported a failing check:\n${output}`);
}

console.log("event-bus-redis.examples.js OK");
