import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

// The device is the last line of defence in remote support: whatever the server
// sends, the app must only ever run code it already contains, must report what it
// did, and must never let the support channel damage the sync loop it rides on.

const poll = vi.fn();
const ack = vi.fn(async () => ({}));
const runSyncCycle = vi.fn(async () => ({ pushed: 1, pulled: 2, failed: 0, conflicts: 0 }));
const recoverFromStaleDeploy = vi.fn(async () => undefined);
const clearInstantMemoryCache = vi.fn();

vi.mock("@/features/remote-support/api", () => ({
  pollDeviceCommands: (...args: unknown[]) => poll(...args),
  ackDeviceCommand: (...args: unknown[]) => ack(...args),
}));

vi.mock("@/features/sync/sync-engine", () => ({
  runSyncCycle: (...args: unknown[]) => runSyncCycle(...args),
  retryFailedSyncOperations: vi.fn(async () => ({ retried: 3 })),
}));

vi.mock("@/lib/pwa/registerServiceWorker", () => ({
  recoverFromStaleDeploy: (...args: unknown[]) => recoverFromStaleDeploy(...args),
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  clearInstantMemoryCache: (...args: unknown[]) => clearInstantMemoryCache(...args),
}));

const { drainDeviceCommands, runDeviceCommand } = await import("@/features/remote-support/command-runner");

function command(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmd-1",
    type: "RUN_SYNC_NOW",
    params: {},
    label: "Sync now",
    ownerSummary: "Support started a sync on this device.",
    reloadsApp: false,
    issuedByEmail: "operator@example.com",
    reason: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as never;
}

describe("remote support command runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poll.mockResolvedValue({ commands: [] });
  });

  it("runs a known command and reports the result back", async () => {
    poll.mockResolvedValue({ commands: [command()] });

    const outcome = await drainDeviceCommands();

    expect(runSyncCycle).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ran: 1, failed: 0 });
    expect(ack).toHaveBeenCalledWith("cmd-1", {
      status: "applied",
      result: { pushed: 1, pulled: 2, failed: 0, conflicts: 0 },
      error: undefined,
    });
  });

  it("refuses a command it has no code for, however the server labelled it", async () => {
    const outcome = await runDeviceCommand(command({ type: "WIPE_EVERYTHING", label: "Sync now" }));

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("Unsupported command");
    expect(runSyncCycle).not.toHaveBeenCalled();
    expect(clearInstantMemoryCache).not.toHaveBeenCalled();
  });

  it("acks a reloading command BEFORE reloading, or the record dies with the page", async () => {
    const order: string[] = [];
    ack.mockImplementation(async () => {
      order.push("ack");
      return {};
    });
    recoverFromStaleDeploy.mockImplementation(async () => {
      order.push("reload");
    });

    await runDeviceCommand(command({ id: "cmd-reload", type: "REFRESH_APP", reloadsApp: true }));

    expect(order).toEqual(["ack", "reload"]);
  });

  it("stops after a reloading command so nothing is queued behind a dead page", async () => {
    poll.mockResolvedValue({
      commands: [command({ id: "cmd-reload", type: "REFRESH_APP", reloadsApp: true }), command({ id: "cmd-after" })],
    });

    await drainDeviceCommands();

    expect(runSyncCycle).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalledWith("cmd-after", expect.anything());
  });

  it("reports a failing command instead of throwing into the sync cycle", async () => {
    poll.mockResolvedValue({ commands: [command()] });
    runSyncCycle.mockRejectedValueOnce(new Error("network down"));

    const outcome = await drainDeviceCommands();

    expect(outcome).toEqual({ ran: 0, failed: 1 });
    expect(ack).toHaveBeenCalledWith("cmd-1", { status: "failed", result: undefined, error: "network down" });
  });

  it("never throws when the device is offline — the next cycle just tries again", async () => {
    poll.mockRejectedValue(new Error("offline"));

    await expect(drainDeviceCommands()).resolves.toEqual({ ran: 0, failed: 0 });
  });

  it("does not re-enter: RUN_SYNC_NOW calls runSyncCycle, which drains again", async () => {
    poll.mockResolvedValue({ commands: [command()] });
    // Simulate the real cycle: running a sync triggers another drain attempt.
    runSyncCycle.mockImplementation(async () => {
      await drainDeviceCommands();
      return { pushed: 0, pulled: 0, failed: 0, conflicts: 0 };
    });

    await drainDeviceCommands();

    // One poll, one execution — the nested call joined the in-flight drain rather
    // than starting a second one and recursing until the tab died.
    expect(poll).toHaveBeenCalledTimes(1);
    expect(runSyncCycle).toHaveBeenCalledTimes(1);
  });
});

describe("remote support wiring", () => {
  it("drains above the subscription gate, so a blocked shop is still repairable", () => {
    const engine = fs.readFileSync("src/features/sync/sync-engine.ts", "utf8");
    const drainAt = engine.indexOf("void drainDeviceCommands()");
    // The call site inside runSyncCycle, not the helper's definition further up.
    const gateAt = engine.indexOf("await canSubscriptionSync()");

    expect(drainAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(drainAt).toBeLessThan(gateAt);
  });

  it("offers remote help to the owner only", () => {
    const page = fs.readFileSync("src/features/support/pages/AskArthaPage.tsx", "utf8");
    expect(page).toContain("RemoteHelpCard");
    expect(page).toContain('user?.role === "owner"');
  });
});

describe("auto-fix visibility", () => {
  const card = fs.readFileSync("src/features/remote-support/RemoteHelpCard.tsx", "utf8");

  it("gives the owner a standing switch, since nobody is watching when these run", () => {
    expect(card).toContain("setAutoFixEnabled");
    expect(card).toContain("Fix small problems automatically");
    // Unchecked would silently opt every shop out of a feature the server enables.
    expect(card).toContain("state?.autoFix?.enabled ?? true");
  });

  it("labels an unattended fix so nothing happens to the till invisibly", () => {
    expect(card).toContain("command.automatic");
    expect(card).toContain("Fixed automatically");
  });

  it("shows the operator the evidence behind each suggestion, not just a verdict", () => {
    const console_ = fs.readFileSync("src/features/remote-support/pages/RemoteSupportConsolePage.tsx", "utf8");
    expect(console_).toContain("suggestion.evidence");
    expect(console_).toContain("Suggested fixes");
    // Suggestions are per-device, so they must follow the selected device.
    expect(console_).toContain("refresh(sessionId, targetDevice)");
  });
});
