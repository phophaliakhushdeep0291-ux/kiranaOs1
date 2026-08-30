import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { productionRuntimeChildren, resolveProductionProcessRole, startProductionRuntime } from "../scripts/start-production-runtime.js";

assert.equal(resolveProductionProcessRole({ QUEUES_ENABLED: "false" }), "api");
assert.equal(resolveProductionProcessRole({ QUEUES_ENABLED: "true" }), "all");
assert.equal(resolveProductionProcessRole({ QUEUES_ENABLED: "true", PROCESS_ROLE: "api" }), "api");
assert.equal(resolveProductionProcessRole({ QUEUES_ENABLED: "true", PROCESS_ROLE: "worker" }), "worker");
assert.throws(() => resolveProductionProcessRole({ QUEUES_ENABLED: "false", PROCESS_ROLE: "worker" }), /requires QUEUES_ENABLED=true/);
assert.throws(() => resolveProductionProcessRole({ PROCESS_ROLE: "sidecar" }), /PROCESS_ROLE must be one of/);

const combined = productionRuntimeChildren({ QUEUES_ENABLED: "true" });
assert.deepEqual(combined.map((child) => child.name), ["api", "worker"]);
assert.ok(combined.every((child) => child.args.includes("./src/instrumentation.js")), "both processes preload monitoring");
assert.ok(combined.find((child) => child.name === "api").args.includes("src/server.js"));
assert.ok(combined.find((child) => child.name === "worker").args.includes("src/workers/index.js"));

const source = fs.readFileSync("scripts/start-production-runtime.js", "utf8");
for (const required of ["runtime_child_exit", "SIGTERM", "SIGKILL", "shell: false", "runtime_shutdown_complete"]) {
  assert.ok(source.includes(required), `production runtime must retain ${required}`);
}

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(packageJson.scripts["start:runtime"], "node scripts/start-production-runtime.js");
const dockerfile = fs.readFileSync("Dockerfile", "utf8");
assert.ok(dockerfile.includes("npm run start:runtime"), "the deployed container must use the supervised runtime");

// A worker dying must also stop the API. Otherwise /health stays green while
// exports, reminders and scheduled closings collect in queues forever.
const spawned = [];
const exits = [];
class FakeChild extends EventEmitter {
  exitCode = null;
  signalCode = null;
  killedWith = [];
  kill(signal) { this.killedWith.push(signal); }
}
const beforeSignals = {
  SIGINT: new Set(process.listeners("SIGINT")),
  SIGTERM: new Set(process.listeners("SIGTERM")),
};
startProductionRuntime({
  input: { ...process.env, QUEUES_ENABLED: "true", PROCESS_ROLE: "auto" },
  spawnChild(command, args, options) {
    const child = new FakeChild();
    spawned.push({ command, args, options, child });
    return child;
  },
  exitProcess(code) { exits.push(code); },
});
assert.deepEqual(spawned.map((entry) => entry.args.at(-1)), ["src/server.js", "src/workers/index.js"]);
spawned[1].child.emit("exit", 1, null);
assert.deepEqual(spawned[0].child.killedWith, ["SIGTERM"], "a dead worker must terminate the API sibling");
spawned[0].child.emit("exit", 0, "SIGTERM");
assert.deepEqual(exits, [1], "the container must exit non-zero so Railway restarts it");
for (const signal of ["SIGINT", "SIGTERM"]) {
  for (const listener of process.listeners(signal)) {
    if (!beforeSignals[signal].has(listener)) process.removeListener(signal, listener);
  }
}

console.log("production-runtime.examples.js OK");
