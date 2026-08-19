import assert from "node:assert/strict";
import db from "../src/db.js";
import { findOverlap, intervalEnd, intervalsOverlap } from "../src/verticals/restaurant/service-ops/intervals.js";
import {
  createReservation,
  listReservations,
  setReservationStatus,
  updateReservation,
} from "../src/verticals/restaurant/service-ops/reservations.service.js";
import { createShift, getRoster, updateShift } from "../src/verticals/restaurant/service-ops/shifts.service.js";
import { createTerminal, resolveTerminal, updateTerminal } from "../src/verticals/restaurant/service-ops/kiosk.service.js";

// Two rules carry this whole feature: one table cannot be promised to two parties
// at once, and one person cannot be rostered in two places at once. Neither is
// expressible as a unique index, so both are tested hard.

// ── pure interval maths ─────────────────────────────────────────────
assert.equal(intervalEnd("2026-09-01T19:00:00.000Z", 90).toISOString(), "2026-09-01T20:30:00.000Z");
assert.equal(intervalsOverlap("2026-09-01T19:00:00Z", "2026-09-01T20:30:00Z", "2026-09-01T20:00:00Z", "2026-09-01T21:00:00Z"), true);
// Half-open: a sitting that ends at 20:30 and one that starts at 20:30 do not
// collide. Treating that as a clash would refuse the back-to-back seatings a busy
// restaurant lives on.
assert.equal(intervalsOverlap("2026-09-01T19:00:00Z", "2026-09-01T20:30:00Z", "2026-09-01T20:30:00Z", "2026-09-01T22:00:00Z"), false);
assert.equal(
  findOverlap({ startsAt: "2026-09-01T19:00:00Z", durationMinutes: 60, excludeId: "self" },
    [{ id: "self", startsAt: "2026-09-01T19:00:00Z", durationMinutes: 60 }]),
  null,
  "a row must not be found to conflict with itself when it is being edited",
);

async function expectFailure(promise, code, message) {
  const result = await promise.then(() => null, (error) => error);
  assert.ok(result, `${message} — expected a rejection`);
  assert.equal(result.code, code, `${message} — got ${result.code}: ${result.message}`);
}

const AT_1900 = "2026-09-01T19:00:00.000Z";
const AT_2000 = "2026-09-01T20:00:00.000Z";
const AT_2030 = "2026-09-01T20:30:00.000Z";

async function main() {
  const shop = await db.shop.create({ data: { name: `Resto ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const t1 = await db.restaurantTable.create({ data: { shopId: shop.id, code: "t1", name: "T1", seats: 4 } });
    const t2 = await db.restaurantTable.create({ data: { shopId: shop.id, code: "t2", name: "T2", seats: 2 } });
    const cook = await db.user.create({ data: { shopId: shop.id, name: "Cook", mobile: `91${Date.now()}`.slice(0, 10), passwordHash: "x", role: "staff" } });
    const waiter = await db.user.create({ data: { shopId: shop.id, name: "Waiter", mobile: `92${Date.now()}`.slice(0, 10), passwordHash: "x", role: "staff" } });

    // ── reservations: the table cannot be double-promised ─────────────
    const sharma = await createReservation(shop.id, { guestName: "Sharma", partySize: 4, reservedFor: AT_1900, durationMinutes: 90, tableId: t1.id, source: "phone" });
    assert.equal(sharma.status, "booked");
    assert.equal(new Date(sharma.endsAt).toISOString(), AT_2030);

    await expectFailure(
      createReservation(shop.id, { guestName: "Iyer", partySize: 2, reservedFor: AT_2000, durationMinutes: 60, tableId: t1.id, source: "phone" }),
      "RESERVATION_TABLE_CONFLICT",
      "an overlapping sitting on the same table must be refused",
    );

    // Back-to-back is the normal case and must be allowed.
    const backToBack = await createReservation(shop.id, { guestName: "Iyer", partySize: 2, reservedFor: AT_2030, durationMinutes: 60, tableId: t1.id, source: "phone" });
    assert.equal(backToBack.status, "booked");

    // A different table at the same hour is not a conflict.
    await createReservation(shop.id, { guestName: "Rao", partySize: 2, reservedFor: AT_1900, durationMinutes: 90, tableId: t2.id, source: "walk_in" });

    // A booking with no table yet holds nothing, so it cannot clash with anything.
    const unassigned = await createReservation(shop.id, { guestName: "Khan", partySize: 6, reservedFor: AT_1900, durationMinutes: 90, source: "phone" });
    assert.equal(unassigned.tableId, null);

    await expectFailure(
      createReservation(shop.id, { guestName: "Big party", partySize: 12, reservedFor: "2026-09-02T19:00:00.000Z", tableId: t2.id, source: "phone" }),
      "RESERVATION_PARTY_TOO_LARGE",
      "a party of twelve onto a two-top is a typo, not a tight fit",
    );

    // Editing is the other way a double-booking gets made, so it re-checks.
    await expectFailure(
      updateReservation(shop.id, backToBack.id, { reservedFor: AT_2000 }),
      "RESERVATION_TABLE_CONFLICT",
      "moving a booking onto an occupied slot must be refused",
    );

    // ── cancelling frees the slot immediately ─────────────────────────
    await setReservationStatus(shop.id, sharma.id, "cancelled");
    const afterCancel = await createReservation(shop.id, { guestName: "Late walk-in", partySize: 2, reservedFor: AT_1900, durationMinutes: 90, tableId: t1.id, source: "walk_in" });
    assert.equal(afterCancel.status, "booked", "a cancelled booking must stop holding the table");

    // ── status flow ───────────────────────────────────────────────────
    const seated = await setReservationStatus(shop.id, afterCancel.id, "seated");
    assert.ok(seated.seatedAt, "seating stamps the time");
    const completed = await setReservationStatus(shop.id, afterCancel.id, "completed");
    assert.ok(completed.closedAt);
    await expectFailure(
      setReservationStatus(shop.id, afterCancel.id, "seated"),
      "RESERVATION_TRANSITION_INVALID",
      "a completed sitting must not be walked back into holding a table",
    );
    await expectFailure(
      updateReservation(shop.id, afterCancel.id, { partySize: 3 }),
      "RESERVATION_CLOSED",
      "a closed reservation cannot be edited",
    );

    const listed = await listReservations(shop.id, { from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" });
    assert.ok(listed.length >= 4);
    assert.ok(listed.every((row) => row.endsAt), "every row carries its computed end time");

    // ── shifts: one person, one place ─────────────────────────────────
    const morning = await createShift(shop.id, { userId: cook.id, startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T17:00:00.000Z", position: "kitchen" });
    assert.equal(morning.status, "scheduled");

    await expectFailure(
      createShift(shop.id, { userId: cook.id, startsAt: "2026-09-01T16:00:00.000Z", endsAt: "2026-09-01T22:00:00.000Z" }),
      "SHIFT_OVERLAP",
      "one person cannot be rostered in two places at once",
    );
    // Same hours, different person, is the entire point of a roster.
    await createShift(shop.id, { userId: waiter.id, startsAt: "2026-09-01T16:00:00.000Z", endsAt: "2026-09-01T22:00:00.000Z", position: "floor" });
    // Back-to-back for the same person is fine.
    const evening = await createShift(shop.id, { userId: cook.id, startsAt: "2026-09-01T17:00:00.000Z", endsAt: "2026-09-01T23:00:00.000Z" });

    await expectFailure(
      createShift(shop.id, { userId: cook.id, startsAt: "2026-09-03T10:00:00.000Z", endsAt: "2026-09-03T09:00:00.000Z" }),
      "SHIFT_TIME_INVALID",
      "a shift must end after it starts",
    );
    await expectFailure(
      createShift(shop.id, { userId: cook.id, startsAt: "2026-09-04T10:00:00.000Z", endsAt: "2026-09-06T10:00:00.000Z" }),
      "SHIFT_TOO_LONG",
      "a multi-day shift is a date typo and would block the whole period",
    );
    // Tenant isolation: another shop's staff can never be rostered here.
    const otherShop = await db.shop.create({ data: { name: `Other ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
    const outsider = await db.user.create({ data: { shopId: otherShop.id, name: "Outsider", mobile: `93${Date.now()}`.slice(0, 10), passwordHash: "x", role: "staff" } });
    await expectFailure(
      createShift(shop.id, { userId: outsider.id, startsAt: "2026-09-05T10:00:00.000Z", endsAt: "2026-09-05T18:00:00.000Z" }),
      "STAFF_NOT_FOUND",
      "one shop must never roster another shop's staff",
    );
    await db.user.deleteMany({ where: { shopId: otherShop.id } });
    await db.shop.delete({ where: { id: otherShop.id } });

    // Cancelling frees the person, exactly as cancelling frees the table.
    await updateShift(shop.id, evening.id, { status: "cancelled" });
    await createShift(shop.id, { userId: cook.id, startsAt: "2026-09-01T18:00:00.000Z", endsAt: "2026-09-01T21:00:00.000Z" });

    const roster = await getRoster(shop.id, { from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" });
    assert.equal(roster.basis, "scheduled", "the roster must not claim to be hours worked");
    const cookRow = roster.staff.find((row) => row.userId === cook.id);
    // 8h morning + 3h evening; the cancelled 6h shift is excluded.
    assert.equal(cookRow.totalMinutes, 660, "cancelled shifts must not count toward scheduled hours");

    // ── kiosk terminals ───────────────────────────────────────────────
    const terminal = await createTerminal(shop.id, { code: "Door-1", name: "Entrance screen" });
    assert.equal(terminal.code, "door-1", "terminal codes are normalised");
    await expectFailure(createTerminal(shop.id, { code: "DOOR-1" }), "KIOSK_CODE_TAKEN", "two screens cannot share a code");

    const resolved = await resolveTerminal(shop.id, "door-1");
    assert.equal(resolved.terminal.name, "Entrance screen");
    assert.equal(resolved.menuPath, `/api/public/shops/${shop.id}/catalog`, "the kiosk eats from the same menu as the table QR");
    assert.equal(resolved.orderPath, `/api/public/shops/${shop.id}/orders`);
    assert.equal(resolved.shop.name, shop.name);
    const beat = await db.kioskTerminal.findUnique({ where: { id: terminal.id } });
    assert.ok(beat.lastSeenAt, "resolving records the heartbeat so a dead screen is visible");

    // Retiring a screen must stop it serving immediately.
    await updateTerminal(shop.id, terminal.id, { active: false });
    await expectFailure(resolveTerminal(shop.id, "door-1"), "KIOSK_TERMINAL_NOT_FOUND", "a retired terminal must stop serving");
    await expectFailure(resolveTerminal(shop.id, "never-existed"), "KIOSK_TERMINAL_NOT_FOUND", "a guessed code reveals nothing");

    // ── audit trail ───────────────────────────────────────────────────
    const seen = new Set((await db.auditLog.findMany({ where: { shopId: shop.id }, select: { action: true } })).map((row) => row.action));
    for (const action of ["RESERVATION_CREATED", "RESERVATION_STATUS_CHANGED", "STAFF_SHIFT_CREATED", "KIOSK_TERMINAL_CREATED"]) {
      assert.ok(seen.has(action), `${action} must be audited`);
    }

    console.log("Restaurant service ops examples passed");
  } finally {
    await db.auditLog.deleteMany({ where: { shopId: shop.id } });
    await db.tableReservation.deleteMany({ where: { shopId: shop.id } });
    await db.staffShift.deleteMany({ where: { shopId: shop.id } });
    await db.kioskTerminal.deleteMany({ where: { shopId: shop.id } });
    await db.restaurantTable.deleteMany({ where: { shopId: shop.id } });
    await db.user.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
    await db.$disconnect();
  }
}

await main();
