import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  claimDeviceCommands,
  completeDeviceCommand,
  createSupportSession,
  endSupportSession,
  getShopSupportState,
  queueDeviceCommand,
  redeemSupportCode,
  requireOperatorSession,
  revokeSupportSession,
} from "../src/modules/remote-support/remoteSupport.service.js";
import { COMMAND_SCOPES, COMMAND_STATUS, SESSION_STATUS } from "../src/modules/remote-support/commands.catalog.js";

// Proves the remote-support contract: an operator reaches a shop ONLY through a
// code its owner handed out, only for as long as that grant lives, and only via
// commands in the catalog. Every failure mode below is a way a support tool
// becomes a backdoor, so each one is asserted rather than assumed.

const suffix = `remote-support-${Date.now()}`;
const OPERATOR = "operator@example.com";
let shopA;
let shopB;

async function expectRejection(promise, code, message) {
  try {
    await promise;
    assert.fail(`${message} — expected rejection with ${code}, but it resolved`);
  } catch (error) {
    assert.equal(error.code, code, `${message} (got: ${error.message})`);
  }
}

async function main() {
  shopA = await db.shop.create({ data: { name: `A ${suffix}`, ownerName: "A", city: "X", address: "Y" } });
  shopB = await db.shop.create({ data: { name: `B ${suffix}`, ownerName: "B", city: "X", address: "Y" } });
  await db.device.create({ data: { shopId: shopA.id, deviceId: "till-1", deviceName: "Counter", status: "active" } });
  await db.device.create({ data: { shopId: shopB.id, deviceId: "till-2", deviceName: "Other", status: "active" } });

  // 1) The owner grants access and gets a 6-digit code back exactly once.
  const granted = await createSupportSession({
    shopId: shopA.id,
    scope: COMMAND_SCOPES.REPAIR,
    reason: "bills not syncing",
  });
  assert.match(granted.code, /^\d{6}$/, "owner receives a 6-digit code");
  assert.equal(granted.session.status, SESSION_STATUS.PENDING, "a fresh grant is pending until support redeems it");
  assert.equal(granted.session.shopId, shopA.id);

  // The plaintext code is never persisted, so no later read can reveal it.
  const stored = await db.supportSession.findUnique({ where: { id: granted.session.id } });
  assert.notEqual(stored.codeHash, granted.code, "the code is stored hashed, never in the clear");
  assert.ok(!JSON.stringify(granted.session).includes(granted.code), "the session view never echoes the code");

  // 2) Only one live grant per shop — two open doors is one more than anyone can watch.
  await expectRejection(
    createSupportSession({ shopId: shopA.id }),
    "SUPPORT_SESSION_ALREADY_OPEN",
    "a second concurrent grant is refused",
  );

  // 3) A wrong code reaches nothing.
  await expectRejection(
    redeemSupportCode({ code: "000000", operatorEmail: OPERATOR }),
    "SUPPORT_CODE_INVALID",
    "an unknown code is rejected",
  );

  // 4) The right code resolves to the granting shop — the operator never names it.
  const redeemed = await redeemSupportCode({ code: granted.code, operatorEmail: OPERATOR });
  assert.equal(redeemed.session.shopId, shopA.id, "the code alone determines which shop is opened");
  assert.equal(redeemed.session.status, SESSION_STATUS.ACTIVE);
  assert.equal(redeemed.shop.id, shopA.id);

  // 5) A session belongs to the operator who opened it.
  await expectRejection(
    requireOperatorSession({ sessionId: granted.session.id, operatorEmail: "someone-else@example.com" }),
    "SUPPORT_SESSION_FOREIGN",
    "another operator cannot ride an open session",
  );

  const session = await requireOperatorSession({ sessionId: granted.session.id, operatorEmail: OPERATOR });

  // 6) Commands outside the catalog cannot be queued at all.
  await expectRejection(
    queueDeviceCommand({ session, type: "DELETE_ALL_BILLS", params: { deviceId: "till-1" } }),
    "COMMAND_NOT_ALLOWED",
    "an off-catalog command is refused",
  );

  // 7) A session cannot reach a device belonging to another shop.
  await expectRejection(
    queueDeviceCommand({ session, type: "RUN_SYNC_NOW", params: { deviceId: "till-2" } }),
    "COMMAND_DEVICE_UNKNOWN",
    "another shop's device is invisible to this session",
  );

  // 8) A repair command queues, and only the target device can claim it.
  const queued = await queueDeviceCommand({
    session,
    type: "RETRY_FAILED_SYNC",
    params: { deviceId: "till-1" },
    reason: "clearing the stuck outbox",
  });
  assert.equal(queued.status, COMMAND_STATUS.QUEUED);
  assert.equal(queued.label, "Retry everything that failed to sync", "the owner-visible label travels with the command");

  const otherShopClaim = await claimDeviceCommands({ shopId: shopB.id, deviceId: "till-1" });
  assert.equal(otherShopClaim.length, 0, "a command is scoped to the shop that authorised it");

  const claimed = await claimDeviceCommands({ shopId: shopA.id, deviceId: "till-1" });
  assert.equal(claimed.length, 1, "the target device receives its command");
  assert.equal(claimed[0].type, "RETRY_FAILED_SYNC");

  const reclaimed = await claimDeviceCommands({ shopId: shopA.id, deviceId: "till-1" });
  assert.equal(reclaimed.length, 0, "a delivered command is not handed out twice");

  // 9) The device reports back, and the result is readable by the owner.
  const done = await completeDeviceCommand({
    shopId: shopA.id,
    deviceId: "till-1",
    commandId: claimed[0].id,
    status: COMMAND_STATUS.APPLIED,
    result: { retried: 3 },
  });
  assert.equal(done.status, COMMAND_STATUS.APPLIED);
  assert.deepEqual(done.result, { retried: 3 }, "the device's result round-trips");

  const ownerView = await getShopSupportState({ shopId: shopA.id });
  assert.equal(ownerView.activeSession.id, granted.session.id, "the owner can see support is currently in their shop");
  assert.equal(ownerView.recentCommands[0].type, "RETRY_FAILED_SYNC", "the owner sees exactly what was run");
  assert.ok(
    ownerView.recentCommands[0].ownerSummary.includes("retried"),
    "the owner sees it in plain language, not a command name",
  );

  // 10) Revoking is a real stop button: the session dies AND queued work is cancelled.
  const pendingWhenRevoked = await queueDeviceCommand({ session, type: "REFRESH_APP", params: { deviceId: "till-1" } });
  const revoked = await revokeSupportSession({ shopId: shopA.id, sessionId: granted.session.id });
  assert.equal(revoked.session.status, SESSION_STATUS.REVOKED);
  assert.equal(revoked.cancelledCommands, 1, "work already queued is withdrawn along with consent");

  const afterRevoke = await db.deviceCommand.findUnique({ where: { id: pendingWhenRevoked.id } });
  assert.equal(afterRevoke.status, COMMAND_STATUS.CANCELLED, "the cancelled command can never be claimed");
  const claimAfterRevoke = await claimDeviceCommands({ shopId: shopA.id, deviceId: "till-1" });
  assert.equal(claimAfterRevoke.length, 0, "nothing is delivered after consent is withdrawn");

  await expectRejection(
    requireOperatorSession({ sessionId: granted.session.id, operatorEmail: OPERATOR }),
    "SUPPORT_SESSION_INACTIVE",
    "the operator loses access the moment the owner revokes",
  );

  // 11) A diagnose-scoped grant can look, but cannot repair.
  const readOnly = await createSupportSession({ shopId: shopA.id, scope: COMMAND_SCOPES.DIAGNOSE });
  await redeemSupportCode({ code: readOnly.code, operatorEmail: OPERATOR });
  const readOnlySession = await requireOperatorSession({ sessionId: readOnly.session.id, operatorEmail: OPERATOR });

  await expectRejection(
    queueDeviceCommand({ session: readOnlySession, type: "REFRESH_APP", params: { deviceId: "till-1" } }),
    "COMMAND_SCOPE_DENIED",
    "a read-only session cannot run a repair",
  );

  const readOnlyAllowed = await queueDeviceCommand({
    session: readOnlySession,
    type: "COLLECT_DIAGNOSTICS",
    params: { deviceId: "till-1" },
  });
  assert.equal(readOnlyAllowed.type, "COLLECT_DIAGNOSTICS", "a read-only session can still gather diagnostics");

  // 12) An expired grant is dead even though nothing explicitly revoked it.
  await db.supportSession.update({
    where: { id: readOnly.session.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await expectRejection(
    requireOperatorSession({ sessionId: readOnly.session.id, operatorEmail: OPERATOR }),
    "SUPPORT_SESSION_INACTIVE",
    "access ends by itself when the window closes",
  );
  const expired = await db.supportSession.findUnique({ where: { id: readOnly.session.id } });
  assert.equal(expired.status, SESSION_STATUS.EXPIRED, "the overdue session is retired on the next read");
  assert.equal(expired.codeHash, `spent:${expired.id}`, "a retired session releases its code back into circulation");

  // 13) Session expiry governs the OPERATOR's access, not work already authorised.
  //     The COLLECT_DIAGNOSTICS queued in (11) was consented to before the window
  //     closed, and the device it targets may simply have been offline all along —
  //     which is the exact case remote support exists for. It therefore survives
  //     until its own TTL. Withdrawing consent is what cancels queued work, and
  //     (10) proves revoke does precisely that.
  const survivors = await db.deviceCommand.findMany({
    where: { shopId: shopA.id, status: COMMAND_STATUS.QUEUED },
  });
  assert.equal(survivors.length, 1, "one authorised command is still pending from the now-expired session");
  assert.equal(survivors[0].type, "COLLECT_DIAGNOSTICS", "and it is the one the owner consented to");

  // 14) A row written outside the API still cannot make a device do anything.
  const forgedSession = await createSupportSession({ shopId: shopA.id, scope: COMMAND_SCOPES.REPAIR });
  await db.deviceCommand.create({
    data: {
      shopId: shopA.id,
      deviceId: "till-1",
      type: "WIPE_EVERYTHING",
      status: COMMAND_STATUS.QUEUED,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const forgedClaim = await claimDeviceCommands({ shopId: shopA.id, deviceId: "till-1" });
  assert.ok(
    !forgedClaim.some((command) => command.type === "WIPE_EVERYTHING"),
    "the catalog is enforced on hand-off, not only on queueing",
  );
  const forgedRow = await db.deviceCommand.findFirst({ where: { shopId: shopA.id, type: "WIPE_EVERYTHING" } });
  assert.equal(forgedRow.status, COMMAND_STATUS.CANCELLED, "an off-catalog row is cancelled rather than delivered");

  // 15) An operator closing their own session ends it cleanly.
  await redeemSupportCode({ code: forgedSession.code, operatorEmail: OPERATOR });
  const ended = await endSupportSession({ sessionId: forgedSession.session.id, operatorEmail: OPERATOR });
  assert.equal(ended.status, SESSION_STATUS.ENDED);
  const idleView = await getShopSupportState({ shopId: shopA.id });
  assert.equal(idleView.activeSession, null, "with no session open, the owner sees nobody in their shop");

  console.log("remote-support.examples.js OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const ids = [shopA?.id, shopB?.id].filter(Boolean);
    try {
      await db.deviceCommand.deleteMany({ where: { shopId: { in: ids } } });
      await db.supportSession.deleteMany({ where: { shopId: { in: ids } } });
      await db.device.deleteMany({ where: { shopId: { in: ids } } });
      await db.auditLog.deleteMany({ where: { shopId: { in: ids } } });
      await db.shop.deleteMany({ where: { id: { in: ids } } });
    } catch (cleanupError) {
      console.error("cleanup failed", cleanupError);
    }
    await db.$disconnect();
  });
