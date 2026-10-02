import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

/**
 * Paying shops get back the time the free window gave away.
 *
 * A shop already paying when the promotion began kept paying while everyone else
 * used the product for nothing, and its period ran down all the same. The credit
 * lands AFTER the window shuts, which is the whole point: days handed back inside
 * it would be days the shop already has for free, and worth nothing.
 *
 * The rest of the suite pins the window shut (buildTestEnv sets FREE_ACCESS_UNTIL
 * to 2020) so plan enforcement can be tested. A credit needs a window with two
 * ends, so this file sets both before loading anything that reads the environment
 * — hence the dynamic imports — and hands the same pair to the script it spawns.
 */
const FREE_FROM = "2026-09-21T00:00:00+05:30";
const FREE_UNTIL = "2027-01-01T00:00:00+05:30";
process.env.FREE_ACCESS_FROM = FREE_FROM;
process.env.FREE_ACCESS_UNTIL = FREE_UNTIL;

const db = (await import("../src/db.js")).default;
const { FREE_ACCESS_FROM, FREE_ACCESS_UNTIL, freeWindowCredit, isFreeWindowCreditEligible } =
  await import("../src/modules/subscription/freeAccess.js");
const { FREE_WINDOW_CREDIT_ACTION } = await import("../src/modules/subscription/freeWindowCredit.service.js");

const DAY = 24 * 60 * 60 * 1000;
const paid = (monthly = 9900) => ({ provider: "razorpay", lockedPriceMonthlyPaise: monthly, lockedPriceYearlyPaise: null });

/* ------------------------------------------------ what a shop is owed, and why */

assert.equal(FREE_ACCESS_FROM.toISOString(), new Date(FREE_FROM).toISOString(), "the window's start is read from the environment");

// Paid straight through the window: owed all of it, and it lands past its own end.
const throughout = freeWindowCredit({
  currentPeriodStart: new Date(FREE_ACCESS_FROM.getTime() - 30 * DAY),
  currentPeriodEnd: new Date(FREE_ACCESS_UNTIL.getTime() + 150 * DAY),
});
const windowDays = Math.ceil((FREE_ACCESS_UNTIL.getTime() - FREE_ACCESS_FROM.getTime()) / DAY);
assert.equal(throughout.days, windowDays, "a shop paying across the whole window is owed the whole window");
assert.equal(
  throughout.periodEnd.getTime(),
  FREE_ACCESS_UNTIL.getTime() + 150 * DAY + windowDays * DAY,
  "and its own later end simply moves out by that much",
);

// Its month ran out mid-window: owed only the overlap, as paid time from January.
const ranOutInside = freeWindowCredit({
  currentPeriodStart: new Date(FREE_ACCESS_FROM.getTime() + 5 * DAY),
  currentPeriodEnd: new Date(FREE_ACCESS_FROM.getTime() + 25 * DAY),
});
assert.equal(ranOutInside.days, 20, "only the days inside the window are owed");
assert.equal(
  ranOutInside.periodEnd.getTime(),
  FREE_ACCESS_UNTIL.getTime() + 20 * DAY,
  "and they are added after the window shuts — inside it they would be days it already has",
);

// Nothing owed where nothing was given away.
assert.equal(freeWindowCredit({
  currentPeriodStart: new Date(FREE_ACCESS_FROM.getTime() - 60 * DAY),
  currentPeriodEnd: new Date(FREE_ACCESS_FROM.getTime() - 1),
}), null, "a period that ended before the window lost nothing to it");
assert.equal(freeWindowCredit({
  currentPeriodStart: FREE_ACCESS_UNTIL,
  currentPeriodEnd: new Date(FREE_ACCESS_UNTIL.getTime() + 365 * DAY),
}), null, "a plan bought in the presale month already starts when the window shuts");
assert.equal(freeWindowCredit({ currentPeriodStart: null, currentPeriodEnd: null }), null, "an undated row is owed nothing");

// Who counts as having paid.
assert.equal(isFreeWindowCreditEligible({ ...paid() }), true, "a shop that paid");
assert.equal(isFreeWindowCreditEligible({ ...paid(), provider: "founding" }), false, "a founding grant paid nothing for this period");
assert.equal(
  isFreeWindowCreditEligible({ provider: "razorpay", lockedPriceMonthlyPaise: null, lockedPriceYearlyPaise: null }),
  false,
  "a row that never went through an activation",
);

/* ------------------------------------------------------- and now against the DB */

const shopData = (name, settings = { businessProfile: { businessType: "kirana" } }) => ({
  name: `${name} ${Date.now()}`, ownerName: "O", city: "C", address: "A",
  settingsJson: JSON.stringify(settings),
});

const payer = await db.shop.create({ data: shopData("Credit payer") });
await db.subscription.create({ data: {
  shopId: payer.id, planCode: "growth", status: "active", ...paid(29900),
  currentPeriodStart: new Date(FREE_ACCESS_FROM.getTime() - 10 * DAY),
  currentPeriodEnd: new Date(FREE_ACCESS_UNTIL.getTime() + 60 * DAY),
  graceEndsAt: new Date(FREE_ACCESS_UNTIL.getTime() + 63 * DAY),
} });

// A shop whose paid month ran out inside the window, and which therefore reads as
// lapsed today: the credit gives it paid time again, so it stops reading as lapsed.
const lapsed = await db.shop.create({ data: shopData("Credit lapsed") });
await db.subscription.create({ data: {
  shopId: lapsed.id, planCode: "starter", status: "grace", ...paid(),
  currentPeriodStart: new Date(FREE_ACCESS_FROM.getTime() + 2 * DAY),
  currentPeriodEnd: new Date(FREE_ACCESS_FROM.getTime() + 32 * DAY),
} });

const founding = await db.shop.create({ data: shopData("Credit founding") });
await db.subscription.create({ data: {
  shopId: founding.id, planCode: "pro", status: "trial", provider: "founding",
  lockedPriceMonthlyPaise: 99900, lockedPriceYearlyPaise: 899900,
  currentPeriodStart: new Date(FREE_ACCESS_FROM.getTime() - 5 * DAY),
  currentPeriodEnd: new Date(FREE_ACCESS_UNTIL.getTime() + 5 * DAY),
} });

const read = (shopId) => db.subscription.findFirstOrThrow({ where: { shopId } });
const receipts = (shopId) => db.auditLog.count({ where: { shopId, action: FREE_WINDOW_CREDIT_ACTION } });
const run = (...args) => spawnSync(process.execPath, ["scripts/credit-free-window-overlap.js", ...args], {
  cwd: process.cwd(),
  env: { ...process.env, FREE_ACCESS_FROM: FREE_FROM, FREE_ACCESS_UNTIL: FREE_UNTIL },
  encoding: "utf8",
});

const before = { payer: await read(payer.id), lapsed: await read(lapsed.id), founding: await read(founding.id) };

/* --check reports and writes nothing */

const check = run("--check");
assert.equal(check.status, 0, `--check must succeed: ${check.stderr}`);
assert.match(check.stdout, /Reporting only; nothing was written/);
assert.match(check.stdout, new RegExp(payer.id), "the report must name the shop it would credit");
assert.equal((await read(payer.id)).currentPeriodEnd.getTime(), before.payer.currentPeriodEnd.getTime(), "--check must not move a period");
assert.equal(await receipts(payer.id), 0, "and must not write a receipt");

/* the real run credits, and says so in the audit trail */

const applied = run();
assert.equal(applied.status, 0, `apply must succeed: ${applied.stderr}`);

const payerAfter = await read(payer.id);
const owedPayer = freeWindowCredit(before.payer);
assert.equal(payerAfter.currentPeriodEnd.getTime(), owedPayer.periodEnd.getTime(), "the payer's period ends later by what it was owed");
assert.ok(payerAfter.graceEndsAt > before.payer.graceEndsAt, "and its grace moves with it, never backwards");
assert.equal(payerAfter.status, "active", "an active payer stays active");
assert.equal(await receipts(payer.id), 1, "one receipt per credit");

const lapsedAfter = await read(lapsed.id);
assert.equal(lapsedAfter.currentPeriodEnd.getTime(), freeWindowCredit(before.lapsed).periodEnd.getTime(), "the lapsed shop is owed its overlap");
assert.ok(lapsedAfter.currentPeriodEnd > FREE_ACCESS_UNTIL, "as paid time that outlives the window");
assert.equal(lapsedAfter.status, "active", "and a shop lapsed only by the clock is reopened, or the credit would be unreachable");

const foundingAfter = await read(founding.id);
assert.equal(foundingAfter.currentPeriodEnd.getTime(), before.founding.currentPeriodEnd.getTime(), "a founding grant is not credited");
assert.equal(await receipts(founding.id), 0, "and gets no receipt");

/* running it again credits nobody twice */

const second = run();
assert.equal(second.status, 0, `a second run must succeed: ${second.stderr}`);
assert.match(second.stdout, /0 shops credited/, "the second run finds nothing left to credit");
assert.equal((await read(payer.id)).currentPeriodEnd.getTime(), payerAfter.currentPeriodEnd.getTime(), "and moves no period again");
assert.equal(await receipts(payer.id), 1, "still one receipt");

/* one shop at a time, for a support request */

const single = run("--shop", founding.id, "--check");
assert.equal(single.status, 0, `--shop must succeed: ${single.stderr}`);
assert.doesNotMatch(single.stdout, new RegExp(payer.id), "--shop must look at that shop alone");

const badFlag = run("--shop");
assert.notEqual(badFlag.status, 0, "--shop without an id must refuse rather than credit everyone");

console.log("Free window credit examples passed");
