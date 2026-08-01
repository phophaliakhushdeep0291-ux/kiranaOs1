/**
 * replay-safety.js — the single source of truth for "is this Postgres migration
 * safe for the deploy script to auto-resolve and replay after a P3009 freeze?"
 *
 * `prisma migrate deploy` refuses to apply anything once the target database
 * holds a failed migration record (P3009). The container runs migrations before
 * the app boots, so one interrupted deploy freezes the whole backend until a
 * human intervenes. scripts/deploy-postgres-migrations.js recovers automatically
 * ONLY for migrations that certify themselves idempotent with the `@replay-safe`
 * marker — replaying a partially-applied, non-idempotent migration double-applies
 * or fails again.
 *
 * Two consumers import this module so their rules can never drift apart:
 *   - scripts/migration-safety-check.js  (the P0 `migration:safety` release gate)
 *   - tests/migration-deploy-recovery.examples.js  (run in `npm test`)
 *
 * The contract enforced here:
 *   A. A migration carrying `@replay-safe` MUST actually be idempotent — a false
 *      marker is the dangerous case, because the deploy script WILL replay it.
 *   B. A migration added AFTER the baseline below MUST carry the marker, so an
 *      interrupted deploy can always self-heal. 000075 (ADD COLUMN, no guard) and
 *      000076 (CREATE TRIGGER + unguarded INSERT, no marker) regressed this after
 *      000070–000074 had established the convention; this gate stops a repeat.
 */

export const REPLAY_SAFE_MARKER = "@replay-safe";

// Escape hatch. A migration that genuinely cannot be made idempotent — a one-way
// data backfill, a destructive rewrite — may opt out of the replay-safe
// requirement by declaring `@replay-unsafe: <reason>`. This is a conscious,
// documented acknowledgement that scripts/deploy-postgres-migrations.js will NOT
// auto-recover it after a P3009 freeze (it only replays @replay-safe migrations),
// so an interrupted deploy of it needs manual recovery. The reason is mandatory
// so the trade-off can never be bypassed silently, and a migration may not claim
// both markers.
export const REPLAY_UNSAFE_MARKER = "@replay-unsafe";

// Migrations 000001–000076 predate this gate. They are already applied to the
// production database, so their checksums are frozen — editing their SQL to add
// idempotency guards would make `prisma migrate deploy` reject them (P3005).
// They are therefore grandfathered, exactly like the 000062 historical-duplicate
// exception in migration-safety-check.js. Every migration NUMBERED ABOVE this
// must be replay-safe. This baseline is a fixed historical fact and never needs
// to change.
export const REPLAY_SAFETY_BASELINE_PREFIX = 76;

/** The six-digit numeric prefix of a migration directory, or null if unnamed. */
export function migrationPrefix(dirName) {
  const match = /^(\d{6})_/.exec(dirName);
  return match ? Number(match[1]) : null;
}

/**
 * The reason declared by `@replay-unsafe: <reason>`, or null if the migration
 * does not opt out. An empty string means the marker is present but no reason
 * was given (rejected by replaySafetyViolations).
 */
export function replayUnsafeReason(sql) {
  const match = /@replay-unsafe:?([^\n]*)/i.exec(sql);
  return match ? match[1].trim() : null;
}

/**
 * Reasons the SQL is NOT safe to replay (empty array = idempotent).
 *
 * Identifiers may be quoted (Prisma-generated) or bare (hand-written), so the
 * guards match both — a bare-identifier statement must not slip past unchecked.
 * Line comments are stripped first so prose (and the marker itself) can never
 * satisfy a guard.
 */
export function idempotencyViolations(sql) {
  const violations = [];
  const code = sql.replace(/--[^\n]*/g, "");

  if (/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)["\w]/i.test(code)) {
    violations.push("ADD COLUMN without IF NOT EXISTS");
  }
  if (/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)["\w]/i.test(code)) {
    violations.push("CREATE TABLE without IF NOT EXISTS");
  }
  if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b)["\w]/i.test(code)) {
    violations.push("CREATE INDEX without IF NOT EXISTS");
  }

  let m;

  // Every ADD CONSTRAINT must be preceded (anywhere) by a DROP CONSTRAINT IF
  // EXISTS for the same name, so replay drops-then-adds instead of colliding.
  const addConstraint = /\bADD\s+CONSTRAINT\s+"?(\w+)"?/gi;
  while ((m = addConstraint.exec(code)) !== null) {
    const name = m[1];
    const dropRe = new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+"?${name}"?`, "i");
    if (!dropRe.test(code)) violations.push(`ADD CONSTRAINT "${name}" without a preceding DROP CONSTRAINT IF EXISTS`);
  }

  // Postgres has no CREATE TRIGGER IF NOT EXISTS (before v14, and Prisma does not
  // emit it), so the idempotent form is DROP TRIGGER IF EXISTS then CREATE. Every
  // CREATE TRIGGER must be preceded by a DROP for the same name.
  const createTrigger = /\bCREATE\s+TRIGGER\s+"?(\w+)"?/gi;
  while ((m = createTrigger.exec(code)) !== null) {
    const name = m[1];
    const dropRe = new RegExp(`DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+"?${name}"?`, "i");
    if (!dropRe.test(code)) violations.push(`CREATE TRIGGER "${name}" without a preceding DROP TRIGGER IF EXISTS`);
  }

  // An unguarded INSERT re-inserts its rows on every replay. A re-runnable seed
  // uses ON CONFLICT DO NOTHING, or a WHERE NOT EXISTS / NOT IN guard. Scan per
  // statement so the guard has to belong to the same INSERT it protects.
  for (const statement of code.split(";")) {
    if (!/\bINSERT\s+INTO\b/i.test(statement)) continue;
    const guarded = /\bON\s+CONFLICT\b/i.test(statement)
      || /\bWHERE\s+NOT\s+EXISTS\b/i.test(statement)
      || /\bNOT\s+IN\s*\(/i.test(statement);
    if (!guarded) violations.push("INSERT without ON CONFLICT or WHERE NOT EXISTS guard (re-inserts rows on replay)");
  }

  return violations;
}

/**
 * The full per-migration replay-safety policy, as a list of failure reasons
 * (empty = compliant). Encodes contract A and B above so both the release gate
 * and the test evaluate migrations identically.
 */
export function replaySafetyViolations(dirName, sql) {
  const declaresSafe = sql.includes(REPLAY_SAFE_MARKER);
  const unsafeReason = replayUnsafeReason(sql);

  if (declaresSafe && unsafeReason !== null) {
    return [
      `${dirName} declares both ${REPLAY_SAFE_MARKER} and ${REPLAY_UNSAFE_MARKER} — a migration is one or the other. Pick one.`,
    ];
  }

  if (declaresSafe) {
    // A: a migration that claims replay-safe must actually be idempotent.
    return idempotencyViolations(sql).map(
      (reason) =>
        `${dirName} is marked ${REPLAY_SAFE_MARKER} but is NOT idempotent: ${reason}. ` +
        "Make every statement re-runnable or remove the marker — an auto-replayed non-idempotent migration re-freezes the deploy.",
    );
  }

  if (unsafeReason !== null) {
    // Escape hatch: opting out is allowed, but the reason is mandatory so the
    // "will not auto-recover" trade-off is always a documented decision.
    if (!unsafeReason) {
      return [
        `${dirName} declares ${REPLAY_UNSAFE_MARKER} without a reason. State why it cannot be made idempotent, e.g. ` +
          `'${REPLAY_UNSAFE_MARKER}: one-way backfill, manual recovery documented in the runbook' — an interrupted ` +
          "deploy of it will not auto-recover and needs a human.",
      ];
    }
    return [];
  }

  const prefix = migrationPrefix(dirName);
  if (prefix !== null && prefix > REPLAY_SAFETY_BASELINE_PREFIX) {
    // B: a new migration must certify itself replay-safe, or consciously opt out.
    return [
      `${dirName} must be replay-safe: add the ${REPLAY_SAFE_MARKER} marker and make every statement re-runnable ` +
        "(ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DROP TRIGGER IF EXISTS before CREATE TRIGGER, " +
        "guard INSERTs with ON CONFLICT / WHERE NOT EXISTS). An interrupted deploy of an unmarked migration freezes " +
        "the backend (P3009), because scripts/deploy-postgres-migrations.js only auto-recovers marked migrations. " +
        `If it genuinely cannot be idempotent, declare '${REPLAY_UNSAFE_MARKER}: <reason>' to opt out consciously. ` +
        `Migrations <= ${String(REPLAY_SAFETY_BASELINE_PREFIX).padStart(6, "0")} predate this gate and are grandfathered.`,
    ];
  }

  return [];
}
