import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  applyStockCount,
  cancelStockCount,
  createStockCount,
  submitStockCount,
  updateStockCountLines,
} from "../src/modules/inventory/stockCounts.service.js";

/**
 * Applying a stock count is the one screen that overwrites stock with a number a
 * human typed, and the correction is silent: no bill, no purchase, just the shelf
 * total moving. If it applies the wrong line to the wrong product, or applies a
 * count taken before this morning's sales, the shop's stock is now confidently
 * wrong and nothing in the app says so.
 *
 * Runs against the real database because every guard here is DB-resolved — the
 * staleness check is a ledger query, the single-apply claim is a conditional
 * UPDATE, and the correction has to land in the same transaction as its ledger
 * rows or a half-applied count is indistinguishable from a finished one.
 */

const suffix = `stock-count-apply-${Date.now()}`;
let shop;
let location;

/**
 * Ids are spelled out rather than left to cuid() so a test can decide the order
 * products are read back in — see the multi-line case, which depends on it.
 */
async function makeProduct(idPrefix, name, stockBaseQty) {
  return db.product.create({
    data: {
      id: `${idPrefix}-${suffix}`,
      shopId: shop.id,
      name,
      category: "staples",
      baseUnit: "g",
      rateUnit: "kg",
      displayUnit: "kg",
      stockBaseQty,
      defaultPricePerRateUnit: 50,
      costPerRateUnit: 40,
    },
  });
}

const stockOf = async (product) => (await db.product.findUnique({ where: { id: product.id } })).stockBaseQty;
const ledgerFor = (product) => db.stockLedger.findMany({ where: { shopId: shop.id, productId: product.id, action: "stock_count" } });
const rowsFrom = (session) => db.stockLedger.count({ where: { shopId: shop.id, sourceType: "stock_count", sourceId: session.id } });
const reload = (session) => db.stockCountSession.findUnique({ where: { id: session.id } });

/**
 * The whole pre-apply workflow: open a count over exactly these products, type in
 * what was on the shelf, and send it for review. Only listed products are counted
 * — an unfiltered count would sweep in every earlier test's product, each of which
 * already has ledger movements and would trip the staleness guard.
 */
async function countedSession(name, lines) {
  const session = await createStockCount(shop.id, location.id, {
    name,
    blindCount: false,
    productIds: lines.map((line) => line.product.id),
  }, { userId: "user-counter" });
  await updateStockCountLines(shop.id, location.id, session.id, {
    lines: lines.map(({ product, counted, reason }) => ({
      productId: product.id,
      countedBaseQty: counted,
      ...(reason ? { reason } : {}),
    })),
  }, { userId: "user-counter" });
  return submitStockCount(shop.id, location.id, session.id);
}

async function refuses(promise, code, statusCode, message) {
  try {
    await promise;
    assert.fail(`${message} — expected rejection with ${code}, but it resolved`);
  } catch (error) {
    assert.equal(error.code, code, `${message} (got: ${error.message})`);
    assert.equal(error.statusCode, statusCode, `${message} — a refused count is a conflict the screen can explain`);
  }
}

before(async () => {
  shop = await db.shop.create({ data: { name: `SC ${suffix}`, ownerName: "o", city: "c", address: "a" } });
  location = await db.storeLocation.create({
    data: { shopId: shop.id, code: "MAIN", name: "Main Counter", isPrimary: true },
  });
});

after(async () => {
  try {
    // Sessions first: their lines hold a Restrict reference to Product.
    await db.stockCountSession.deleteMany({ where: { shopId: shop.id } });
    await db.stockLedger.deleteMany({ where: { shopId: shop.id } });
    await db.product.deleteMany({ where: { shopId: shop.id } });
    await db.storeLocation.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
  } catch (cleanupError) {
    console.error("cleanup failed", cleanupError);
  }
  await db.$disconnect();
});

test("a multi-line count corrects each product to its own counted quantity", async () => {
  // Ids sort a-m-z but the rows are inserted z-a-m, and that mismatch is the point.
  // Apply reads its lines through the ([sessionId, productId]) unique index, so they
  // arrive in productId order, while a batched product prefetch arrives in row order.
  // Left to cuid()s both orders would be creation order and would happen to agree —
  // which would let a positional pairing (a zipped array, an index into the fetched
  // rows) pass while writing one product's shelf count onto another's stock. Forcing
  // the orders apart means only a lookup genuinely keyed by productId survives.
  const zeera = await makeProduct("p-zzz", "Zeera Whole", 1000);
  const atta = await makeProduct("p-aaa", "Atta 10kg", 500);
  const moong = await makeProduct("p-mmm", "Moong Dal", 250);

  const session = await countedSession("Monthly count", [
    { product: zeera, counted: 940, reason: "Spillage in the back room" },
    { product: atta, counted: 575 },
    { product: moong, counted: 250 },
  ]);

  // The fixture only tests anything while those two orders really do differ; if a
  // Prisma upgrade ever aligns them, this fails loudly instead of going quiet.
  const raw = await db.stockCountSession.findUnique({ where: { id: session.id }, include: { lines: true } });
  const lineOrder = raw.lines.map((line) => line.productId);
  const fetchOrder = (await db.product.findMany({ where: { shopId: shop.id, id: { in: lineOrder } } })).map((product) => product.id);
  assert.notDeepEqual(lineOrder, fetchOrder, "lines and prefetched products must arrive in different orders");

  const applied = await applyStockCount(shop.id, location.id, session.id, {
    userId: "user-owner",
    note: "Month-end sign-off",
  });

  assert.equal(applied.status, "applied");
  assert.equal(applied.approvedByUserId, "user-owner", "who accepted the correction is on the record");
  assert.ok(applied.appliedAt, "and when");
  // activeKey is the unique lock that allows one open count per branch. Left set,
  // the branch could never be counted again.
  assert.equal(applied.activeKey, null, "applying releases the branch for the next count");

  // Stock is now what was physically on the shelf — each product its own number.
  assert.equal(await stockOf(zeera), 940, "shrinkage is written down");
  assert.equal(await stockOf(atta), 575, "found stock is written up");
  assert.equal(await stockOf(moong), 250, "an accurate shelf is left alone");

  // ── the ledger explains every rupee of the movement ──────────────
  const [zeeraRow] = await ledgerFor(zeera);
  assert.equal(zeeraRow.changeBaseQty, -60);
  assert.equal(zeeraRow.oldStockBaseQty, 1000);
  assert.equal(zeeraRow.newStockBaseQty, 940);
  assert.equal(zeeraRow.productName, "Zeera Whole", "the row names the product it actually moved");
  assert.equal(zeeraRow.locationId, location.id, "at the branch that was counted");
  assert.equal(zeeraRow.sourceType, "stock_count");
  assert.equal(zeeraRow.sourceId, session.id, "so the correction can be traced back to the count that made it");
  assert.equal(zeeraRow.note, "Spillage in the back room", "the counter's reason survives to the ledger");

  const [attaRow] = await ledgerFor(atta);
  assert.equal(attaRow.changeBaseQty, 75);
  assert.equal(attaRow.oldStockBaseQty, 500);
  assert.equal(attaRow.newStockBaseQty, 575);
  assert.equal(attaRow.productName, "Atta 10kg");
  assert.equal(attaRow.note, "Month-end sign-off", "with no line reason, the approver's note explains it");

  // A product that counted correctly moved nothing, so it gets no ledger row —
  // otherwise every count would bury the real corrections under no-op noise.
  assert.deepEqual(await ledgerFor(moong), []);
  assert.equal(await rowsFrom(session), 2, "exactly one row per product that actually moved");

  // What the review screen totals up before the owner accepts it.
  assert.equal(applied.summary.varianceLines, 2);
  assert.equal(applied.summary.netVarianceBaseQty, 15, "-60 + 75 + 0");
});

test("a count still being counted cannot be applied", async () => {
  const rice = await makeProduct("p-rice", "Sona Masoori", 800);
  const session = await createStockCount(shop.id, location.id, {
    name: "Half-done count",
    blindCount: false,
    productIds: [rice.id],
  }, { userId: "user-counter" });

  // Nothing has been counted yet, so every line's countedBaseQty is still null.
  // Applying that would set the shelf to nothing at all — the review step is what
  // stands between a half-finished count and the shop's stock.
  await refuses(
    applyStockCount(shop.id, location.id, session.id, { userId: "user-owner" }),
    "STOCK_COUNT_NOT_REVIEWED",
    409,
    "an unsubmitted count",
  );
  assert.equal(await stockOf(rice), 800, "stock is untouched by the refusal");
  assert.equal(await rowsFrom(session), 0);

  await cancelStockCount(shop.id, location.id, session.id, { userId: "user-owner" });
});

test("a count overtaken by real stock movement is refused, not applied", async () => {
  const sugar = await makeProduct("p-sugar", "Sugar", 2000);
  // The counter walks the shelf and writes down 2000 g.
  const session = await countedSession("Morning count", [{ product: sugar, counted: 2000 }]);

  // While the count sits in review, 100 g is sold at the counter.
  const fresh = await reload(session);
  await db.stockLedger.create({
    data: {
      shopId: shop.id,
      locationId: location.id,
      productId: sugar.id,
      productName: sugar.name,
      action: "sale",
      changeBaseQty: -100,
      oldStockBaseQty: 2000,
      newStockBaseQty: 1900,
      // Explicitly after the count opened; the guard is a strict `>` comparison and
      // a same-millisecond row would make this test pass for the wrong reason.
      createdAt: new Date(fresh.createdAt.getTime() + 60_000),
    },
  });
  await db.product.update({ where: { id: sugar.id }, data: { stockBaseQty: 1900 } });

  // Applying now would set the shelf back to 2000 and quietly un-sell that packet.
  await refuses(
    applyStockCount(shop.id, location.id, session.id, { userId: "user-owner" }),
    "STOCK_COUNT_STALE",
    409,
    "a count taken before a sale",
  );
  assert.equal(await stockOf(sugar), 1900, "the real sale stands");
  assert.equal(await rowsFrom(session), 0);

  // Refused, not destroyed: the owner can still see it and clear it deliberately.
  assert.equal((await reload(session)).status, "review");
  await cancelStockCount(shop.id, location.id, session.id, { userId: "user-owner" });
  assert.equal((await reload(session)).activeKey, null, "cancelling frees the branch too");
});

test("a product deleted mid-count rolls the whole apply back", async () => {
  const tea = await makeProduct("p-aaa-tea", "Tea Dust", 600);
  // Apply walks its lines in productId order, so the higher id puts the doomed
  // product second — the failure lands only after the first product has already
  // been corrected inside the transaction, which is what makes this a rollback
  // test rather than a test that the guard exits early.
  const flour = await makeProduct("p-bbb-flour", "Wheat Flour", 900);
  const session = await countedSession("Interrupted count", [
    { product: tea, counted: 550 },
    { product: flour, counted: 880 },
  ]);

  await db.product.update({ where: { id: flour.id }, data: { deletedAt: new Date() } });

  await refuses(
    applyStockCount(shop.id, location.id, session.id, { userId: "user-owner" }),
    "STOCK_COUNT_PRODUCT_UNAVAILABLE",
    409,
    "a count naming a deleted product",
  );

  // The part that had already succeeded must come back with it. A partly applied
  // count is the worst outcome available: some shelves corrected, some not, and a
  // session status that admits to neither.
  assert.equal(await stockOf(tea), 600, "the earlier line's correction is rolled back");
  assert.equal(await rowsFrom(session), 0, "and so are its ledger rows");
  assert.equal((await reload(session)).status, "review", "the status claim rolls back too — it is not stuck as applied");

  await cancelStockCount(shop.id, location.id, session.id, { userId: "user-owner" });
});

test("a count applies exactly once, however many times it is tapped", async () => {
  const poha = await makeProduct("p-poha", "Poha", 400);
  const session = await countedSession("Poha count", [{ product: poha, counted: 360 }]);

  // No approver note and no line reason: the ledger still has to say where the
  // correction came from, or it reads as an unexplained stock edit.
  await applyStockCount(shop.id, location.id, session.id, { userId: "user-owner" });
  const [row] = await ledgerFor(poha);
  assert.equal(row.note, `Applied stock count ${session.name}`);

  // A double tap on a slow connection must not write the correction twice.
  await refuses(
    applyStockCount(shop.id, location.id, session.id, { userId: "user-owner" }),
    "STOCK_COUNT_NOT_REVIEWED",
    409,
    "a second apply of the same count",
  );
  assert.equal(await stockOf(poha), 360, "the shelf did not move a second time");
  assert.equal(await rowsFrom(session), 1, "and there is still one ledger row");

  // Same protection from the other direction: a finished count cannot be cancelled
  // back into existence. (This is the reachable path to the ALREADY_PROCESSED code.
  // Apply's own `claimed.count !== 1` branch is the backstop for two applies landing
  // in the same instant — sequentially the status check above always fires first,
  // and SQLite pins the pool to one connection, so it cannot be raced here.)
  await refuses(
    cancelStockCount(shop.id, location.id, session.id, { userId: "user-owner" }),
    "STOCK_COUNT_ALREADY_PROCESSED",
    409,
    "cancelling an applied count",
  );
  assert.equal((await reload(session)).status, "applied");
});
