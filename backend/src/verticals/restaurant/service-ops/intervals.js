/**
 * Interval overlap, shared by table reservations and staff shifts because both
 * enforce the same shape of rule: one table cannot be promised to two parties at
 * once, and one person cannot be rostered in two places at once.
 *
 * No unique index can express "overlaps", so this is the only guard, which is why
 * it is pure and tested directly rather than only through the database.
 *
 * Half-open intervals [start, end): a booking ending at 20:00 and one starting at
 * 20:00 do not collide. Treating them as a collision would refuse the back-to-back
 * seatings a busy restaurant depends on.
 */
export function intervalEnd(startsAt, durationMinutes) {
  return new Date(new Date(startsAt).getTime() + Math.max(0, Number(durationMinutes) || 0) * 60_000);
}

export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime()
    && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

/**
 * The first existing row whose interval collides with the candidate. Returns the
 * row itself rather than a boolean so the caller can name it in the error — "Table
 * 5 is already held for Sharma at 20:00" is actionable, "conflict" is not.
 */
export function findOverlap(candidate, existing) {
  const candidateEnd = intervalEnd(candidate.startsAt, candidate.durationMinutes);
  for (const row of existing) {
    if (candidate.excludeId && row.id === candidate.excludeId) continue;
    const rowEnd = row.endsAt ? new Date(row.endsAt) : intervalEnd(row.startsAt, row.durationMinutes);
    if (intervalsOverlap(candidate.startsAt, candidateEnd, row.startsAt, rowEnd)) return row;
  }
  return null;
}
