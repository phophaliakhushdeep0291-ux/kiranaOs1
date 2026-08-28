/**
 * The parts of the restore drill that can be reasoned about without a database.
 *
 * Split out from the drill itself for one reason: a recovery procedure that has
 * only ever been run by hand, on a machine that happened to have PostgreSQL
 * credentials, is not a procedure. These functions decide whether a drill may
 * run, whether the restored copy actually matches the source, and how old the
 * backup was — and they are unit-tested, so the parts that need a live server
 * are only the ones that genuinely do.
 */

/** Everything a drill needs before it is allowed to touch a database. */
export const DRILL_REQUIREMENTS = [
  { key: "DATABASE_URL", why: "The live database to back up. Must be PostgreSQL." },
  { key: "RESTORE_TEST_DATABASE_URL", why: "A scratch database to restore INTO. Its name must contain test/restore/drill/staging and must not look like production." },
  { key: "ALLOW_RESTORE_TEST_DB", why: "Set to true to confirm you accept that the restore target's schema is dropped and rebuilt." },
];

/**
 * What is missing before a drill can run, in the order a human should fix it.
 *
 * Returns an empty array when the drill is runnable. Deliberately does not read
 * `process.env` itself so a caller can check any environment — including the one
 * a scheduler will use, before the schedule is created rather than after it has
 * silently failed for a month.
 */
export function missingRequirements(env = {}) {
  const missing = [];
  for (const requirement of DRILL_REQUIREMENTS) {
    const value = String(env[requirement.key] ?? "").trim();
    if (!value) {
      missing.push({ ...requirement, reason: "not set" });
      continue;
    }
    if (requirement.key === "ALLOW_RESTORE_TEST_DB" && value.toLowerCase() !== "true") {
      missing.push({ ...requirement, reason: `set to "${value}", expected "true"` });
    }
  }
  return missing;
}

/**
 * How much trade a restore from this backup would lose.
 *
 * The recovery point objective is the only number that answers "if the server
 * died now, what would the cafe have to reconstruct from memory". A drill that
 * proves a restore works but not how stale it is has proven the easy half.
 */
export function recoveryPoint({ backupTakenAt, now = Date.now(), objectiveHours = 24 }) {
  const takenAt = typeof backupTakenAt === "number" ? backupTakenAt : Date.parse(backupTakenAt);
  if (!Number.isFinite(takenAt)) {
    return { known: false, withinObjective: false, reason: "backup timestamp is unreadable" };
  }
  const ageMs = Math.max(0, now - takenAt);
  const ageHours = ageMs / 3_600_000;
  return {
    known: true,
    ageHours: Math.round(ageHours * 100) / 100,
    objectiveHours,
    withinObjective: ageHours <= objectiveHours,
    // Said in the units a shopkeeper thinks in, not milliseconds.
    summary: ageHours < 1
      ? `${Math.round(ageMs / 60_000)} minutes of trade at risk`
      : `${(Math.round(ageHours * 10) / 10).toFixed(1)} hours of trade at risk`,
  };
}

/**
 * Compare what the source held against what came back.
 *
 * Counting tables proves a restore ran. It does not prove the money survived,
 * which is the only thing anyone actually cares about — so every figure here is
 * compared exactly, and integer paise are compared as integers. A float mirror
 * can print identically on both sides and still differ, which is how a drill
 * passes while a rupee is missing.
 *
 * Any variance is a failure. There is no tolerance, because there is no amount
 * of a cafe's takings it is acceptable to lose.
 */
export function reconcile(source = {}, restored = {}) {
  const keys = [...new Set([...Object.keys(source), ...Object.keys(restored)])].sort();
  const variances = [];

  for (const key of keys) {
    const before = source[key];
    const after = restored[key];
    if (before === undefined) {
      variances.push({ metric: key, source: null, restored: after, note: "present only after restore" });
      continue;
    }
    if (after === undefined) {
      variances.push({ metric: key, source: before, restored: null, note: "lost in restore" });
      continue;
    }
    if (typeof before === "bigint" || typeof after === "bigint") {
      if (BigInt(before) !== BigInt(after)) {
        variances.push({ metric: key, source: String(before), restored: String(after), note: "differs" });
      }
      continue;
    }
    if (Number(before) !== Number(after)) {
      variances.push({ metric: key, source: before, restored: after, note: "differs" });
    }
  }

  return { matched: variances.length === 0, compared: keys.length, variances };
}

/** The queries a drill runs on both sides. Shop-scoped totals, not row counts alone. */
export const RECONCILE_QUERIES = {
  tables: `SELECT COUNT(*)::text FROM information_schema.tables WHERE table_schema='public'`,
  shops: `SELECT COUNT(*)::text FROM "Shop"`,
  bills: `SELECT COUNT(*)::text FROM "Bill" WHERE "deletedAt" IS NULL`,
  billTotalPaise: `SELECT COALESCE(SUM("grandTotalPaise"),0)::text FROM "Bill" WHERE "deletedAt" IS NULL AND "status"='active'`,
  customerOrders: `SELECT COUNT(*)::text FROM "CustomerOrder"`,
  restaurantTables: `SELECT COUNT(*)::text FROM "RestaurantTable" WHERE "deletedAt" IS NULL`,
  auditRows: `SELECT COUNT(*)::text FROM "AuditLog"`,
};

/** A one-screen verdict a non-engineer can act on. */
export function formatVerdict({ reconciliation, rpo, backupFile }) {
  const lines = [];
  lines.push(reconciliation.matched
    ? `PASS  restored copy matches the source on all ${reconciliation.compared} checks`
    : `FAIL  ${reconciliation.variances.length} of ${reconciliation.compared} checks differ after restore`);
  for (const variance of reconciliation.variances) {
    lines.push(`      ${variance.metric}: source ${variance.source} -> restored ${variance.restored} (${variance.note})`);
  }
  if (rpo.known) {
    lines.push(rpo.withinObjective
      ? `PASS  backup is ${rpo.summary}, inside the ${rpo.objectiveHours}h objective`
      : `FAIL  backup is ${rpo.summary}, past the ${rpo.objectiveHours}h objective`);
  } else {
    lines.push(`FAIL  recovery point unknown: ${rpo.reason}`);
  }
  if (backupFile) lines.push(`      restored from ${backupFile}`);
  return lines.join("\n");
}
