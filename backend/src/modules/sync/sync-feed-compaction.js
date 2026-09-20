/**
 * How a page of the change feed becomes a page of changes.
 *
 * The feed counts writes, not entities. A twelve-line bill paid once appends
 * fourteen ChangeLog rows — one for the Bill, one per BillItem, one per Payment
 * — because the child triggers roll their change up onto the parent
 * (`entityType: 'bill', entityId: NEW."billId"`, see
 * 20260714011000_monotonic_sync_feed). All fourteen name the same bill.
 *
 * Every one of them used to become its own change. `loadSequenceEntities`
 * resolves a feed row to the entity's CURRENT state rather than its state at
 * that seq, so those fourteen changes carried fourteen identical copies of the
 * bill, items and payments included — and the client merged the same bill into
 * IndexedDB fourteen times. Sending it once is the same end state by a shorter
 * road: the merge is per-entity and last-write-wins either way.
 *
 * Kept free of imports so it can be tested as logic rather than asserted as
 * text, the same way `sync-cadence.ts` is on the frontend.
 */

/**
 * How many raw feed rows one page may read to fill its compacted limit.
 *
 * Reading `limit` RAW rows spent a 500-row page on roughly three dozen bills,
 * and `limit` is what bounds the page. Reading `limit` DISTINCT ENTITIES needs a
 * wider window over the feed, which this factor supplies. The window is a scan
 * of an indexed range (`@@index([shopId, seq])`) whose rows are four short
 * columns; the expensive half of a page is loading the entities, and that is
 * bounded by the compacted count, not by this.
 */
export const PULL_COMPACTION_SCAN_FACTOR = 10;

/** Capped so a pathological feed cannot make one page read unbounded rows. */
export const PULL_COMPACTION_MAX_SCAN = 5_000;

/**
 * Collapse a run of feed rows to one change per entity.
 *
 * Two details carry the correctness:
 *
 *   - The winning row is the LAST one, so an entity inserted and then deleted
 *     inside one page is reported as a delete. Taking the first would resurrect
 *     it on every device in the shop.
 *   - The position is the FIRST one, which is what a Map gives when an existing
 *     key is re-set. Ordering by the winning seq instead would let an entity
 *     drift behind rows written after it first appeared — a bill could then land
 *     ahead of the customer it names, which strict seq order never did.
 *
 * Stops at `pageLimit` distinct entities and reports where it stopped, so the
 * caller advances the cursor only over rows this actually consumed. A row read
 * but not sent must never be stepped over: the cursor a page returns is what the
 * device acknowledges, and anything below it is gone for good.
 *
 * @returns {{ winners: object[], consumed: number, stoppedAtLimit: boolean }}
 */
export function compactFeedRows(rows, pageLimit) {
  const latestByIdentity = new Map();
  let consumed = 0;
  let stoppedAtLimit = false;
  for (const log of rows) {
    const identity = `${log.entityType}:${log.entityId}`;
    if (!latestByIdentity.has(identity) && latestByIdentity.size >= pageLimit) {
      stoppedAtLimit = true;
      break;
    }
    latestByIdentity.set(identity, log);
    consumed += 1;
  }
  return { winners: [...latestByIdentity.values()], consumed, stoppedAtLimit };
}
