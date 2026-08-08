/**
 * backup-drill.js — the evidence behind SYNC-005.
 *
 * Run: npm run backup:drill
 *
 * A backup nobody has ever restored is not a backup. This seeds a shop with a year of
 * real trade, backs it up, DESTROYS every restorable row, restores from the artifact,
 * and then reconciles the restored shop against what was there before — at exact integer
 * paise and exact stock units. Any variance fails the drill and prints the first
 * differing record.
 *
 * Three deliberate choices:
 *
 *  - The destruction is real. It deletes every restorable row and asserts the shop is
 *    empty before restoring. restoreShopBackup() clears the shop inside its own
 *    transaction anyway, so a drill that skipped this step would prove only that restore
 *    can overwrite itself — never that it can rebuild a shop from nothing.
 *
 *  - Reconciliation compares INTEGER PAISE columns (grandTotalPaise, amountPaise,
 *    udharAmountPaise …), not the Float mirrors. Comparing floats is how a drill passes
 *    while a rupee is missing: two different values can print identically and compare
 *    equal after rounding. Where a paise column has not been backfilled the fallback is
 *    an explicit round of the float, applied identically on both sides.
 *
 *  - The trade is seeded through the real HTTP API, not by inserting rows. That is what
 *    makes the ledgers underneath (StockLedger, UdharLedger, FinancialLedger, audit) real
 *    rather than hand-written, so the drill exercises what a shop actually accumulates.
 *
 * On scripts/year-sim/: its simulator half drives a server on :3010, which a drill cannot
 * depend on being up, so only its pure half is reused — the deterministic RNG and the
 * money/date helpers that mirror src/utils/money.js. The seed is fixed, so a failure here
 * reproduces exactly.
 */
import process from "node:process";
import { createIntegrationContext, resetDatabase } from "../tests/integration/setup.js";
import { createTenant, login } from "../tests/integration/factories.js";
import {
  RESTORABLE_CHILD_MODELS,
  RESTORABLE_SHOP_MODELS,
  childWhereForShop,
  prismaDelegateName,
} from "../src/modules/backups/backup-policy.js";
import {
  __backupInternals,
  processShopBackupArtifact,
  restoreShopBackup,
} from "../src/modules/backups/backup.service.js";
import { env } from "../src/config/env.js";
import { addDays, atTime, intBetween, makeRng, pick } from "./year-sim/lib.mjs";

const SEED = Number(process.env.DRILL_SEED || 20260808);
const MONTHS = Number(process.env.DRILL_MONTHS || 12);
const BILLS_PER_MONTH = Number(process.env.DRILL_BILLS_PER_MONTH || 18);

/**
 * Inject a variance to prove the drill can actually fail.
 *   DRILL_INJECT_DRIFT=paise  — add 1 paise to one restored bill
 *   DRILL_INJECT_DRIFT=stock  — add 1 base unit to one restored product
 * Without this a green drill only shows that nothing went wrong, not that anything
 * would have been caught. tests/backup-drill.examples.js runs both.
 */
const INJECT_DRIFT = String(process.env.DRILL_INJECT_DRIFT || "").trim();

function log(message) {
  console.log(message);
}

function fail(message, detail) {
  console.error(`\n✖ DRILL FAILED: ${message}`);
  if (detail !== undefined) console.error(JSON.stringify(detail, jsonSafe, 2));
  process.exit(1);
}

function jsonSafe(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Integer paise, preferring the stored integer column over its Float mirror. */
function paiseOf(row, paiseField, floatField) {
  const stored = row?.[paiseField];
  if (stored !== null && stored !== undefined) return BigInt(stored);
  return BigInt(Math.round(Number(row?.[floatField] ?? 0) * 100));
}

function sumPaise(rows, paiseField, floatField) {
  return rows.reduce((total, row) => total + paiseOf(row, paiseField, floatField), 0n);
}

// ── the shop's numbers, as a shopkeeper would check them ──────────────────────

/**
 * Everything the drill reconciles. Keys are stable and sorted so the first difference
 * reported is deterministic rather than dependent on row order.
 */
async function fingerprintShop(db, shopId) {
  const [bills, payments, customers, products, purchases] = await Promise.all([
    db.bill.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
    db.payment.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
    db.customer.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
    db.product.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
    db.purchaseHistory.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
  ]);

  // Cancelled bills stay in the table and must stay out of the sales total, exactly as
  // the reports read them. Reconciling a number nobody reports would prove nothing.
  const liveBills = bills.filter((bill) => bill.status !== "cancelled" && !bill.deletedAt);

  const perTenderPaise = {};
  for (const payment of payments) {
    const mode = String(payment.mode ?? "unknown");
    perTenderPaise[mode] = (perTenderPaise[mode] ?? 0n) + paiseOf(payment, "amountPaise", "amount");
  }

  const udharByCustomer = {};
  for (const customer of customers) {
    udharByCustomer[customer.id] = paiseOf(customer, "udharAmountPaise", "udharAmount");
  }

  const stockByProduct = {};
  for (const product of products) {
    // Exact, not rounded: base units are the quantity a shopkeeper counts on the shelf.
    stockByProduct[product.id] = String(product.stockBaseQty ?? 0);
  }

  const dueBySupplier = {};
  for (const purchase of purchases) {
    const key = purchase.supplierId ?? "(no supplier)";
    dueBySupplier[key] = (dueBySupplier[key] ?? 0n)
      + paiseOf(purchase, "purchaseDueAmountPaise", "purchaseDueAmount");
  }

  return {
    totalSalesPaise: sumPaise(liveBills, "grandTotalPaise", "grandTotal"),
    gstTotalPaise: sumPaise(liveBills, "gstPaise", "gst"),
    discountTotalPaise: sumPaise(liveBills, "discountPaise", "discount"),
    perTenderPaise: sortedObject(perTenderPaise),
    udharByCustomer: sortedObject(udharByCustomer),
    stockByProduct: sortedObject(stockByProduct),
    dueBySupplier: sortedObject(dueBySupplier),
    rowCounts: await countEveryRestorableTable(db, shopId),
  };
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Audit actions the backup machinery writes about ITSELF, excluded from the row-count
 * comparison on both sides.
 *
 * This is not a tolerance. restoreShopBackup() records SHOP_BACKUP_RESTORED *after* its
 * transaction commits, so the restored shop legitimately holds one audit row the snapshot
 * could not have contained. Demanding an identical AuditLog count would therefore be
 * demanding that a restore leave no trace, which is worse than the variance — an
 * unrecorded restore is exactly what an auditor would object to. The drill instead
 * compares the shop's own business audit trail and separately asserts that the restore
 * audited itself exactly once, which is a stronger claim than the naive count.
 */
const BACKUP_MACHINERY_AUDIT_ACTIONS = [
  "SHOP_BACKUP_REQUESTED",
  "SHOP_BACKUP_COMPLETED",
  "SHOP_BACKUP_DOWNLOADED",
  "SHOP_BACKUP_RESTORE_PREVIEWED",
  "SHOP_BACKUP_RESTORED",
];

/**
 * Row counts per table, derived from the backup policy rather than a hand-kept list, so a
 * table added to the product cannot silently escape the drill.
 */
async function countEveryRestorableTable(db, shopId) {
  const counts = {};
  for (const modelName of RESTORABLE_SHOP_MODELS) {
    counts[modelName] = modelName === "AuditLog"
      ? await db.auditLog.count({ where: { shopId, action: { notIn: BACKUP_MACHINERY_AUDIT_ACTIONS } } })
      : await db[prismaDelegateName(modelName)].count({ where: { shopId } });
  }
  for (const [modelName, policy] of Object.entries(RESTORABLE_CHILD_MODELS)) {
    counts[modelName] = await db[prismaDelegateName(modelName)].count({
      where: childWhereForShop(policy.where, shopId),
    });
  }
  return sortedObject(counts);
}

/** The first leaf that differs, as a path plus both values. Nothing is tolerated. */
function firstDifference(before, after, path = "") {
  if (before instanceof Object && after instanceof Object
      && !(typeof before === "bigint") && !(typeof after === "bigint")) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const found = firstDifference(before[key], after[key], path ? `${path}.${key}` : key);
      if (found) return found;
    }
    return null;
  }
  const a = typeof before === "bigint" ? before.toString() : before;
  const b = typeof after === "bigint" ? after.toString() : after;
  if (a === b) return null;
  return { field: path, before: a === undefined ? "(missing)" : a, after: b === undefined ? "(missing)" : b };
}

// ── seeding a year of trade ───────────────────────────────────────────────────

async function seedYearOfTrade(ctx, db, tenant, token) {
  const rng = makeRng(SEED);
  const shopId = tenant.shop.id;

  const products = [];
  for (const [index, spec] of PRODUCT_SPECS.entries()) {
    const response = await ctx.post("/api/products", {
      name: spec.name,
      category: spec.category,
      displayUnit: "piece",
      baseUnit: "piece",
      rateUnit: "piece",
      conversionToBase: 1,
      defaultPricePerRateUnit: spec.price,
      costPerRateUnit: spec.cost,
      minPricePerRateUnit: spec.cost,
      gstRate: spec.gstRate,
      stockBaseQty: 500 + index * 10,
    }, { token, ownerPin: tenant.ownerPin });
    if (response.status !== 201) throw new Error(`Seed product failed: ${response.status} ${JSON.stringify(response.body)}`);
    products.push(response.body.data);
  }

  const customers = [];
  for (const name of CUSTOMER_NAMES) {
    const response = await ctx.post("/api/customers", {
      name,
      mobile: `9${String(700000000 + customers.length * 7717).slice(0, 9)}`,
      type: "udhar",
    }, { token });
    if (response.status !== 201) throw new Error(`Seed customer failed: ${response.status} ${JSON.stringify(response.body)}`);
    customers.push(response.body.data);
  }

  const suppliers = [];
  for (const name of SUPPLIER_NAMES) {
    const supplier = await db.supplier.create({ data: { shopId, name, mobile: null } });
    suppliers.push(supplier);
  }

  const start = new Date(2025, 7, 1);
  let billCount = 0;
  let udharPayments = 0;

  for (let month = 0; month < MONTHS; month += 1) {
    for (let index = 0; index < BILLS_PER_MONTH; index += 1) {
      const day = addDays(start, month * 30 + intBetween(rng, 0, 27));
      const product = pick(rng, products);
      const quantity = intBetween(rng, 1, 4);
      const rate = Number(product.defaultPricePerRateUnit ?? 20);
      const gross = Math.round(quantity * rate * 100) / 100;

      // A real month is not all cash: a fifth of it goes on the khata, and some of
      // that comes back later. Both paths have to survive a restore.
      const onUdhar = rng() < 0.2;
      const customer = onUdhar ? pick(rng, customers) : null;
      // A khata sale is not an absent payment — it is a `credit` tender, which is what
      // puts the amount on the customer's ledger instead of in the drawer.
      const payments = onUdhar
        ? [{ mode: "credit", amount: gross }]
        : [{ mode: pick(rng, ["cash", "upi", "bank"]), amount: gross }];

      const response = await ctx.post("/api/bills/confirm", {
        billType: "normal_sale",
        gstMode: "inclusive",
        customerId: customer?.id,
        customerName: customer?.name ?? "Walk-in",
        items: [{
          productId: product.id,
          name: product.name,
          quantity,
          enteredUnit: "piece",
          ratePerRateUnit: rate,
          gstRate: Number(product.gstRate ?? 0),
        }],
        discount: 0,
        actualAmount: gross,
        buyerPaidAmount: onUdhar ? 0 : gross,
        waivedAmount: 0,
        payments,
        createdAt: atTime(day, intBetween(rng, 8, 20)).toISOString(),
      }, { token });

      if (response.status !== 201) {
        throw new Error(`Seed bill failed: ${response.status} ${JSON.stringify(response.body)}`);
      }
      billCount += 1;
    }

    // Recover some khata each month, so udhar balances are a real running figure
    // rather than a monotonic total.
    const payer = pick(rng, customers);
    const fresh = await db.customer.findUnique({ where: { id: payer.id } });
    const owed = Number(fresh?.udharAmount ?? 0);
    if (owed > 1) {
      const response = await ctx.post(`/api/customers/${payer.id}/udhar-payment`, {
        amount: Math.round(owed * 0.4 * 100) / 100,
        mode: "cash",
      }, { token });
      // Loud on purpose: a silently skipped recovery would leave udhar balances
      // monotonic, and the drill would then be reconciling a shape no real khata has.
      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`Seed udhar payment failed: ${response.status} ${JSON.stringify(response.body)}`);
      }
      udharPayments += 1;
    }
  }

  // Purchases, so suppliers carry a real due.
  let purchaseCount = 0;
  for (const supplier of suppliers) {
    for (let index = 0; index < 6; index += 1) {
      const product = pick(rng, products);
      const quantity = intBetween(rng, 10, 60);
      const unitCost = Number(product.costPerRateUnit ?? 10);
      const billAmount = Math.round(quantity * unitCost * 100) / 100;
      const paid = index % 3 === 0 ? Math.round(billAmount * 0.5 * 100) / 100 : billAmount;
      const response = await ctx.post("/api/inventory/purchase", {
        idempotencyKey: `drill-purchase-${supplier.id}-${index}`,
        productId: product.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        quantity,
        enteredUnit: "piece",
        billAmount,
        purchasePaidAmount: paid,
        purchaseDueAmount: Math.round((billAmount - paid) * 100) / 100,
        purchasePaymentStatus: paid >= billAmount ? "paid" : "partial",
      }, { token, ownerPin: tenant.ownerPin });
      // Loud: supplier dues are one of the figures this drill claims to reconcile, so
      // seeding zero purchases would make that column vacuously green.
      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`Seed purchase failed: ${response.status} ${JSON.stringify(response.body)}`);
      }
      purchaseCount += 1;
    }
  }

  return { products: products.length, customers: customers.length, suppliers: suppliers.length, billCount, udharPayments, purchaseCount };
}

const PRODUCT_SPECS = [
  { name: "Tata Salt 1kg", category: "grocery", price: 28, cost: 24, gstRate: 0 },
  { name: "Aashirvaad Atta 5kg", category: "grocery", price: 340, cost: 312, gstRate: 0 },
  { name: "Amul Butter 100g", category: "dairy", price: 62, cost: 55, gstRate: 12 },
  { name: "Parle-G 800g", category: "snacks", price: 90, cost: 80, gstRate: 18 },
  { name: "Fortune Oil 1L", category: "grocery", price: 155, cost: 142, gstRate: 5 },
  { name: "Colgate 200g", category: "personal_care", price: 115, cost: 99, gstRate: 18 },
  { name: "Surf Excel 1kg", category: "household", price: 175, cost: 158, gstRate: 18 },
  { name: "Maggi 12-pack", category: "snacks", price: 168, cost: 150, gstRate: 12 },
];

const CUSTOMER_NAMES = ["Ramesh Kumar", "Sita Devi", "Imran Khan", "Lakshmi Iyer", "Gurpreet Singh", "Anita Sharma"];
const SUPPLIER_NAMES = ["Jodhpur Wholesale", "Marwar Traders", "Rajasthan FMCG"];

// ── destruction ───────────────────────────────────────────────────────────────

/**
 * Delete every restorable row for the shop, child tables first.
 *
 * Uses the backup module's own dependency ordering so the drill destroys exactly the set
 * restore claims to rebuild. If the two ever diverge, this is where it shows.
 */
async function destroyShopData(db, shopId) {
  const order = __backupInternals.restoreModelOrder();
  for (const modelName of [...order].reverse()) {
    const policy = RESTORABLE_CHILD_MODELS[modelName];
    await db[prismaDelegateName(modelName)].deleteMany({
      where: policy ? childWhereForShop(policy.where, shopId) : { shopId },
    });
  }
}

// ── the drill ─────────────────────────────────────────────────────────────────

async function main() {
  const ctx = await createIntegrationContext();
  if (ctx.skip) {
    // A drill that quietly skips is worse than no drill: SYNC-005 would be marked on
    // evidence that never ran.
    fail("the drill could not reach a database, so it proved nothing", { reason: ctx.reason });
  }

  const started = Date.now();
  try {
    await resetDatabase(ctx.db);
    env.BACKUP_ENCRYPTION_KEY = env.BACKUP_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");

    log("▶ seeding a year of trade");
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const session = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const token = session.token ?? session.accessToken ?? session.body?.data?.accessToken;
    if (!token) fail("could not authenticate the seeded owner", { session });

    const seeded = await seedYearOfTrade(ctx, ctx.db, tenant, token);
    log(`  seeded ${seeded.billCount} bills, ${seeded.purchaseCount} purchases, ${seeded.udharPayments} udhar recoveries `
      + `across ${seeded.products} products / ${seeded.customers} customers / ${seeded.suppliers} suppliers`);

    const shopId = tenant.shop.id;
    log("▶ fingerprinting the shop before backup");
    const before = await fingerprintShop(ctx.db, shopId);
    log(`  total sales ${before.totalSalesPaise} paise, GST ${before.gstTotalPaise} paise`);

    log("▶ taking a backup");
    const artifactRow = await ctx.db.backupArtifact.create({
      data: {
        shopId,
        requestedByUserId: tenant.owner.id,
        type: "shop_logical",
        status: "queued",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const artifact = await processShopBackupArtifact(artifactRow.id, shopId);
    log(`  artifact ${artifact.id} — ${artifact.record_count} records, sha256 ${String(artifact.checksum_sha256).slice(0, 16)}…`);

    log("▶ destroying the shop's data");
    await destroyShopData(ctx.db, shopId);
    const afterDestroy = await countEveryRestorableTable(ctx.db, shopId);
    const survivor = Object.entries(afterDestroy).find(([, count]) => count > 0);
    if (survivor) fail("destruction was incomplete, so the restore would not have been proven", { table: survivor[0], rows: survivor[1] });
    log("  every restorable table is empty");

    log("▶ restoring from the artifact");
    const restoreStartedAt = Date.now();
    const restored = await restoreShopBackup(shopId, artifactRow.id, tenant.owner.id, `RESTORE ${artifactRow.id.slice(-6)}`);
    const restoreDurationSeconds = Number(((Date.now() - restoreStartedAt) / 1000).toFixed(3));
    log(`  restored ${restored.restoredRecords} records across ${restored.restoredTables} tables in ${restoreDurationSeconds}s`);

    // A restore that leaves no trace is an audit finding in itself.
    const restoreAudits = await ctx.db.auditLog.count({ where: { shopId, action: "SHOP_BACKUP_RESTORED" } });
    if (restoreAudits !== 1) fail("the restore did not record itself exactly once in the audit trail", { restoreAudits });

    if (INJECT_DRIFT) await injectDrift(ctx.db, shopId, INJECT_DRIFT);

    log("▶ reconciling");
    const after = await fingerprintShop(ctx.db, shopId);
    const difference = firstDifference(before, after);
    if (difference) {
      fail(`restored shop does not reconcile — ${difference.field}`, difference);
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    log("");
    log(`✔ BACKUP DRILL PASSED — 0 paise and 0 unit variance (${seconds}s)`);
    log(JSON.stringify({
      type: "backup_drill",
      status: "passed",
      seed: SEED,
      durationSeconds: Number(seconds),
      restoreDurationSeconds,
      bills: seeded.billCount,
      records: artifact.record_count,
      totalSalesPaise: before.totalSalesPaise.toString(),
      gstTotalPaise: before.gstTotalPaise.toString(),
      tablesReconciled: Object.keys(before.rowCounts).length,
    }, jsonSafe));
  } finally {
    await ctx.close?.();
  }
}

/** Deliberate variance, to prove the reconciliation can fail. */
async function injectDrift(db, shopId, kind) {
  if (kind === "paise") {
    const bill = await db.bill.findFirst({ where: { shopId, status: "active" }, orderBy: { id: "asc" } });
    if (!bill) throw new Error("no bill to drift");
    const current = paiseOf(bill, "grandTotalPaise", "grandTotal");
    await db.bill.update({ where: { id: bill.id }, data: { grandTotalPaise: current + 1n } });
    log(`  [drift injected] bill ${bill.id} grandTotalPaise +1`);
    return;
  }
  if (kind === "stock") {
    const product = await db.product.findFirst({ where: { shopId }, orderBy: { id: "asc" } });
    if (!product) throw new Error("no product to drift");
    await db.product.update({ where: { id: product.id }, data: { stockBaseQty: Number(product.stockBaseQty ?? 0) + 1 } });
    log(`  [drift injected] product ${product.id} stockBaseQty +1`);
    return;
  }
  throw new Error(`Unknown DRILL_INJECT_DRIFT: ${kind}`);
}

main().catch((error) => {
  console.error(`\n✖ DRILL ERRORED: ${error?.message}`);
  console.error(error?.stack);
  process.exit(1);
});
