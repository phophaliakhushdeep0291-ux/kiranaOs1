import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHUTDOWN_TIMEOUT_MS = 10_000;
const VALID_ROLES = new Set(["auto", "api", "worker", "all"]);

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function resolveProductionProcessRole(input = process.env) {
  const configured = String(input.PROCESS_ROLE ?? "auto").trim().toLowerCase() || "auto";
  if (!VALID_ROLES.has(configured)) {
    throw new Error(`PROCESS_ROLE must be one of ${[...VALID_ROLES].join(", ")}`);
  }

  const queuesEnabled = enabled(input.QUEUES_ENABLED);
  const role = configured === "auto" ? (queuesEnabled ? "all" : "api") : configured;
  if ((role === "worker" || role === "all") && !queuesEnabled) {
    throw new Error(`PROCESS_ROLE=${role} requires QUEUES_ENABLED=true`);
  }
  return role;
}

export function productionRuntimeChildren(input = process.env) {
  const role = resolveProductionProcessRole(input);
  const nodeArgs = ["--import", "./src/instrumentation.js"];
  return [
    ...(role === "api" || role === "all"
      ? [{ name: "api", args: [...nodeArgs, "src/server.js"] }]
      : []),
    ...(role === "worker" || role === "all"
      ? [{ name: "worker", args: [...nodeArgs, "src/workers/index.js"] }]
      : []),
  ];
}

/**
 * Run the API and, when queues are enabled, the BullMQ worker as separate OS
 * processes in one Railway service. This gives a one-restaurant deployment a
 * real worker without paying for a second service, while PROCESS_ROLE=api and
 * PROCESS_ROLE=worker still allow the two processes to be split later.
 *
 * If either child dies the whole container exits. Railway then restarts both,
 * instead of leaving an apparently healthy API accepting jobs nobody consumes.
 */
export function startProductionRuntime({ input = process.env, spawnChild = spawn, exitProcess = (code) => process.exit(code) } = {}) {
  const role = resolveProductionProcessRole(input);
  const specs = productionRuntimeChildren(input);
  const running = new Set();
  let stopping = false;
  let finalExitCode = 0;
  let forceTimer = null;

  const finishIfStopped = () => {
    if (!stopping || running.size > 0) return;
    if (forceTimer) clearTimeout(forceTimer);
    console.log(JSON.stringify({ type: "runtime_shutdown_complete", role, exitCode: finalExitCode, time: new Date().toISOString() }));
    exitProcess(finalExitCode);
  };

  const stopAll = (signal, exitCode, reason) => {
    if (stopping) return;
    stopping = true;
    finalExitCode = exitCode;
    console.log(JSON.stringify({ type: "runtime_shutdown_start", role, signal, reason, exitCode, time: new Date().toISOString() }));
    for (const child of running) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
    forceTimer = setTimeout(() => {
      for (const child of running) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
      exitProcess(finalExitCode || 1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref?.();
    finishIfStopped();
  };

  for (const spec of specs) {
    const child = spawnChild(process.execPath, spec.args, {
      cwd: process.cwd(),
      env: input,
      stdio: "inherit",
      shell: false,
    });
    running.add(child);
    child.once("error", (error) => {
      console.error(JSON.stringify({ type: "runtime_child_error", child: spec.name, errorMessage: error.message, time: new Date().toISOString() }));
      stopAll("CHILD_ERROR", 1, `${spec.name}_spawn_failed`);
    });
    child.once("exit", (code, signal) => {
      running.delete(child);
      if (!stopping) {
        console.error(JSON.stringify({ type: "runtime_child_exit", child: spec.name, code, signal, time: new Date().toISOString() }));
        stopAll("CHILD_EXIT", Number.isInteger(code) && code !== 0 ? code : 1, `${spec.name}_stopped`);
      }
      finishIfStopped();
    });
  }

  process.once("SIGINT", () => stopAll("SIGINT", 0, "platform_signal"));
  process.once("SIGTERM", () => stopAll("SIGTERM", 0, "platform_signal"));
  console.log(JSON.stringify({ type: "runtime_startup", role, children: specs.map((spec) => spec.name), time: new Date().toISOString() }));
  return { role, children: specs.map((spec) => spec.name) };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    startProductionRuntime();
  } catch (error) {
    console.error(JSON.stringify({ type: "runtime_startup_error", errorMessage: error.message, time: new Date().toISOString() }));
    process.exit(1);
  }
}
