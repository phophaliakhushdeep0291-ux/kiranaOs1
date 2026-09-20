/**
 * The page-shape rules of `/sync/pull`, checked as logic.
 *
 * The feed counts writes, not entities: the BillItem and Payment triggers roll
 * their change up onto the parent bill, so one twelve-line bill paid once appends
 * fourteen ChangeLog rows that all name the same bill. Every one of them used to
 * become its own change carrying its own copy of that bill — items, payments and
 * all — because `loadSequenceEntities` resolves each row to the entity's CURRENT
 * state, so all fourteen copies were identical.
 *
 * What must stay true after compaction is not "fewer bytes". It is that the page
 * still says the same thing about the world, and that the cursor it hands back
 * never steps over a row it did not send.
 */
import assert from "node:assert/strict";
import {
  compactFeedRows,
  PULL_COMPACTION_MAX_SCAN,
  PULL_COMPACTION_SCAN_FACTOR,
} from "../src/modules/sync/sync-feed-compaction.js";

let seq = 0;
function row(entityType, entityId, operation = "update") {
  seq += 1;
  return { seq, entityType, entityId, operation, createdAt: new Date(seq * 1000) };
}

// ── One bill's fourteen feed rows are one change ────────────────────────────
{
  seq = 0;
  const bill = [
    row("bill", "bill-1", "insert"),
    ...Array.from({ length: 12 }, () => row("bill", "bill-1")),
    row("bill", "bill-1"),
  ];
  assert.equal(bill.length, 14, "the fixture must be the fourteen rows a twelve-line paid bill writes");

  const { winners, consumed, stoppedAtLimit } = compactFeedRows(bill, 500);
  assert.equal(winners.length, 1, "fourteen rows naming one bill must collapse to one change");
  assert.equal(consumed, 14, "collapsing must still step the cursor over every row it read");
  assert.equal(stoppedAtLimit, false);
}

// ── The LAST operation wins ─────────────────────────────────────────────────
{
  seq = 0;
  // Taking the first row's operation would report this product as an insert and
  // resurrect a deleted product on every device in the shop.
  const { winners } = compactFeedRows(
    [row("product", "p-1", "insert"), row("product", "p-1", "update"), row("product", "p-1", "delete")],
    500,
  );
  assert.equal(winners.length, 1);
  assert.equal(winners[0].operation, "delete", "an entity deleted inside the page must be reported deleted");

  seq = 0;
  const recreated = compactFeedRows(
    [row("product", "p-2", "delete"), row("product", "p-2", "insert")],
    500,
  );
  assert.equal(recreated.winners[0].operation, "insert", "a re-created entity must not stay a tombstone");
}

// ── The FIRST position holds ────────────────────────────────────────────────
{
  seq = 0;
  // A customer created at seq 1, a bill naming it at seq 2, the customer touched
  // again at seq 3. Ordering by the winning seq would send the bill first and put
  // a bill ahead of the customer it references — something strict seq order never
  // did. The customer's position is where it FIRST appeared.
  const customer = row("customer", "c-1", "insert");
  const bill = row("bill", "b-1", "insert");
  row("customer", "c-1", "update");

  const { winners } = compactFeedRows([customer, bill, { ...customer, seq: 3, operation: "update" }], 500);
  assert.deepEqual(
    winners.map((w) => `${w.entityType}:${w.entityId}`),
    ["customer:c-1", "bill:b-1"],
    "an entity must keep the position of its first appearance, not its last change",
  );
  assert.equal(winners[0].operation, "update", "…while still carrying its last operation");
}

// ── The limit counts entities, and the cursor never outruns them ────────────
{
  seq = 0;
  // Ten rows per bill, sixty bills: 600 feed rows, 60 entities. A page limited to
  // 4 entities must stop at the fourth, and must not claim the rows belonging to
  // the fifth — those rows have not been sent, and the cursor this page returns is
  // what the device acknowledges.
  const rows = [];
  for (let bill = 0; bill < 60; bill += 1) {
    for (let write = 0; write < 10; write += 1) rows.push(row("bill", `bill-${bill}`));
  }

  const { winners, consumed, stoppedAtLimit } = compactFeedRows(rows, 4);
  assert.equal(winners.length, 4, "the limit must bound distinct entities, not raw feed rows");
  assert.equal(stoppedAtLimit, true);
  assert.equal(consumed, 40, "exactly the four bills' worth of rows may be stepped over");

  const lastSent = rows[consumed - 1].seq;
  const firstUnsent = rows[consumed].seq;
  assert.ok(lastSent < firstUnsent, "the cursor must stop below the first row this page did not send");
}

// ── A write past the cut is left in the feed, not swallowed ─────────────────
{
  seq = 0;
  // Interleaved, so the rows past the cut include a later write to an entity this
  // page already sent. That row stays in the feed and the entity is sent again on
  // the next page — which is why compaction can send CURRENT state for an entity
  // whose page position is older than its last change and still converge.
  const a = row("bill", "b-a", "insert");
  const b = row("bill", "b-b", "insert");
  const c = row("bill", "b-c", "insert");
  const d = row("bill", "b-d", "insert");
  const e = row("bill", "b-e", "insert");
  const aAgain = row("bill", "b-a", "update");
  const rows = [a, b, c, d, e, aAgain];

  const { winners, consumed, stoppedAtLimit } = compactFeedRows(rows, 4);
  assert.equal(stoppedAtLimit, true);
  assert.equal(consumed, 4, "the fifth entity's row must be left unconsumed");
  assert.deepEqual(winners.map((w) => w.entityId), ["b-a", "b-b", "b-c", "b-d"]);

  const leftover = rows.slice(consumed);
  assert.deepEqual(leftover.map((r) => r.entityId), ["b-e", "b-a"]);
  assert.ok(
    leftover.some((r) => winners.some((w) => w.entityId === r.entityId)),
    "a later write to an already-sent entity must remain in the feed and be re-sent",
  );
}

// ── An exhausted feed reports itself finished ───────────────────────────────
{
  seq = 0;
  const { winners, consumed, stoppedAtLimit } = compactFeedRows([row("expense", "e-1", "insert")], 500);
  assert.equal(winners.length, 1);
  assert.equal(consumed, 1);
  assert.equal(stoppedAtLimit, false, "a feed shorter than the limit must not claim there is more");

  const empty = compactFeedRows([], 500);
  assert.deepEqual(empty.winners, []);
  assert.equal(empty.consumed, 0, "an empty page must leave the cursor exactly where it was");
  assert.equal(empty.stoppedAtLimit, false);
}

// ── The scan window is bounded ──────────────────────────────────────────────
{
  assert.ok(PULL_COMPACTION_SCAN_FACTOR > 1, "compaction is pointless if the page reads only `limit` rows");
  assert.ok(
    PULL_COMPACTION_MAX_SCAN >= 1000 && PULL_COMPACTION_MAX_SCAN <= 20_000,
    "one page must read enough of the feed to be worth a round trip, and never an unbounded amount of it",
  );
}

console.log("sync-feed-compaction.examples.js OK");
