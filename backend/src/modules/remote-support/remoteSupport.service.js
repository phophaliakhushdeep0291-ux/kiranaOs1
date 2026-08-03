import crypto from "node:crypto";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import {
  COMMAND_SCOPES,
  COMMAND_STATUS,
  COMMAND_TTL_MS,
  DEFAULT_SESSION_TTL_MINUTES,
  MAX_SESSION_TTL_MINUTES,
  SESSION_STATUS,
  getCommandDefinition,
  isKnownCommand,
  sessionAllowsCommand,
} from "./commands.catalog.js";

// Remote support: the owner grants a time-boxed window, the operator works inside
// it, the device drains an allowlisted command queue on its existing sync poll.
//
// Three invariants hold everywhere in this file:
//   1. No session, no access. An operator with no live grant sees nothing.
//   2. Every command is checked against the catalog twice — on queue and on hand-off.
//   3. shopId always comes from the session row, never from the operator's request.

const CODE_DIGITS = 6;
const CODE_MIN = 10 ** (CODE_DIGITS - 1);
const CODE_RANGE = 9 * CODE_MIN;
const MAX_CODE_ATTEMPTS = 12;
const MAX_COMMANDS_PER_POLL = 5;

// Redemption is the one endpoint where a guess is worth something, so failures are
// counted per operator. In-memory is the right scope: the window is minutes long,
// and a restart clearing it costs an attacker nothing they did not already have.
const REDEEM_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const REDEEM_FAILURE_LIMIT = 10;
const redeemFailures = new Map();

function hashCode(code) {
  // Peppered with the server secret so the stored hash is useless without it, and
  // deterministic so redemption is a single indexed lookup rather than a scan.
  return crypto.createHash("sha256").update(`support-code:${code}:${env.JWT_SECRET}`).digest("hex");
}

function generateCode() {
  return String(CODE_MIN + crypto.randomInt(CODE_RANGE));
}

// A terminal session releases its 6-digit code back into circulation. Without this
// the unique index would slowly consume a 900k-wide space and start colliding.
function spentCodeHash(sessionId) {
  return `spent:${sessionId}`;
}

function normalizeScope(scope) {
  return scope === COMMAND_SCOPES.REPAIR ? COMMAND_SCOPES.REPAIR : COMMAND_SCOPES.DIAGNOSE;
}

function ttlMinutes(requested) {
  const value = Number(requested);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SESSION_TTL_MINUTES;
  return Math.min(Math.floor(value), MAX_SESSION_TTL_MINUTES);
}

function safeJsonParse(value, fallback) {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isLive(session) {
  if (!session) return false;
  if (session.status !== SESSION_STATUS.PENDING && session.status !== SESSION_STATUS.ACTIVE) return false;
  return session.expiresAt.getTime() > Date.now();
}

/** Public shape — never leaks codeHash. */
export function presentSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    shopId: session.shopId,
    scope: session.scope,
    status: session.status,
    deviceId: session.deviceId,
    operatorEmail: session.operatorEmail,
    reason: session.reason,
    redeemedAt: session.redeemedAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    endedAt: session.endedAt,
    commandCount: session.commandCount,
    createdAt: session.createdAt,
    expiresInSeconds: Math.max(0, Math.round((session.expiresAt.getTime() - Date.now()) / 1000)),
  };
}

export function presentCommand(command) {
  if (!command) return null;
  const definition = getCommandDefinition(command.type);
  return {
    id: command.id,
    type: command.type,
    label: definition?.label ?? command.type,
    // A playbook writes its own owner-facing sentence (it knows *why* it fired);
    // the catalog's generic one is the fallback for operator-issued commands.
    ownerSummary: safeJsonParse(command.paramsJson, {})?.ownerSummary ?? definition?.ownerSummary ?? null,
    playbookId: command.playbookId ?? null,
    automatic: command.playbookId != null && command.sessionId == null,
    deviceId: command.deviceId,
    status: command.status,
    reason: command.reason,
    issuedByEmail: command.issuedByEmail,
    attempts: command.attempts,
    deliveredAt: command.deliveredAt,
    completedAt: command.completedAt,
    result: safeJsonParse(command.resultJson, null),
    error: command.error,
    createdAt: command.createdAt,
  };
}

/**
 * Lazily retire whatever has run out of time. A cron would be a second thing to
 * operate and monitor for a job whose only deadline is "before the next read", so
 * the reads do it themselves.
 */
export async function expireOverdue({ shopId = null } = {}) {
  const now = new Date();
  const sessionWhere = {
    status: { in: [SESSION_STATUS.PENDING, SESSION_STATUS.ACTIVE] },
    expiresAt: { lt: now },
    ...(shopId ? { shopId } : {}),
  };

  // codeHash must be freed per-row, so overdue sessions are retired individually.
  // The set is tiny — only what expired since the last read touched this shop.
  const overdue = await db.supportSession.findMany({ where: sessionWhere, select: { id: true } });
  for (const { id } of overdue) {
    await db.supportSession
      .update({
        where: { id },
        data: { status: SESSION_STATUS.EXPIRED, endedAt: now, codeHash: spentCodeHash(id) },
      })
      .catch(() => null);
  }

  // Commands are retired on their OWN clock, not the session's. The session TTL
  // bounds how long an operator may look around; a queued command is an action the
  // owner already consented to, aimed at a device that is very often offline —
  // which is the case remote support exists for. Withdrawing consent is what kills
  // pending work, and revokeSupportSession does exactly that.
  await db.deviceCommand
    .updateMany({
      where: {
        status: { in: [COMMAND_STATUS.QUEUED, COMMAND_STATUS.DELIVERED] },
        expiresAt: { lt: now },
        ...(shopId ? { shopId } : {}),
      },
      data: { status: COMMAND_STATUS.EXPIRED, completedAt: now },
    })
    .catch(() => null);

  return overdue.length;
}

// ─────────────────────────────────────────────
// Owner side — granting and withdrawing access
// ─────────────────────────────────────────────

/**
 * Issue a consent code. Returns the plaintext code exactly once: it is stored only
 * as a peppered hash, so nothing — not this API, not a database dump — can show it
 * again. Losing it costs one tap to reissue.
 */
export async function createSupportSession({
  shopId,
  userId = null,
  scope = COMMAND_SCOPES.DIAGNOSE,
  deviceId = null,
  reason = null,
  expiresInMinutes = DEFAULT_SESSION_TTL_MINUTES,
}) {
  await expireOverdue({ shopId });

  // One live grant per shop. Two open doors is one more than anybody can watch,
  // and it makes "is support in my shop right now?" a question with one answer.
  const existing = await db.supportSession.findFirst({
    where: { shopId, status: { in: [SESSION_STATUS.PENDING, SESSION_STATUS.ACTIVE] } },
    orderBy: { createdAt: "desc" },
  });
  if (isLive(existing)) {
    throw new AppError(
      "A support session is already open for this shop. End it before starting another.",
      409,
      "SUPPORT_SESSION_ALREADY_OPEN",
    );
  }

  const expiresAt = new Date(Date.now() + ttlMinutes(expiresInMinutes) * 60 * 1000);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = generateCode();
    try {
      const session = await db.supportSession.create({
        data: {
          shopId,
          grantedByUserId: userId,
          deviceId,
          codeHash: hashCode(code),
          scope: normalizeScope(scope),
          status: SESSION_STATUS.PENDING,
          reason: reason ? String(reason).slice(0, 500) : null,
          expiresAt,
        },
      });
      return { session: presentSession(session), code };
    } catch (error) {
      // P2002 = the generated code is still held by a live session; draw again.
      if (error?.code !== "P2002") throw error;
    }
  }

  throw new AppError("Could not generate a support code. Please try again.", 503, "SUPPORT_CODE_UNAVAILABLE");
}

export async function getShopSupportState({ shopId }) {
  await expireOverdue({ shopId });

  const [session, recentCommands, recentSessions] = await Promise.all([
    db.supportSession.findFirst({
      where: { shopId, status: { in: [SESSION_STATUS.PENDING, SESSION_STATUS.ACTIVE] } },
      orderBy: { createdAt: "desc" },
    }),
    db.deviceCommand.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.supportSession.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return {
    activeSession: isLive(session) ? presentSession(session) : null,
    recentCommands: recentCommands.map(presentCommand),
    recentSessions: recentSessions.map(presentSession),
  };
}

/**
 * The owner's stop button. Ends the session and cancels anything it queued that a
 * device has not already run — withdrawing consent has to reach work already in
 * flight, or it is not really a stop button.
 */
export async function revokeSupportSession({ shopId, sessionId = null, userId = null }) {
  const session = sessionId
    ? await db.supportSession.findFirst({ where: { id: sessionId, shopId } })
    : await db.supportSession.findFirst({
        where: { shopId, status: { in: [SESSION_STATUS.PENDING, SESSION_STATUS.ACTIVE] } },
        orderBy: { createdAt: "desc" },
      });

  if (!session) throw new AppError("No support session found", 404, "SUPPORT_SESSION_NOT_FOUND");
  if (session.status !== SESSION_STATUS.PENDING && session.status !== SESSION_STATUS.ACTIVE) {
    return { session: presentSession(session), cancelledCommands: 0 };
  }

  const now = new Date();
  const [updated, cancelled] = await Promise.all([
    db.supportSession.update({
      where: { id: session.id },
      data: {
        status: SESSION_STATUS.REVOKED,
        revokedAt: now,
        endedAt: now,
        codeHash: spentCodeHash(session.id),
      },
    }),
    db.deviceCommand.updateMany({
      where: { sessionId: session.id, status: { in: [COMMAND_STATUS.QUEUED, COMMAND_STATUS.DELIVERED] } },
      data: { status: COMMAND_STATUS.CANCELLED, completedAt: now },
    }),
  ]);

  return { session: presentSession(updated), cancelledCommands: cancelled.count, revokedBy: userId };
}

// ─────────────────────────────────────────────
// Operator side — redeeming a grant and using it
// ─────────────────────────────────────────────

function noteRedeemFailure(operatorEmail) {
  const key = String(operatorEmail ?? "unknown").toLowerCase();
  const now = Date.now();
  const entry = redeemFailures.get(key);
  if (!entry || now - entry.firstAt > REDEEM_FAILURE_WINDOW_MS) {
    redeemFailures.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

function assertRedeemAllowed(operatorEmail) {
  const key = String(operatorEmail ?? "unknown").toLowerCase();
  const entry = redeemFailures.get(key);
  if (!entry) return;
  if (Date.now() - entry.firstAt > REDEEM_FAILURE_WINDOW_MS) {
    redeemFailures.delete(key);
    return;
  }
  if (entry.count >= REDEEM_FAILURE_LIMIT) {
    throw new AppError("Too many incorrect support codes. Try again later.", 429, "SUPPORT_CODE_RATE_LIMITED");
  }
}

/**
 * Exchange a code for a session. This is the ONLY way an operator reaches a
 * specific shop's data, and the shop is read off the row — a code is a pointer to
 * a tenant, never an argument the operator supplies.
 */
export async function redeemSupportCode({ code, operatorEmail }) {
  assertRedeemAllowed(operatorEmail);
  await expireOverdue();

  const session = await db.supportSession.findUnique({ where: { codeHash: hashCode(String(code ?? "").trim()) } });
  if (!isLive(session)) {
    noteRedeemFailure(operatorEmail);
    throw new AppError("That support code is not valid or has expired.", 404, "SUPPORT_CODE_INVALID");
  }

  redeemFailures.delete(String(operatorEmail ?? "unknown").toLowerCase());

  // First redemption binds the session to one operator; later calls by the same
  // operator just resume it, so a refreshed console does not need a new code.
  if (session.operatorEmail && session.operatorEmail.toLowerCase() !== String(operatorEmail).toLowerCase()) {
    throw new AppError("That support code is already in use by another operator.", 409, "SUPPORT_CODE_IN_USE");
  }

  const updated = await db.supportSession.update({
    where: { id: session.id },
    data: {
      status: SESSION_STATUS.ACTIVE,
      operatorEmail: String(operatorEmail).toLowerCase(),
      redeemedAt: session.redeemedAt ?? new Date(),
    },
  });

  const shop = await db.shop.findUnique({ where: { id: updated.shopId }, select: { id: true, name: true } });
  return { session: presentSession(updated), shop };
}

/**
 * Re-validate a session on every operator request. Nothing downstream may assume a
 * session is still good because it was good a minute ago — the owner can revoke it
 * mid-call, and that has to take effect on the very next request.
 */
export async function requireOperatorSession({ sessionId, operatorEmail }) {
  await expireOverdue();
  const session = await db.supportSession.findUnique({ where: { id: String(sessionId ?? "") } });
  if (!isLive(session)) {
    throw new AppError("This support session has ended. Ask the owner for a new code.", 403, "SUPPORT_SESSION_INACTIVE");
  }
  if (String(session.operatorEmail ?? "").toLowerCase() !== String(operatorEmail ?? "").toLowerCase()) {
    throw new AppError("This support session belongs to another operator.", 403, "SUPPORT_SESSION_FOREIGN");
  }
  return session;
}

export async function endSupportSession({ sessionId, operatorEmail }) {
  const session = await requireOperatorSession({ sessionId, operatorEmail });
  const now = new Date();
  const updated = await db.supportSession.update({
    where: { id: session.id },
    data: { status: SESSION_STATUS.ENDED, endedAt: now, codeHash: spentCodeHash(session.id) },
  });
  return presentSession(updated);
}

// ─────────────────────────────────────────────
// Command queue
// ─────────────────────────────────────────────

/**
 * Queue one allowlisted command against one device. The session decides the shop
 * and the permitted scope; the caller decides neither.
 */
export async function queueDeviceCommand({ session, type, params = {}, reason = null, issuedByUserId = null }) {
  if (!isKnownCommand(type)) {
    throw new AppError(`Unknown command "${type}".`, 400, "COMMAND_NOT_ALLOWED");
  }
  if (!sessionAllowsCommand(session.scope, type)) {
    throw new AppError(
      "This session can only read diagnostics. Ask the owner for a repair session to run fixes.",
      403,
      "COMMAND_SCOPE_DENIED",
    );
  }

  // A device-pinned session may only act on that device.
  const targetDeviceId = session.deviceId ?? params.deviceId ?? null;
  if (!targetDeviceId) {
    throw new AppError("A target device is required.", 400, "COMMAND_DEVICE_REQUIRED");
  }
  if (session.deviceId && params.deviceId && params.deviceId !== session.deviceId) {
    throw new AppError("This session is limited to one device.", 403, "COMMAND_DEVICE_MISMATCH");
  }

  const command = await insertCommand({
    shopId: session.shopId,
    sessionId: session.id,
    deviceId: String(targetDeviceId),
    type,
    params,
    reason,
    issuedByEmail: session.operatorEmail,
    issuedByUserId,
  });

  await db.supportSession
    .update({ where: { id: session.id }, data: { commandCount: { increment: 1 } } })
    .catch(() => null);

  return command;
}

/**
 * The one place a DeviceCommand row is written. Both callers — a human operator
 * inside a session, and a playbook running unattended — land here, so the device
 * check and the catalog check cannot be true on one path and skipped on the other.
 */
async function insertCommand({
  shopId,
  sessionId = null,
  playbookId = null,
  deviceId,
  type,
  params = {},
  reason = null,
  issuedByEmail = null,
  issuedByUserId = null,
}) {
  if (!isKnownCommand(type)) {
    throw new AppError(`Unknown command "${type}".`, 400, "COMMAND_NOT_ALLOWED");
  }

  const device = await db.device.findFirst({
    where: { shopId, deviceId: String(deviceId) },
    select: { id: true },
  });
  if (!device) throw new AppError("That device is not registered to this shop.", 404, "COMMAND_DEVICE_UNKNOWN");

  const command = await db.deviceCommand.create({
    data: {
      shopId,
      sessionId,
      playbookId,
      deviceId: String(deviceId),
      type,
      paramsJson: JSON.stringify(params ?? {}),
      status: COMMAND_STATUS.QUEUED,
      issuedByEmail,
      issuedByUserId,
      reason: reason ? String(reason).slice(0, 500) : null,
      expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
    },
  });

  return presentCommand(command);
}

/**
 * Queue a command with no operator behind it.
 *
 * This is the one path that runs without an owner-granted session, and it is
 * defensible only because of what it is limited to: no human sees the shop's
 * data, and the command is one the app already runs on its own behalf. It is
 * self-healing, not remote access — and the owner can switch it off entirely.
 */
export async function queueAutomaticCommand({ shopId, deviceId, type, playbookId, reason = null, params = {} }) {
  return insertCommand({
    shopId,
    sessionId: null,
    playbookId,
    deviceId,
    type,
    params,
    reason,
    issuedByEmail: null,
  });
}

/**
 * Hand a device its pending work. Called from the device's own sync poll, so it is
 * scoped by the JWT's shopId and the caller's own device id — a device can never
 * fetch another device's commands, let alone another shop's.
 *
 * The catalog is re-checked here on purpose: queue-time validation protects against
 * a bad request, this protects against a bad row.
 */
export async function claimDeviceCommands({ shopId, deviceId, limit = MAX_COMMANDS_PER_POLL }) {
  if (!deviceId) return [];
  await expireOverdue({ shopId });

  const pending = await db.deviceCommand.findMany({
    where: { shopId, deviceId, status: COMMAND_STATUS.QUEUED },
    orderBy: { createdAt: "asc" },
    take: Math.min(Number(limit) || MAX_COMMANDS_PER_POLL, MAX_COMMANDS_PER_POLL),
  });

  const runnable = [];
  for (const command of pending) {
    if (!isKnownCommand(command.type)) {
      await db.deviceCommand
        .update({
          where: { id: command.id },
          data: {
            status: COMMAND_STATUS.CANCELLED,
            error: "Command type is not in the allowlist",
            completedAt: new Date(),
          },
        })
        .catch(() => null);
      continue;
    }

    const claimed = await db.deviceCommand
      .update({
        where: { id: command.id },
        data: { status: COMMAND_STATUS.DELIVERED, deliveredAt: new Date(), attempts: { increment: 1 } },
      })
      .catch(() => null);
    if (!claimed) continue;

    const definition = getCommandDefinition(command.type);
    runnable.push({
      id: claimed.id,
      type: claimed.type,
      params: safeJsonParse(claimed.paramsJson, {}),
      label: definition.label,
      ownerSummary: definition.ownerSummary,
      reloadsApp: definition.reloadsApp,
      issuedByEmail: claimed.issuedByEmail,
      reason: claimed.reason,
      createdAt: claimed.createdAt,
    });
  }

  return runnable;
}

/** The device reports back what actually happened. */
export async function completeDeviceCommand({ shopId, deviceId, commandId, status, result = null, error = null }) {
  const command = await db.deviceCommand.findFirst({ where: { id: String(commandId ?? ""), shopId, deviceId } });
  if (!command) throw new AppError("Command not found", 404, "COMMAND_NOT_FOUND");

  const terminal = status === COMMAND_STATUS.APPLIED ? COMMAND_STATUS.APPLIED : COMMAND_STATUS.FAILED;
  const updated = await db.deviceCommand.update({
    where: { id: command.id },
    data: {
      status: terminal,
      completedAt: new Date(),
      resultJson: result ? JSON.stringify(result).slice(0, 4000) : null,
      error: error ? String(error).slice(0, 1000) : null,
    },
  });
  return presentCommand(updated);
}

export async function listSessionCommands({ sessionId }) {
  const commands = await db.deviceCommand.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return commands.map(presentCommand);
}
