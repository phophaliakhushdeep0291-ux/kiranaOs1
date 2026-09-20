/**
 * index-audit.js — does this schema have a missing-index problem, and would adding
 * one actually fix it?
 *
 * Prisma never creates indexes for foreign keys. This schema has ~75 FK columns that
 * lead no index, and on SQLite that is invisible: SQLite will skip-scan a composite
 * like (shopId, productId, unitCode) for a bare `productId`, so a local EXPLAIN says
 * the query is fine. PostgreSQL 16 — the version docker-compose.yml pins, and the one
 * this ships on — has no skip-scan (it arrived in 18). There, the same query is a
 * sequential scan of the whole child table.
 *
 * That gap is why this script exists and why it runs on either engine. The interesting
 * output is the two side by side: what SQLite hides, PostgreSQL bills you for.
 *
 * Three phases, and only the last one decides anything:
 *
 *   SEED     a shop with enough history that per-row work is visible. A report over an
 *            empty shop touches none of what makes it expensive.
 *
 *   FLAG     every FK column that leads no index, on a table big enough to matter, and
 *            ask the real planner how it runs the query Prisma's relation loader emits
 *            for it. These are CANDIDATES, not findings.
 *
 *   DECIDE   by building each candidate index and measuring the real report workload
 *            with it and without it, interleaved, checksumming every report both ways.
 *            An index earns its place by moving a number.
 *
 * The last phase is the point. A list of sequential scans is not a list of problems:
 * scanning a table you are about to read most of is the CORRECT plan, and an index
 * there costs writes on the sale path to buy nothing. Acting on FLAG without DECIDE is
 * how a schema ends up paying for indexes no query benefits from.
 *
 * On the FLAG phase's honesty: it reconstructs the relation-loader query shape
 * (`SELECT … FROM child WHERE fk IN (…)`) rather than intercepting it, because getting
 * real bound parameters out of Prisma's logger needs a client built for it and the
 * services use the shared one. The shape is Prisma's documented behaviour for a nested
 * read, and DECIDE measures the real services either way — so a wrong guess here costs
 * a candidate, never a false conclusion.
 *
 * Usage (from backend/), via the stack runner which supplies a disposable database:
 *   npm run index-audit:postgres        # disposable PostgreSQL 16 in Docker
 *   npm run index-audit:local           # SQLite, for the comparison
 *
 *   INDEX_AUDIT_BILLS=30000 npm run index-audit:postgres
 *   POSTGRES_TEST_DATABASE_URL=postgresql://… npm run index-audit:postgres
 *
 * It CREATEs and DROPs indexes and writes tens of thousands of rows, so it refuses to
 * run against anything that looks like a database somebody cares about.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

const DATABASE_URL = String(process.env.DATABASE_URL || "");
const IS_POSTGRES = /^postgres(ql)?:/i.test(DATABASE_URL);
const ENGINE = IS_POSTGRES ? `PostgreSQL` : "SQLite";
const Q = IS_POSTGRES ? '"' : "`";

const BILLS = Number(process.env.INDEX_AUDIT_BILLS || 14_600);
const PRODUCTS = Number(process.env.INDEX_AUDIT_PRODUCTS || 560);
const CUSTOMERS = Number(process.env.INDEX_AUDIT_CUSTOMERS || 150);
const ROUNDS = Number(process.env.INDEX_AUDIT_ROUNDS || 5);
// Below this, a sequential scan is cheap however wrong the plan looks.
const ROW_FLOOR = Number(process.env.INDEX_AUDIT_ROW_FLOOR || 500);
// An index cannot help a read that returns most of the table. Past this share of rows,
// the scan is the right plan and the candidate is dropped before it is ever built.
const SELECTIVITY_CEILING = Number(process.env.INDEX_AUDIT_SELECTIVITY || 0.25);

function refuseNonDisposable() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required.");

  // Read the DATABASE NAME, not the URL. A checkout in a directory called
  // "prodready-wt" is not a production database, and matching "prod" anywhere in the
  // path is how this repo once locked every DB-backed test out of such a checkout
  // (BUG-056). The name is the only part that says what the database IS.
  const name = IS_POSTGRES
    ? (DATABASE_URL.split("?")[0].split("/").pop() || "")
    : path.basename(decodeURIComponent(DATABASE_URL.slice("file:".length).split("?")[0]));
  const lowered = name.toLowerCase();

  for (const marker of ["prod", "production", "live"]) {
    if (lowered.includes(marker)) {
      throw new Error(`Refusing to audit "${name}": the database NAME contains "${marker}". This script writes tens of thousands of rows and builds and drops indexes — give it a disposable database.`);
    }
  }
  if (!IS_POSTGRES && lowered === "dev.db") {
    throw new Error("Refusing to audit prisma/dev.db, which is the shared development database. Run scripts/run-index-audit-stack.js, which makes a disposable one.");
  }
}

// ── Which FK columns lead no index ──────────────────────────────────────────
// Read from the schema Prisma uses for THIS datasource, so the answer cannot drift
// from the database being measured.
function unindexedForeignKeys() {
  const schemaPath = IS_POSTGRES ? "prisma-postgres/schema.prisma" : "prisma/schema.prisma";
  const schema = fs.readFileSync(path.join(process.cwd(), schemaPath), "utf8");
  const found = [];
  for (const [, model, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const foreignKeys = [...body.matchAll(/@relation\([^)]*fields:\s*\[(\w+)\]/g)].map((m) => m[1]);
    // An index can only be seeked on its FIRST column. That is the whole defect.
    const leads = new Set();
    for (const m of body.matchAll(/@@(?:index|unique)\(\[(\w+)/g)) leads.add(m[1]);
    for (const m of body.matchAll(/^\s*(\w+)\s+\w+.*@unique/gm)) leads.add(m[1]);
    for (const column of new Set(foreignKeys)) {
      if (!leads.has(column)) found.push({ table: model, column });
    }
  }
  return found;
}

// ── Planner access, per engine ──────────────────────────────────────────────
async function scannedTables(db, sql, params) {
  if (IS_POSTGRES) {
    // ANALYZE runs it. Everything passed here is a SELECT from a read path, and the
    // row counts the planner actually saw are the only ones worth reporting.
    const rows = await db.$queryRawUnsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, ...params);
    const raw = rows?.[0]?.["QUERY PLAN"] ?? rows?.[0];
    const scanned = [];
    (function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node["Node Type"] === "Seq Scan" && node["Relation Name"]) {
        scanned.push({ table: node["Relation Name"], ms: node["Actual Total Time"] ?? null });
      }
      if (node.Plan) walk(node.Plan);
      if (node.Plans) walk(node.Plans);
    })(typeof raw === "string" ? JSON.parse(raw) : raw);
    return scanned;
  }
  const rows = await db.$queryRawUnsafe(`EXPLAIN QUERY PLAN ${sql}`, ...params);
  return rows
    .map((row) => /^SCAN (?:TABLE )?`?(?:main`?\.`?)?`?(\w+)`?/.exec(row.detail))
    .filter(Boolean)
    .map((m) => ({ table: m[1], ms: null }));
}

const placeholder = (i) => (IS_POSTGRES ? `$${i + 1}` : "?");

async function timeStatement(db, sql, params, iterations = 20) {
  await db.$queryRawUnsafe(sql, ...params);
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await db.$queryRawUnsafe(sql, ...params);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

async function withIndex(db, { table, column }, body) {
  const name = `audit_${table}_${column}_idx`.toLowerCase();
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS ${Q}${name}${Q} ON ${Q}${table}${Q} (${Q}${column}${Q})`);
  // Fresh statistics, or the planner keeps the shape it chose before the index existed.
  await db.$executeRawUnsafe(IS_POSTGRES ? `ANALYZE ${Q}${table}${Q}` : "ANALYZE");
  try {
    return await body();
  } finally {
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS ${Q}${name}${Q}`);
    await db.$executeRawUnsafe(IS_POSTGRES ? `ANALYZE ${Q}${table}${Q}` : "ANALYZE");
  }
}

export {
  refuseNonDisposable, unindexedForeignKeys, scannedTables, placeholder,
  timeStatement, withIndex, createHash,
  IS_POSTGRES, ENGINE, Q, BILLS, PRODUCTS, CUSTOMERS, ROUNDS, ROW_FLOOR, SELECTIVITY_CEILING,
};

// ─────────────────────────────────────────────────────────────────────────────
// SEED
// ─────────────────────────────────────────────────────────────────────────────
//
// Products, customers and one bill go through the real services, so every row is
// shaped the way the application shapes it. The remaining bills are cloned from that
// first one with createMany: pushing 14,600 bills through confirmBill would spend
// minutes in transactions to produce rows this script only ever reads.
async function seed(db, log) {
  const { registerShop } = await import("../src/modules/auth/auth.service.js");
  const { createProduct } = await import("../src/modules/products/products.service.js");
  const { confirmBill } = await import("../src/modules/bills/bills.service.js");
  // The route validates before the service sees a body, and validation is where the
  // numeric defaults come from (discount: 0, waivedAmount: 0, …). Calling the service
  // directly skips that, so parse here rather than hand-listing defaults that would
  // then drift from the schema.
  const { confirmBillSchema } = await import("../src/modules/bills/bills.schema.js");

  const stamp = Date.now().toString().slice(-9);
  log(`seeding a shop with ${PRODUCTS} products, ${CUSTOMERS} customers and ${BILLS} bills…`);
  const registration = await registerShop({
    shopName: "Index Audit Kirana",
    ownerName: "Audit Owner",
    city: "Indore",
    address: "1 Audit Road",
    mobile: `9${stamp}`,
    password: "AuditPass@12345",
    ownerPin: "4321",
    businessType: "kirana",
  });
  const shopId = registration.shop?.id ?? registration.data?.shop?.id;
  const userId = registration.user?.id ?? registration.data?.user?.id;
  if (!shopId) throw new Error("registerShop did not return a shop id");

  // One real product, then clones: createProduct does unit resolution and pricing
  // validation that a hand-built row would skip.
  const seedProduct = await createProduct(shopId, {
    name: "Audit Atta 0", category: "Grocery", baseUnit: "g", rateUnit: "kg",
    costPerRateUnit: 40, defaultPricePerRateUnit: 50, mrp: 60, stockBaseQty: 100_000,
    lowStockThreshold: 5_000,
  });
  const productProto = await db.product.findUnique({ where: { id: seedProduct.id ?? seedProduct.data?.id } });
  const products = [];
  for (let i = 1; i < PRODUCTS; i++) {
    products.push({
      ...productProto,
      id: `auditprod${String(i).padStart(14, "0")}`,
      name: `Audit Product ${i}`,
      barcode: `AUDIT${i}`, sku: `AUDITSKU${i}`,
      clientProductId: null, idempotencyKey: null, sourceDeviceId: null,
      // A seventh of the catalogue sits below its reorder point, as a real one does.
      lowStockThreshold: i % 7 === 0 ? 200_000 : 0,
      ...(i % 3 === 0 ? { packagingMode: "per_pack" } : {}),
    });
  }
  await createManyInChunks(db.product, products);

  // Pack sizes: three on every per_pack product. This is the table whose FK is the
  // one that matters, so it has to be the size a real catalogue makes it.
  const unitProto = await db.productSellingUnit.findFirst({ where: { shopId } });
  if (unitProto) {
    const units = [];
    let n = 0;
    for (const product of products) {
      if (product.packagingMode !== "per_pack") continue;
      for (let u = 0; u < 3; u++) {
        units.push({
          ...unitProto,
          id: `auditunit${String(n++).padStart(14, "0")}`,
          productId: product.id, unitCode: `AU${u}`, name: `Pack ${u}`,
          barcode: null, sku: null,
          onHandQty: 10 + u, lowStockThreshold: u === 0 ? 50 : 1, isDefault: false,
        });
      }
    }
    await createManyInChunks(db.productSellingUnit, units);
  }

  const customerProto = { shopId, name: "Audit Customer 0", mobile: `8${stamp}` };
  await db.customer.create({ data: customerProto });
  const customers = [];
  for (let i = 1; i < CUSTOMERS; i++) {
    customers.push({
      shopId,
      id: `auditcust${String(i).padStart(14, "0")}`,
      name: `Audit Customer ${i}`,
      mobile: `8${String(stamp.slice(0, 5))}${String(i).padStart(4, "0")}`,
      // A third of them owe something, which is what udhar ageing walks.
      udharAmount: i % 3 === 0 ? 250 + i : 0,
    });
  }
  await createManyInChunks(db.customer, customers);

  const realBill = await confirmBill(shopId, confirmBillSchema.parse({
    billType: "normal_sale", gstMode: "none", customerName: "Audit Walk-in",
    items: [{ name: "Audit Atta 0", quantity: 1, enteredUnit: "kg", ratePerRateUnit: 50 }],
    payments: [{ mode: "cash", amount: 50 }],
    idempotencyKey: `audit-seed-${stamp}`,
  }), { userId, role: "owner" });
  const billId = realBill.id ?? realBill.bill?.id ?? realBill.data?.id;
  const billProto = { ...(await db.bill.findUnique({ where: { id: billId } })) };
  const itemProto = { ...(await db.billItem.findFirst({ where: { billId } })) };
  const paymentProto = { ...(await db.payment.findFirst({ where: { billId } })) };

  const DAY = 86_400_000;
  const now = Date.now();
  const perDay = Math.max(1, Math.round(BILLS / 365));
  const bills = [], items = [], payments = [];
  let n = 0;
  for (let d = 364; d >= 0 && n < BILLS; d--) {
    for (let b = 0; b < perDay && n < BILLS; b++) {
      const when = new Date(now - d * DAY + b * 900_000);
      const id = `auditbill${String(n).padStart(14, "0")}`;
      const credit = n % 5 === 0 ? 120 : 0;
      const grand = 250 + (n % 300);
      bills.push({
        ...billProto, id, billNo: `AUDIT-${n}`,
        customerId: credit ? `auditcust${String((n % (CUSTOMERS - 1)) + 1).padStart(14, "0")}` : null,
        status: n % 97 === 0 ? "cancelled" : "active",
        billType: n % 11 === 0 ? "estimate" : "normal_sale",
        grandTotal: grand, subtotal: grand, paidAmount: grand - credit, creditAmount: credit,
        grossProfit: grand * 0.18, discount: n % 4, waivedAmount: 0,
        createdByUserId: userId, clientBillId: null, idempotencyKey: null,
        sourceDeviceId: null, whatsappDeliveryKey: null, deletedAt: null,
        businessDate: when, createdAt: when, updatedAt: when,
      });
      for (let k = 0; k < 3 + (n % 2); k++) {
        items.push({
          ...itemProto, id: `audititem${String(items.length).padStart(13, "0")}`, billId: id,
          productId: products[(n * 3 + k) % products.length].id,
          name: `Audit Product ${(n * 3 + k) % products.length}`,
          lineTotal: 60, lineProfit: 11, lineCost: 49, quantityInBaseUnit: 2,
        });
      }
      payments.push({
        ...paymentProto, id: `auditpay${String(n).padStart(15, "0")}`, billId: id,
        mode: n % 3 === 0 ? "upi" : (n % 7 === 0 ? "bank" : "cash"),
        amount: grand - credit, status: "confirmed",
        clientPaymentId: null, idempotencyKey: null, sourceDeviceId: null,
        retailPaymentIntentId: null, createdAt: when,
      });
      n++;
    }
  }
  await createManyInChunks(db.bill, bills);
  await createManyInChunks(db.billItem, items);
  await createManyInChunks(db.payment, payments);

  // Udhar: the ledger the ageing report walks in full, and the table whose shop-wide
  // date reads already earned an index. Built from its columns rather than cloned from
  // an existing row — the seed bill above is a cash sale, so there is no row to clone,
  // and an empty UdharLedger would quietly drop UdharLedger.customerId from the
  // candidate list. That FK is one of the reasons this audit exists.
  const ledger = [];
  for (let d = 364; d >= 0; d--) {
    for (let k = 0; k < 6; k++) {
      const when = new Date(now - d * DAY + k * 3_600_000);
      const index = ledger.length;
      const customerIndex = (index % (CUSTOMERS - 1)) + 1;
      ledger.push({
        id: `auditudh${String(index).padStart(15, "0")}`,
        shopId,
        customerId: `auditcust${String(customerIndex).padStart(14, "0")}`,
        customerName: `Audit Customer ${customerIndex}`,
        // Alternating debit and payment, so the ageing report's FIFO allocation has
        // both to work with rather than a pile of untouched debt.
        type: k % 2 ? "payment" : "debit",
        mode: k % 2 ? ["cash", "upi", "bank"][k % 3] : "credit",
        amount: 50 + k,
        businessDate: when, createdAt: when, updatedAt: when,
      });
    }
  }
  await createManyInChunks(db.udharLedger, ledger);

  await db.$executeRawUnsafe("ANALYZE");
  log(`seeded: ${bills.length} bills, ${items.length} line items, ${products.length + 1} products, ${ledger.length} udhar rows`);
  return { shopId };
}

async function createManyInChunks(model, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    await model.createMany({ data: rows.slice(i, i + size) });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKLOAD — the reports, timed and checksummed
// ─────────────────────────────────────────────────────────────────────────────
//
// Checksums matter as much as the timings. An index cannot change an answer, so if a
// number moves when one is added, the measurement is wrong and the timing means
// nothing. Volatile fields are dropped before hashing.
const VOLATILE = new Set(["generatedAt", "from", "to", "oldestPendingDate"]);
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().filter((k) => !VOLATILE.has(k)).map((k) => [k, stable(value[k])]),
    );
  }
  return typeof value === "bigint" ? String(value) : value;
}
const checksum = (v) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex").slice(0, 16);

async function buildWorkload(shopId) {
  const R = await import("../src/modules/reports/reports.service.js");
  const P = await import("../src/modules/products/products.service.js");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  return [
    ["dailyClosing", () => R.getDailyClosing(shopId, { date: today, allLocations: true })],
    ["salesSummary 30d", () => R.getSalesSummary(shopId, { range: "30d" })],
    ["paymentModes 30d", () => R.getPaymentModeReport(shopId, { from: monthAgo, to: today })],
    ["udharAgeing", () => R.getUdharAgeing(shopId)],
    ["pnl 30d", () => R.getPnL(shopId, { from: monthAgo, to: today })],
    ["monthlyBreakdown", () => R.getMonthlyBreakdown(shopId, { year: new Date().getFullYear(), untilMonth: 12 })],
    ["topProducts 30d", () => R.getTopProducts(shopId, { from: monthAgo, to: today })],
    ["inventoryHealth", () => R.getInventoryHealth(shopId, { includeCost: true })],
    ["staffSales 30d", () => R.getStaffSales(shopId, { from: monthAgo, to: today })],
    ["ledgerReconciliation", () => R.getFinancialLedgerReconciliation(shopId)],
    ["exportBills 30d", () => R.exportBillsData(shopId, { from: monthAgo, to: today, status: "all" })],
    // The counter's own reads. listProducts is why ProductSellingUnit.productId is a
    // candidate at all: it pulls the whole catalogue with its pack sizes.
    ["listProducts", () => P.listProducts?.(shopId, {})],
  ].filter(([, fn]) => typeof fn === "function");
}

async function runWorkload(workload, rounds) {
  const result = new Map();
  for (const [label, fn] of workload) {
    const times = [];
    let sum = null;
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      let value;
      try { value = await fn(); } catch (error) { result.set(label, { ms: null, checksum: `threw: ${error.code || error.message}` }); break; }
      times.push(performance.now() - t0);
      sum = checksum(value);
    }
    if (times.length) {
      times.sort((a, b) => a - b);
      result.set(label, { ms: times[Math.floor(times.length / 2)], checksum: sum });
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLAG — which unindexed FK is worth building an index for
// ─────────────────────────────────────────────────────────────────────────────
async function flagCandidates(db, shopId, log) {
  const all = unindexedForeignKeys();
  log(`${all.length} FK columns in this schema lead no index.`);
  const candidates = [];
  for (const { table, column } of all) {
    let rows = 0;
    try {
      const counted = await db.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${Q}${table}${Q}`);
      rows = Number(counted?.[0]?.n ?? counted?.[0]?.N ?? 0);
    } catch { continue; }
    if (rows < ROW_FLOOR) continue;

    // The query Prisma's relation loader emits for a nested read: the child table
    // filtered by the FK alone, with no shop scope to put the composite's leading
    // column to work. Drawn from real ids so the planner sees real selectivity.
    let ids;
    try {
      ids = (await db.$queryRawUnsafe(
        `SELECT DISTINCT ${Q}${column}${Q} AS v FROM ${Q}${table}${Q} WHERE ${Q}${column}${Q} IS NOT NULL LIMIT 200`,
      )).map((r) => r.v);
    } catch { continue; }
    if (!ids.length) continue;

    const sql = `SELECT * FROM ${Q}${table}${Q} WHERE ${Q}${column}${Q} IN (${ids.map((_, i) => placeholder(i)).join(", ")})`;
    let scans, ms;
    try {
      scans = await scannedTables(db, sql, ids);
      ms = await timeStatement(db, sql, ids);
    } catch (error) {
      log(`  ${table}.${column}: could not be planned (${String(error.message).slice(0, 60)})`);
      continue;
    }
    const scansThis = scans.some((s) => s.table.toLowerCase() === table.toLowerCase());
    if (!scansThis) continue;

    // How much of the table does this read actually want? An index cannot help a
    // query that is asking for most of it, and building one would be pure write cost.
    const matched = Number((await db.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM ${Q}${table}${Q} WHERE ${Q}${column}${Q} IN (${ids.map((_, i) => placeholder(i)).join(", ")})`,
      ...ids,
    ))?.[0]?.n ?? 0);
    const share = rows ? matched / rows : 1;
    candidates.push({ table, column, rows, matched, share, ms, viable: share <= SELECTIVITY_CEILING });
  }
  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// DECIDE — build it, measure the real reports, throw it away
// ─────────────────────────────────────────────────────────────────────────────
// Measure WITHOUT and WITH, alternately, in one loop.
//
// The obvious shape — take a baseline, add the index, measure again — is wrong, and
// wrong in a way that reads as success: the baseline runs against a cold page cache and
// the second pass against a warm one, so EVERY report gets faster and the index looks
// like a triumph. The tell is a candidate that improves reports it cannot possibly
// touch. Alternating makes both arms pay the same warm-up, the same background load
// and the same drift.
async function decide(db, candidate, workload, rounds) {
  const name = `audit_${candidate.table}_${candidate.column}_idx`.toLowerCase();
  const { table, column } = candidate;
  const withoutSamples = new Map();
  const withSamples = new Map();
  const checksums = new Map();

  const record = (into, run) => {
    for (const [label, result] of run) {
      if (result.ms == null) continue;
      if (!into.has(label)) into.set(label, []);
      into.get(label).push(result.ms);
      const seen = checksums.get(label) ?? new Set();
      seen.add(result.checksum);
      checksums.set(label, seen);
    }
  };

  const drop = () => db.$executeRawUnsafe(`DROP INDEX IF EXISTS ${Q}${name}${Q}`)
    .then(() => db.$executeRawUnsafe(IS_POSTGRES ? `ANALYZE ${Q}${table}${Q}` : "ANALYZE"));
  const create = () => db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS ${Q}${name}${Q} ON ${Q}${table}${Q} (${Q}${column}${Q})`,
  ).then(() => db.$executeRawUnsafe(IS_POSTGRES ? `ANALYZE ${Q}${table}${Q}` : "ANALYZE"));

  try {
    // One throwaway pass so neither arm is the one that pays for a cold cache.
    await drop();
    await runWorkload(workload, 1);
    for (let i = 0; i < rounds; i++) {
      // CREATE INDEX and DROP INDEX both write pages, which evicts whatever the
      // previous arm had warmed. Without a throwaway pass after each one, the arm
      // measured first after the DDL is charged for reloading the cache and the other
      // is not — a bias that looks exactly like the index working.
      await drop();
      await runWorkload(workload, 1);
      record(withoutSamples, await runWorkload(workload, 1));
      await create();
      await runWorkload(workload, 1);
      record(withSamples, await runWorkload(workload, 1));
    }
  } finally {
    await drop();
  }

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const moved = [];
  for (const [label, without] of withoutSamples) {
    const withIt = withSamples.get(label);
    if (!withIt?.length) continue;
    if ((checksums.get(label)?.size ?? 1) > 1) {
      moved.push({ label, changed: true });
      continue;
    }
    // Both the typical run AND the best run have to improve. On samples this small a
    // median can be carried by one slow outlier in the other arm; the best-of-arm is
    // the least contaminated number either side has, so making them agree is what
    // separates an index from a quiet afternoon on the machine.
    const medianGain = 1 - median(withIt) / median(without);
    const bestGain = 1 - Math.min(...withIt) / Math.min(...without);
    if (medianGain >= 0.15 && bestGain >= 0.15) {
      moved.push({ label, changed: false, before: median(without), after: median(withIt), bestGain });
    }
  }
  return moved;
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  refuseNonDisposable();
  const { default: db } = await import("../src/db.js");
  const log = (line) => console.log(line);

  console.log(`\nIndex audit — ${ENGINE}\n${"=".repeat(60)}`);
  if (!IS_POSTGRES) {
    console.log("Note: SQLite skip-scans a composite index for a bare second column, so it");
    console.log("hides exactly the defect this looks for. Run --postgres for the real answer.\n");
  }

  const { shopId } = await seed(db, log);
  const workload = await buildWorkload(shopId);

  console.log(`\nBaseline (median of ${ROUNDS})\n${"-".repeat(60)}`);
  const baseline = await runWorkload(workload, ROUNDS);
  for (const [label, r] of baseline) {
    console.log(`  ${label.padEnd(24)} ${r.ms == null ? r.checksum : `${r.ms.toFixed(1).padStart(8)} ms`}`);
  }

  console.log(`\nCandidates\n${"-".repeat(60)}`);
  const candidates = await flagCandidates(db, shopId, log);
  const viable = candidates.filter((c) => c.viable);
  for (const c of candidates) {
    const verdict = c.viable
      ? "candidate"
      : `skipped — the read wants ${(c.share * 100).toFixed(0)}% of the table, so scanning it is correct`;
    console.log(`  ${`${c.table}.${c.column}`.padEnd(42)} ${String(c.rows).padStart(8)} rows  ${c.ms.toFixed(2).padStart(7)} ms  ${verdict}`);
  }
  if (!candidates.length) console.log("  no unindexed FK on a table above the row floor is scanned by this workload.");

  console.log(`\nVerdicts\n${"-".repeat(60)}`);
  if (!viable.length) {
    console.log("  Nothing to add. Every scan found is a scan of a table the query wants most of.");
  }
  const worthAdding = [];
  for (const candidate of viable) {
    const moved = await decide(db, candidate, workload, ROUNDS);
    const label = `${candidate.table}.${candidate.column}`;
    const changed = moved.filter((m) => m.changed);
    if (changed.length) {
      console.log(`  ${label.padEnd(42)} MEASUREMENT INVALID — ${changed[0].label} returned a different answer with the index present.`);
      console.log("      An index cannot change a result. Re-run; if it persists, the workload is not deterministic.");
      continue;
    }
    if (!moved.length) {
      console.log(`  ${label.padEnd(42)} no — no report improved by more than 15%.`);
      continue;
    }
    worthAdding.push({ candidate, moved });
    console.log(`  ${label.padEnd(42)} YES`);
    for (const m of moved) {
      console.log(`      ${m.label.padEnd(24)} ${m.before.toFixed(1)} ms -> ${m.after.toFixed(1)} ms  (${(m.before / m.after).toFixed(1)}x)`);
    }
    // An index on one table cannot speed up a report that never reads it. If nearly
    // everything moved, the two arms were not measured under the same conditions.
    if (moved.length >= workload.length - 1) {
      console.log("      ^ every report improved, which no single index can do. Treat this run as drift, not a result.");
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  if (worthAdding.length) {
    console.log(`Add these to BOTH prisma/schema.prisma and prisma-postgres/schema.prisma,\nwith a migration in each tree:\n`);
    for (const { candidate } of worthAdding) {
      console.log(`  model ${candidate.table} {  …  @@index([${candidate.column}])  }`);
    }
    console.log(`\nEach one costs a write on every insert and update of ${worthAdding.map((w) => w.candidate.table).join(", ")}.`);
  } else {
    console.log("No index earned its place in this run.");
  }
  console.log(`\nMeasured on ${ENGINE} with ${BILLS} bills / ${PRODUCTS} products / ${CUSTOMERS} customers.`);
  if (!IS_POSTGRES) console.log("SQLite hides the FK gap. This run does not settle the question.");
  console.log();

  await db.$disconnect();
}

await main();
