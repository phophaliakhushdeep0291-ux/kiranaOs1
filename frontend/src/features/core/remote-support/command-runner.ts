import { ackDeviceCommand, pollDeviceCommands, type PendingDeviceCommand, type SupportCommandType } from "./api";
// Static on purpose. Every one of these is already in the entry closure — AuthContext
// reports device health, diagnosticsClient collects context, the shell registers the
// service worker — so importing them dynamically moved no bytes and only made Rollup
// warn that it could not honour the request. Dynamism has to be real to be worth
// writing; the two genuinely lazy imports are left below with their reasons.
import { reportDeviceHealth } from "@/features/core/devices/api";
import { collectDeviceHealth } from "@/lib/device-health/collectDeviceHealth";
import { collectDeviceContext } from "@/lib/diagnostics/collectDeviceContext";
import { clearInstantMemoryCache } from "@/lib/offline/instant-cache";
import { recoverFromStaleDeploy } from "@/lib/pwa/registerServiceWorker";

/**
 * Runs the commands a support operator queued for this device.
 *
 * Every executor below is the SAME function the app already calls when the owner
 * taps the equivalent button themselves. Remote support drives existing code
 * paths; it does not open new ones, and there is deliberately no generic
 * "evaluate this" escape hatch — a command the catalog does not name cannot run.
 *
 * Two executors import dynamically and mean it: cloud-hydration is genuinely lazy,
 * and sync-engine MUST stay dynamic because sync-engine imports this module — a
 * static import would close the cycle.
 */

export interface CommandOutcome {
  status: "applied" | "failed";
  result?: Record<string, unknown>;
  error?: string;
}

type CommandExecutor = (command: PendingDeviceCommand) => Promise<Record<string, unknown>>;

const EXECUTORS: Record<SupportCommandType, CommandExecutor> = {
  async COLLECT_DIAGNOSTICS() {
    const health = await collectDeviceHealth();
    await reportDeviceHealth(health);
    const context = collectDeviceContext();
    return { reported: true, appVersion: context.appVersion ?? null, online: health.online ?? null };
  },

  async RUN_SYNC_NOW() {
    const { runSyncCycle } = await import("@/features/core/sync/sync-engine");
    const result = await runSyncCycle();
    return { pushed: result.pushed, pulled: result.pulled, failed: result.failed, conflicts: result.conflicts };
  },

  async RETRY_FAILED_SYNC() {
    const { retryFailedSyncOperations } = await import("@/features/core/sync/sync-engine");
    const result = await retryFailedSyncOperations();
    return { ...result };
  },

  async PULL_FROM_CLOUD() {
    const { hydrateFromBackendSnapshot } = await import("@/features/core/sync/cloud-hydration");
    const result = await hydrateFromBackendSnapshot();
    return { ...result };
  },

  async CLEAR_LOCAL_CACHE() {
    clearInstantMemoryCache();
    // Saved data is untouched — this only drops the in-memory read cache, which is
    // what the owner is told in the command's plain-language summary.
    return { cleared: "memory-cache" };
  },

  async REFRESH_APP() {
    // recoverFromStaleDeploy() ends in window.location.reload(), so this promise
    // may never settle. The ack is already written before we get here (see
    // runDeviceCommand), otherwise the reload would erase the only record that the
    // command ran and the operator would re-issue it forever.
    void recoverFromStaleDeploy();
    return { reloading: true };
  },
};

function isKnownCommandType(type: string): type is SupportCommandType {
  return Object.prototype.hasOwnProperty.call(EXECUTORS, type);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Command failed";
}

export async function runDeviceCommand(command: PendingDeviceCommand): Promise<CommandOutcome> {
  if (!isKnownCommandType(command.type)) {
    // Third and last enforcement point, after queue-time and hand-off. A device
    // refuses anything it does not itself have code for.
    return { status: "failed", error: `Unsupported command: ${command.type}` };
  }

  // A command that reloads the page must report home first — after the reload
  // there is no runtime left to ack with.
  if (command.reloadsApp) {
    await ackDeviceCommand(command.id, { status: "applied", result: { reloading: true } }).catch(() => null);
    await EXECUTORS[command.type](command).catch(() => ({}));
    return { status: "applied", result: { reloading: true } };
  }

  try {
    const result = await EXECUTORS[command.type](command);
    return { status: "applied", result };
  } catch (error) {
    return { status: "failed", error: errorMessage(error) };
  }
}

// RUN_SYNC_NOW calls runSyncCycle(), and runSyncCycle() calls this — so without a
// guard a single queued sync command would recurse until the tab died.
let draining = false;

/**
 * One drain pass. Called from the sync cycle, so it inherits that loop's timing
 * and its online check, and adds no timer of its own.
 *
 * A re-entrant call returns empty immediately and does NOT join the running
 * drain: the inner call is reached *from inside* that drain, so awaiting it would
 * deadlock the pair. Skipping is correct anyway — whatever the inner call would
 * have fetched, the outer one is already fetching.
 *
 * Never throws: a support channel that can break the sync loop is worse than no
 * support channel at all.
 */
export async function drainDeviceCommands(): Promise<{ ran: number; failed: number }> {
  if (draining) return { ran: 0, failed: 0 };
  draining = true;
  try {
    return await drainOnce();
  } finally {
    draining = false;
  }
}

async function drainOnce(): Promise<{ ran: number; failed: number }> {
  let ran = 0;
  let failed = 0;

  try {
    const { commands } = await pollDeviceCommands();
    if (!Array.isArray(commands) || commands.length === 0) return { ran: 0, failed: 0 };

    // Sequential on purpose: "clear the cache" then "sync now" must not race, and
    // a reload-the-app command has to be the last thing this device does.
    for (const command of commands) {
      const outcome = await runDeviceCommand(command);
      if (outcome.status === "applied") ran += 1;
      else failed += 1;

      if (!command.reloadsApp) {
        await ackDeviceCommand(command.id, {
          status: outcome.status,
          result: outcome.result,
          error: outcome.error,
        }).catch(() => null);
      }
      if (command.reloadsApp) break;
    }
  } catch {
    // Offline, unauthenticated, or the endpoint is unavailable — all normal states
    // for a POS. The next cycle tries again.
    return { ran, failed };
  }

  return { ran, failed };
}
