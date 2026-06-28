import 'dotenv/config';
import assert from 'node:assert/strict';

// ── Engine availability check ────────────────────────────────────────────────
// This test file requires a working Prisma query engine (native binary for the
// current OS). When running on a machine that has only a Windows-generated
// Prisma client (e.g. this repo was cloned on Linux but `prisma generate` was
// never run), we detect the missing engine early and skip rather than crash.
//
// To make these tests runnable, do ONE of:
//   1. Run `npm run prisma:generate` (downloads Linux engine binary).
//   2. Run `npm run setup:test-db` (sets up test SQLite DB and generates client).
//   3. Set DATABASE_URL to a reachable test database.
//
// CI/CD: these tests run as part of `npm run test:db` (not `npm test`) so they
// do not block the static test suite. Add `npm run test:db` to your pipeline
// AFTER running `npm run prisma:generate` and `npm run db:push`.

let db, confirmBill, cancelBill, getBill, getProduct, getPnL, pushOfflineActions;

try {
  const dbModule = await import('../src/db.js');
  db = dbModule.default;

  // Probe: attempt a no-op query to confirm the query engine binary is present.
  // This throws `PrismaClientInitializationError` when the engine is missing.
  await db.$queryRaw`SELECT 1`;

  const billsMod    = await import('../src/modules/bills/bills.service.js');
  const productsMod = await import('../src/modules/products/products.service.js');
  const reportsMod  = await import('../src/modules/reports/reports.service.js');
  const syncMod     = await import('../src/modules/sync/sync.service.js');

  confirmBill       = billsMod.confirmBill;
  cancelBill        = billsMod.cancelBill;
  getBill           = billsMod.getBill;
  getProduct        = productsMod.getProduct;
  getPnL            = reportsMod.getPnL;
  pushOfflineActions = syncMod.pushOfflineActions;
} catch (initError) {
  const isPrismaEngineError =
    initError?.name === 'PrismaClientInitializationError' ||
    (initError?.message ?? '').includes('Query Engine') ||
    (initError?.message ?? '').includes('binary') ||
    (initError?.message ?? '').includes('debian-openssl') ||
    (initError?.message ?? '').includes("Named export 'PrismaClient' not found") ||
    (initError?.message ?? '').includes('@prisma/client did not initialize yet');

  if (isPrismaEngineError) {
    console.warn(
      '[SKIP] backend-regression.examples.js — Prisma query engine not available for this platform.\n' +
      '       Run `npm run prisma:generate` then `npm run db:push` to enable DB-backed tests.\n' +
      '       This is expected when the Prisma client was generated on a different OS.'
    );
    process.exit(0); // skip gracefully — not a test failure
  }

  // Any other error (e.g. DB connection refused) is a real failure
  console.error('[ERROR] backend-regression.examples.js — unexpected init error:', initError?.message ?? initError);
  process.exit(1);
}

const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const shopIds = [];

async function createShop(name) {
  const shop = await db.shop.create({
    data: {
      name: `KiranaOS test ${name} ${suffix}`,
      ownerName: 'Automated Test Owner',
      city: 'Jodhpur',
      address: 'Temporary automated test shop',
      phone: `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
    },
  });
  shopIds.push(shop.id);
  return shop;
}

async function cleanupTestData(ids) {
  if (!ids.length) return;

  const bills = await db.bill.findMany({
    where: { shopId: { in: ids } },
    select: { id: true },
  });
  const billIds = bills.map((b) => b.id);

  await db.$transaction(async (tx) => {
    await tx.offlineSyncEvent.deleteMany({ where: { shopId: { in: ids } } });
    await tx.aiActionLog.deleteMany({ where: { shopId: { in: ids } } });
    await tx.auditLog.deleteMany({ where: { shopId: { in: ids } } });
    // FinancialLedger is written by every bill (postBillCreatedLedger) and references the
    // shop, so it must be cleared before the shop row or the final delete fails its FK.
    await tx.financialLedger.deleteMany({ where: { shopId: { in: ids } } });
    if (billIds.length) {
      await tx.payment.deleteMany({ where: { billId: { in: billIds } } });
      await tx.billItem.deleteMany({ where: { billId: { in: billIds } } });
    }
    await tx.stockLedger.deleteMany({ where: { shopId: { in: ids } } });
    await tx.udharLedger.deleteMany({ where: { shopId: { in: ids } } });
    await tx.purchaseHistory.deleteMany({ where: { shopId: { in: ids } } });
    await tx.bill.deleteMany({ where: { shopId: { in: ids } } });
    await tx.customer.deleteMany({ where: { shopId: { in: ids } } });
    await tx.product.deleteMany({ where: { shopId: { in: ids } } });
    await tx.supplier.deleteMany({ where: { shopId: { in: ids } } });
    await tx.session.deleteMany({ where: { shopId: { in: ids } } });
    await tx.user.deleteMany({ where: { shopId: { in: ids } } });
    await tx.billCounter.deleteMany({ where: { shopId: { in: ids } } });
    await tx.shop.deleteMany({ where: { id: { in: ids } } });
  });
}

async function expectAppError(promise, expectedStatus, messageIncludes) {
  await assert.rejects(
    promise,
    (error) => {
      assert.equal(error.statusCode, expectedStatus);
      assert.match(error.message, messageIncludes);
      return true;
    }
  );
}

function mobile(seed) {
  const digits = String(Math.abs(hashCode(`${suffix}-${seed}`))).padStart(9, '0').slice(0, 9);
  return `9${digits}`;
}

function hashCode(value) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000_000;
  return hash;
}

try {
  const shopA = await createShop('A');
  const shopB = await createShop('B');

  const sugar = await db.product.create({
    data: {
      shopId: shopA.id,
      name: `Sugar ${suffix}`,
      category: 'grocery',
      displayUnit: 'kg',
      baseUnit: 'g',
      rateUnit: 'kg',
      stockBaseQty: 2000,
      costPerRateUnit: 40,
      defaultPricePerRateUnit: 46,
      gstRate: 0,
    },
  });

  const cashBill = await confirmBill(shopA.id, {
    billType: 'normal_sale',
    customerName: 'Walk-in',
    items: [
      {
        productId: sugar.id,
        name: sugar.name,
        quantity: 500,
        enteredUnit: 'g',
        ratePerRateUnit: 46,
        gstRate: 0,
      },
    ],
    discount: 0,
    payments: [{ mode: 'cash', amount: 23 }],
    actualAmount: 23,
    buyerPaidAmount: 23,
    waivedAmount: 0,
  });

  assert.equal(cashBill.grandTotal, 23, '500g sugar at ₹46/kg should bill ₹23');
  assert.equal(cashBill.items[0].quantityInBaseUnit, 500, 'bill item should store 500g as base quantity');
  assert.equal(cashBill.items[0].lineTotal, 23, 'lineTotal should use converted rate quantity');
  assert.equal(cashBill.items[0].lineCost, 20, 'lineCost should use converted rate quantity');
  assert.equal(cashBill.items[0].lineProfit, 3, 'lineProfit should be lineTotal - lineCost');
  assert.equal(cashBill.grossProfit, 3, 'cash bill grossProfit should equal item profit without discount/waived');
  assert.match(cashBill.billNo, /^KOS-\d{4}-000001$/, 'first real sale should use the KOS bill sequence');

  const sugarAfterCashBill = await db.product.findUnique({ where: { id: sugar.id } });
  assert.equal(sugarAfterCashBill.stockBaseQty, 1500, 'normal sale must deduct stock');

  const saleLedger = await db.stockLedger.findFirst({
    where: { shopId: shopA.id, billId: cashBill.id, action: 'sale' },
  });
  assert.ok(saleLedger, 'normal sale must create sale stock ledger entry');
  assert.equal(saleLedger.changeBaseQty, -500, 'sale ledger should record stock out');

  const estimateBill = await confirmBill(shopA.id, {
    billType: 'estimate',
    customerName: 'Estimate customer',
    items: [
      {
        productId: sugar.id,
        name: sugar.name,
        quantity: 250,
        enteredUnit: 'g',
        ratePerRateUnit: 46,
        gstRate: 0,
      },
    ],
    discount: 0,
    payments: [],
  });

  assert.equal(estimateBill.grandTotal, 11.5, 'estimate still stores calculated bill total');
  assert.equal(estimateBill.grossProfit, 0, 'estimate must not affect P&L profit');
  assert.equal(estimateBill.paidAmount, 0, 'estimate must not create paid amount');
  assert.equal(estimateBill.creditAmount, 0, 'estimate must not create udhar amount');
  assert.match(estimateBill.billNo, /^EST-\d{4}-000001$/, 'estimate should use its own EST sequence');

  const sugarAfterEstimate = await db.product.findUnique({ where: { id: sugar.id } });
  assert.equal(sugarAfterEstimate.stockBaseQty, 1500, 'estimate must not deduct stock');

  const estimateLedgerCount = await db.stockLedger.count({
    where: { shopId: shopA.id, billId: estimateBill.id },
  });
  assert.equal(estimateLedgerCount, 0, 'estimate must not create stock ledger entry');

  const rice = await db.product.create({
    data: {
      shopId: shopA.id,
      name: `Rice ${suffix}`,
      category: 'grocery',
      displayUnit: 'piece',
      baseUnit: 'piece',
      rateUnit: 'piece',
      stockBaseQty: 10,
      costPerRateUnit: 60,
      defaultPricePerRateUnit: 100,
      gstRate: 0,
    },
  });

  const waivedBill = await confirmBill(shopA.id, {
    billType: 'normal_sale',
    customerName: 'Walk-in',
    items: [
      {
        productId: rice.id,
        name: rice.name,
        quantity: 1,
        enteredUnit: 'piece',
        ratePerRateUnit: 100,
        gstRate: 0,
      },
    ],
    discount: 5,
    payments: [{ mode: 'cash', amount: 90 }],
    actualAmount: 95,
    buyerPaidAmount: 90,
    waivedAmount: 5,
  });

  assert.equal(waivedBill.grandTotal, 95, 'discount should reduce bill total');
  assert.equal(waivedBill.grossProfit, 30, 'discount and waived amount must reduce grossProfit');
  assert.equal(waivedBill.waivedAmount, 5, 'waived amount should be stored on bill');
  assert.match(waivedBill.billNo, /^KOS-\d{4}-000002$/, 'estimate numbering must not consume the real sale sequence');

  await expectAppError(
    confirmBill(shopA.id, {
      billType: 'normal_sale',
      customerName: 'Walk-in',
      items: [
        {
          productId: rice.id,
          name: rice.name,
          quantity: 1,
          enteredUnit: 'piece',
          ratePerRateUnit: 100,
          gstRate: 0,
        },
      ],
      discount: 0,
      payments: [{ mode: 'cash', amount: 101 }],
      actualAmount: 100,
      buyerPaidAmount: 101,
      waivedAmount: 0,
    }),
    400,
    /Buyer paid amount.*cannot exceed bill amount/
  );

  const customer = await db.customer.create({
    data: {
      shopId: shopA.id,
      name: `Mohan ${suffix}`,
      mobile: mobile('mohan'),
    },
  });

  const creditLedgerClientId = `ledger_offline_credit_${suffix}`;
  const creditBill = await confirmBill(shopA.id, {
    billType: 'normal_sale',
    customerId: customer.id,
    customerName: customer.name,
    items: [
      {
        productId: sugar.id,
        name: sugar.name,
        quantity: 250,
        enteredUnit: 'g',
        ratePerRateUnit: 46,
        gstRate: 0,
      },
    ],
    discount: 0,
    payments: [{ mode: 'credit', amount: 11.5 }],
    actualAmount: 11.5,
    buyerPaidAmount: 0,
    waivedAmount: 0,
  }, { creditLedgerClientId });

  const customerAfterCredit = await db.customer.findUnique({ where: { id: customer.id } });
  assert.equal(customerAfterCredit.udharAmount, 11.5, 'credit bill must add udhar balance');

  const creditLedger = await db.udharLedger.findFirst({
    where: { shopId: shopA.id, billId: creditBill.id, type: 'debit' },
  });
  assert.equal(
    creditLedger?.clientLedgerId,
    creditLedgerClientId,
    'credit bill must persist the optimistic client ledger identity for echo reconciliation'
  );

  const sugarAfterCredit = await db.product.findUnique({ where: { id: sugar.id } });
  assert.equal(sugarAfterCredit.stockBaseQty, 1250, 'credit sale must deduct stock');

  const cancelledBill = await cancelBill(shopA.id, creditBill.id, { reason: 'Automated regression test cancel' });
  assert.equal(cancelledBill.status, 'cancelled', 'cancelled bill should be marked cancelled');

  const sugarAfterCancel = await db.product.findUnique({ where: { id: sugar.id } });
  assert.equal(sugarAfterCancel.stockBaseQty, 1500, 'cancel bill must restore stock');

  const customerAfterCancel = await db.customer.findUnique({ where: { id: customer.id } });
  assert.equal(customerAfterCancel.udharAmount, 0, 'cancel bill must reverse udhar balance');

  const cancelLedger = await db.stockLedger.findFirst({
    where: { shopId: shopA.id, billId: creditBill.id, action: 'cancel_reversal' },
  });
  assert.ok(cancelLedger, 'cancel bill must create stock ledger reversal');
  assert.equal(cancelLedger.changeBaseQty, 250, 'cancel reversal should add stock back');

  const udharReversal = await db.udharLedger.findFirst({
    where: { shopId: shopA.id, billId: creditBill.id, mode: 'reversal' },
  });
  assert.ok(udharReversal, 'cancel bill must create udhar reversal ledger');
  assert.equal(udharReversal.amount, 11.5, 'udhar reversal should match credit amount');

  // Cancel is idempotent: a replay (or cancel-then-delete, which maps to the same server op)
  // returns the already-cancelled bill instead of throwing, and must NOT reverse stock/udhar
  // again. Previously this threw "already cancelled" and stuck offline sync in CONFLICT.
  const recancelled = await cancelBill(shopA.id, creditBill.id, { reason: 'Double cancel is a no-op' });
  assert.equal(recancelled.status, 'cancelled', 'double cancel returns the cancelled bill (idempotent, no throw)');
  const reversalCount = await db.udharLedger.count({ where: { shopId: shopA.id, billId: creditBill.id, mode: 'reversal' } });
  assert.equal(reversalCount, 1, 'double cancel must NOT create a second udhar reversal');

  await expectAppError(getBill(shopB.id, cashBill.id), 404, /Bill not found/);
  await expectAppError(getProduct(shopB.id, sugar.id), 404, /Product not found/);

  const report = await getPnL(shopA.id, { range: 'daily' });
  assert.equal(report.grossSales, 118, 'P&L should include active sales only and exclude estimate/cancelled bills');
  assert.equal(report.grossProfit, 33, 'P&L grossProfit should include profit after discount/waived only for active sale bills');
  assert.equal(report.cashCollected, 113, 'P&L cash collection should exclude estimates and cancelled bills');
  assert.equal(report.cancelledBills, 1, 'P&L should count cancelled sale bills separately');
  assert.equal(report.cancelledBillsValue, 11.5, 'P&L cancelled value should track cancelled sale bills');

  const syncEvent = {
    eventId: `evt_customer_${suffix}`,
    type: 'CREATE_CUSTOMER',
    payload: {
      customer: {
        name: `Offline Customer ${suffix}`,
        mobile: mobile('offline'),
        type: 'regular',
      },
    },
  };

  const firstPush = await pushOfflineActions(shopA.id, [syncEvent], { role: 'staff' });
  assert.equal(firstPush.applied, 1, 'first offline sync customer event should apply');
  assert.equal(firstPush.results[0].status, 'synced');

  const secondPush = await pushOfflineActions(shopA.id, [syncEvent], { role: 'staff' });
  assert.equal(secondPush.applied, 1, 'duplicate already-synced event should be treated as success');
  assert.equal(secondPush.results[0].code, 'ALREADY_SYNCED', 'duplicate event should not be re-applied');

  const syncedCustomerCount = await db.customer.count({
    where: { shopId: shopA.id, mobile: mobile('offline') },
  });
  assert.equal(syncedCustomerCount, 1, 'duplicate offline sync event must not create duplicate customer');

  console.log('Backend regression examples passed');
} finally {
  await cleanupTestData(shopIds);
  await db.$disconnect();
}
