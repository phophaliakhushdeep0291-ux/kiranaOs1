import assert from "node:assert/strict";
import db from "../src/db.js";
import { evaluatePlaybooks, resetAutoFixThrottle, runAutoFix, updateAutoFixSettings } from "../src/modules/remote-support/playbooks.service.js";
import { PLAYBOOKS, PLAYBOOK_TIERS } from "../src/modules/remote-support/playbooks.catalog.js";
import { COMMAND_STATUS } from "../src/modules/remote-support/commands.catalog.js";

// Auto-dispatch is the only part of remote support that acts with nobody watching,
// so the interesting assertions are all about restraint: it must not fire twice,
// must not fire forever, must not fire on a shop that said no, and must never fire
// a fix whose failure mode is worse than the symptom.

const suffix = `playbooks-${Date.now()}`;
const DEVICE_ID = `till-${suffix}`;
let shop;

function signals(overrides = {}) {
  return {
    shopId: shop?.id ?? "shop",
    deviceId: DEVICE_ID,
    sync: null,
    device: null,
    // A recent, healthy snapshot — otherwise "we know nothing about this device"
    // is itself a match, which is correct behaviour but not the baseline here.
    health: { dbStatus: "ok", healthScore: 95, createdAt: new Date() },
    errors: [],
    fleet: { latestAppVersion: null },
    ...overrides,
  };
}

async function main() {
  shop = await db.shop.create({ data: { name: `Shop ${suffix}`, ownerName: "O", city: "X", address: "Y" } });
  await db.device.create({
    data: { shopId: shop.id, deviceId: DEVICE_ID, deviceName: "Counter", status: "active", appVersion: "1.3.0" },
  });

  // ── Matching ────────────────────────────────────────────────────────────

  // 1) Clean signals match nothing. An auto-fixer that always finds something to
  //    do is just a random command generator.
  assert.deepEqual(evaluatePlaybooks(signals()), [], "a healthy device triggers no playbook");

  // 1b) But a device we know NOTHING about is asked to report in — a support system
  //     that only gathers data during an incident is blind exactly when it matters.
  const unknownDevice = evaluatePlaybooks(signals({ health: null }));
  assert.equal(unknownDevice.length, 1, "an unknown device produces exactly one action");
  assert.equal(unknownDevice[0].playbookId, "refresh-stale-diagnostics");
  assert.equal(unknownDevice[0].command, "COLLECT_DIAGNOSTICS", "and it is the read-only one");

  // 2) Retryable sync failures are the canonical auto case.
  const stuckSync = evaluatePlaybooks(
    signals({
      sync: {
        counts: { failed: 4, pending: 0 },
        recentFailures: [
          { retryable: true, explanation: "Updating inventory failed because the network dropped." },
          { retryable: true, explanation: "…" },
          { retryable: true, explanation: "…" },
        ],
      },
    }),
  );
  const retry = stuckSync.find((match) => match.playbookId === "retry-stuck-sync");
  assert.ok(retry, "stuck retryable failures match the retry playbook");
  assert.equal(retry.tier, PLAYBOOK_TIERS.AUTO);
  assert.equal(retry.command, "RETRY_FAILED_SYNC");
  assert.ok(retry.ownerSummary.includes("retried"), "the owner gets a sentence, not a command name");
  assert.equal(retry.evidence.retryableFailures, 3, "the evidence explains why it fired");

  // 3) A failure that CANNOT succeed on retry must not trigger a retry.
  const permanent = evaluatePlaybooks(
    signals({ sync: { counts: { failed: 2, pending: 0 }, recentFailures: [{ retryable: false }] } }),
  );
  assert.ok(
    !permanent.some((match) => match.playbookId === "retry-stuck-sync"),
    "a permanently failed entry is not retried in a loop",
  );

  // 4) A stale-deploy chunk error is recognised — but stays suggest-only, because
  //    the fix reloads the page and could drop a half-built bill.
  const chunkError = evaluatePlaybooks(
    signals({
      errors: [
        { title: "Failed to fetch dynamically imported module: /assets/BillingPage-x.js", count: 5, lastSeenAt: new Date() },
      ],
    }),
  );
  const staleDeploy = chunkError.find((match) => match.playbookId === "stale-deploy-chunk-error");
  assert.ok(staleDeploy, "a chunk-load error is recognised as a stale deploy");
  assert.equal(staleDeploy.tier, PLAYBOOK_TIERS.SUGGEST, "a page-reloading fix is never automatic");

  // 5) Every reloading or heavy command in the catalog is suggest-tier. This is the
  //    invariant that keeps a future playbook from quietly becoming disruptive.
  for (const playbook of PLAYBOOKS) {
    if (playbook.command === "REFRESH_APP" || playbook.command === "PULL_FROM_CLOUD") {
      assert.equal(playbook.tier, PLAYBOOK_TIERS.SUGGEST, `${playbook.id} must not auto-dispatch a disruptive fix`);
    }
  }

  // ── Dispatch ────────────────────────────────────────────────────────────

  // 6) With a real stuck queue, auto-fix queues the fix for the device.
  await db.offlineSyncEvent.createMany({
    // OfflineSyncEvent is shop-scoped, not device-scoped — the queue belongs to the
    // shop and any of its devices can drain it.
    data: [1, 2, 3].map((n) => ({
      shopId: shop.id,
      eventId: `evt-${suffix}-${n}`,
      type: "UPDATE_INVENTORY",
      status: "failed",
      attempts: 2,
      error: "Network request failed",
      requestJson: "{}",
    })),
  });

  resetAutoFixThrottle();
  const first = await runAutoFix({ shopId: shop.id, deviceId: DEVICE_ID });
  assert.equal(first.evaluated, true, "evaluation ran");
  assert.ok(
    first.dispatched.some((entry) => entry.playbookId === "retry-stuck-sync"),
    "the auto-tier fix was dispatched with no human involved",
  );

  const queued = await db.deviceCommand.findFirst({ where: { shopId: shop.id, playbookId: "retry-stuck-sync" } });
  assert.ok(queued, "a command row exists");
  assert.equal(queued.sessionId, null, "an automatic dispatch has no operator session");
  assert.equal(queued.issuedByEmail, null, "and no operator identity");
  assert.equal(queued.status, COMMAND_STATUS.QUEUED);

  // It is in the owner's audit timeline — nobody remembers doing this one.
  const audit = await db.auditLog.findFirst({ where: { shopId: shop.id, action: "SUPPORT_AUTOFIX_DISPATCHED" } });
  assert.ok(audit, "an unattended fix is audited");

  // 7) Cooldown: the same playbook does not fire again straight away.
  resetAutoFixThrottle();
  const second = await runAutoFix({ shopId: shop.id, deviceId: DEVICE_ID });
  assert.ok(
    second.skipped.some((entry) => entry.playbookId === "retry-stuck-sync" && entry.reason === "cooldown"),
    "the same fix is not re-queued inside its cooldown",
  );
  const afterCooldown = await db.deviceCommand.count({ where: { shopId: shop.id, playbookId: "retry-stuck-sync" } });
  assert.equal(afterCooldown, 1, "still exactly one command — no pile-up");

  // 8) Throttle: a device polling in a tight loop does not re-evaluate every time.
  const throttled = await runAutoFix({ shopId: shop.id, deviceId: DEVICE_ID });
  assert.equal(throttled.evaluated, false, "rapid polls skip evaluation entirely");

  // 9) Circuit breaker: once the fix has failed repeatedly, stop trying it.
  await db.deviceCommand.updateMany({
    where: { shopId: shop.id, playbookId: "retry-stuck-sync" },
    data: { status: COMMAND_STATUS.FAILED, createdAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  for (const n of [1, 2]) {
    await db.deviceCommand.create({
      data: {
        shopId: shop.id,
        deviceId: DEVICE_ID,
        playbookId: "retry-stuck-sync",
        type: "RETRY_FAILED_SYNC",
        status: COMMAND_STATUS.FAILED,
        createdAt: new Date(Date.now() - n * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  }

  resetAutoFixThrottle();
  const brokenFix = await runAutoFix({ shopId: shop.id, deviceId: DEVICE_ID });
  assert.ok(
    brokenFix.skipped.some((entry) => entry.playbookId === "retry-stuck-sync" && entry.reason === "failing"),
    "a fix that keeps failing stops re-firing and leaves the problem visible",
  );

  // 10) The owner's opt-out stops unattended fixes dead.
  await db.deviceCommand.deleteMany({ where: { shopId: shop.id } });
  await updateAutoFixSettings(shop.id, { enabled: false });

  resetAutoFixThrottle();
  const optedOut = await runAutoFix({ shopId: shop.id, deviceId: DEVICE_ID });
  assert.ok(
    optedOut.skipped.some((entry) => entry.reason === "disabled"),
    "a shop that opted out is skipped",
  );
  assert.equal(optedOut.dispatched.length, 0, "and nothing is queued");
  assert.equal(await db.deviceCommand.count({ where: { shopId: shop.id } }), 0, "no command row was written");

  // 11) Opting out silences the DISPATCHER, not the DIAGNOSIS — an operator who is
  //     invited in must still see what the shop needs.
  assert.ok(optedOut.evaluated, "signals are still evaluated");

  // 12) Turning it back on restores dispatch.
  await updateAutoFixSettings(shop.id, { enabled: true });
  resetAutoFixThrottle();
  const reEnabled = await runAutoFix({ shopId: shop.id, deviceId: DEVICE_ID });
  assert.ok(reEnabled.dispatched.length > 0, "re-enabling resumes automatic fixes");

  // 13) A device that belongs to another shop is never acted on.
  resetAutoFixThrottle();
  const foreign = await runAutoFix({ shopId: shop.id, deviceId: "not-this-shops-device" });
  assert.equal(foreign.dispatched.length, 0, "an unknown device gets nothing queued");

  console.log("remote-support-playbooks.examples.js OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.deviceCommand.deleteMany({ where: { shopId: shop?.id } });
      await db.offlineSyncEvent.deleteMany({ where: { shopId: shop?.id } });
      await db.device.deleteMany({ where: { shopId: shop?.id } });
      await db.auditLog.deleteMany({ where: { shopId: shop?.id } });
      await db.shop.deleteMany({ where: { id: shop?.id } });
    } catch (cleanupError) {
      console.error("cleanup failed", cleanupError);
    }
    await db.$disconnect();
  });
