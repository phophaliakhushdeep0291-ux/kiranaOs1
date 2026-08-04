import process from "node:process";
import { maskDatabaseUrl } from "./test-db-utils.js";

const MONEY_COLUMN_MAP = Object.freeze([
  { table: "Product", float: "costPerRateUnit", paise: "costPerRateUnitPaise" },
  { table: "Product", float: "minPricePerRateUnit", paise: "minPricePerRateUnitPaise" },
  { table: "Product", float: "defaultPricePerRateUnit", paise: "defaultPricePerRateUnitPaise" },
  { table: "Customer", float: "udharAmount", paise: "udharAmountPaise" },
  { table: "Bill", float: "subtotal", paise: "subtotalPaise" },
  { table: "Bill", float: "discount", paise: "discountPaise" },
  { table: "Bill", float: "gst", paise: "gstPaise" },
  { table: "Bill", float: "grandTotal", paise: "grandTotalPaise" },
  { table: "Bill", float: "actualAmount", paise: "actualAmountPaise" },
  { table: "Bill", float: "buyerPaidAmount", paise: "buyerPaidAmountPaise" },
  { table: "Bill", float: "waivedAmount", paise: "waivedAmountPaise" },
  { table: "Bill", float: "grossProfit", paise: "grossProfitPaise" },
  { table: "Bill", float: "paidAmount", paise: "paidAmountPaise" },
  { table: "Bill", float: "creditAmount", paise: "creditAmountPaise" },
  { table: "BillItem", float: "ratePerRateUnit", paise: "ratePerRateUnitPaise" },
  { table: "BillItem", float: "costPerRateUnit", paise: "costPerRateUnitPaise" },
  { table: "BillItem", float: "lineTotal", paise: "lineTotalPaise" },
  { table: "BillItem", float: "lineCost", paise: "lineCostPaise" },
  { table: "BillItem", float: "lineProfit", paise: "lineProfitPaise" },
  { table: "Payment", float: "amount", paise: "amountPaise" },
  { table: "StockLedger", float: "purchaseBillAmount", paise: "purchaseBillAmountPaise" },
  { table: "StockLedger", float: "calculatedBuyRate", paise: "calculatedBuyRatePaise" },
  { table: "StockLedger", float: "damageLossValue", paise: "damageLossValuePaise" },
  { table: "UdharLedger", float: "amount", paise: "amountPaise" },
  { table: "PurchaseHistory", float: "pricePerRateUnit", paise: "pricePerRateUnitPaise" },
  { table: "PurchaseHistory", float: "totalCost", paise: "totalCostPaise" },
  // Nullable: a lot without its own printed MRP leaves both columns null, which
  // the missing-check ignores (it only fires when the float is set).
  { table: "InventoryLot", float: "mrp", paise: "mrpPaise" },
  { table: "PurchaseHistory", float: "billAmount", paise: "billAmountPaise" },
]);

function isPostgresUrl(url = "") {
  return /^postgres(?:ql)?:\/\//i.test(String(url));
}

function bigintToNumber(value) {
  if (typeof value === "bigint") return Number(value);
  return Number(value || 0);
}

function q(identifier) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function expectedPaiseExpression(floatColumn) {
  return `ROUND((${q(floatColumn)}::numeric * 100))::bigint`;
}

async function ensureColumnsExist(prisma) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
  `);
  const seen = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = [];
  for (const column of MONEY_COLUMN_MAP) {
    if (!seen.has(`${column.table}.${column.float}`)) missing.push(`${column.table}.${column.float}`);
    if (!seen.has(`${column.table}.${column.paise}`)) missing.push(`${column.table}.${column.paise}`);
  }
  return missing;
}

async function reconcileColumn(prisma, column, { write }) {
  const table = q(column.table);
  const floatCol = q(column.float);
  const paiseCol = q(column.paise);
  const expected = expectedPaiseExpression(column.float);

  if (write) {
    await prisma.$executeRawUnsafe(`
      UPDATE ${table}
      SET ${paiseCol} = ${expected}
      WHERE ${paiseCol} IS DISTINCT FROM ${expected}
    `);
  }

  const [stats] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE ${floatCol} IS NOT NULL AND ${paiseCol} IS NULL)::bigint AS missing,
      COUNT(*) FILTER (WHERE ${paiseCol} IS NOT NULL AND ${paiseCol} IS DISTINCT FROM ${expected})::bigint AS mismatched
    FROM ${table}
  `);

  return {
    table: column.table,
    floatColumn: column.float,
    paiseColumn: column.paise,
    total: bigintToNumber(stats.total),
    missing: bigintToNumber(stats.missing),
    mismatched: bigintToNumber(stats.mismatched),
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_DATABASE_URL || "";
  if (!isPostgresUrl(databaseUrl)) {
    console.log("Money paise reconciliation skipped: DATABASE_URL is not PostgreSQL.");
    return;
  }

  const write = process.argv.includes("--write") || process.env.ALLOW_MONEY_PAISE_BACKFILL === "true";
  const prismaModule = await import("@prisma/client");
  const { PrismaClient } = prismaModule.default ?? prismaModule;
  const prisma = new PrismaClient();
  try {
    console.log(`Money paise reconciliation database: ${maskDatabaseUrl(databaseUrl)}`);
    console.log(`Mode: ${write ? "write/backfill" : "read-only"}`);

    const missingColumns = await ensureColumnsExist(prisma);
    if (missingColumns.length) {
      console.error("Missing paise migration columns:");
      for (const column of missingColumns) console.error(`- ${column}`);
      console.error("Run npm run prisma:deploy:postgres before reconciliation.");
      process.exitCode = 1;
      return;
    }

    const results = [];
    for (const column of MONEY_COLUMN_MAP) {
      results.push(await reconcileColumn(prisma, column, { write }));
    }

    const failed = results.filter((row) => row.missing > 0 || row.mismatched > 0);
    for (const row of results) {
      console.log(`${row.table}.${row.paiseColumn}: total=${row.total}, missing=${row.missing}, mismatched=${row.mismatched}`);
    }

    if (failed.length) {
      console.error("Money paise reconciliation failed. Run with ALLOW_MONEY_PAISE_BACKFILL=true or --write after backup.");
      process.exitCode = 1;
      return;
    }

    console.log("Money paise reconciliation passed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Money paise reconciliation failed:", error);
  process.exit(1);
});
