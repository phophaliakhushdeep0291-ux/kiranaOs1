import "dotenv/config";
import db from "../src/db.js";

const REQUIRED_PRODUCT_COLUMNS = [
  "id",
  "shopId",
  "name",
  "category",
  "aliasesJson",
  "displayUnit",
  "baseUnit",
  "rateUnit",
  "stockBaseQty",
  "costPerRateUnit",
  "costPerRateUnitPaise",
  "minPricePerRateUnit",
  "minPricePerRateUnitPaise",
  "defaultPricePerRateUnit",
  "defaultPricePerRateUnitPaise",
  "gstRate",
  "hsn",
  "brand",
  "mrp",
  "reorderLevel",
  "description",
  "imageUrl",
  "isLooseItem",
  "lowStockThreshold",
  "deletedAt",
  "createdAt",
  "updatedAt",
];

const REQUIRED_BILL_COLUMNS = [
  "id",
  "shopId",
  "billNo",
  "billType",
  "status",
  "clientBillId",
  "idempotencyKey",
  "sourceDeviceId",
  "returnOfBillId",
  "refundMode",
  "giftCardAmount",
  "giftCardAmountPaise",
  "createdAt",
  "updatedAt",
];

function databaseKind(url = process.env.DATABASE_URL || "") {
  if (/^postgres(?:ql)?:\/\//i.test(url)) return "postgresql";
  if (/^file:/i.test(url)) return "sqlite";
  return "unknown";
}

async function readProductColumns(kind) {
  if (kind === "postgresql") {
    const rows = await db.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'Product'
    `;
    return rows.map((row) => row.column_name);
  }

  if (kind === "sqlite") {
    const rows = await db.$queryRawUnsafe('PRAGMA table_info("Product")');
    return rows.map((row) => row.name);
  }

  throw new Error("Unsupported DATABASE_URL provider for product schema verification");
}

async function readBillColumns(kind) {
  if (kind === "postgresql") {
    const rows = await db.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'Bill'
    `;
    return rows.map((row) => row.column_name);
  }

  if (kind === "sqlite") {
    const rows = await db.$queryRawUnsafe('PRAGMA table_info("Bill")');
    return rows.map((row) => row.name);
  }

  throw new Error("Unsupported DATABASE_URL provider for bill schema verification");
}

async function main() {
  const kind = databaseKind();
  await db.$connect();

  const columns = new Set(await readProductColumns(kind));
  const missingColumns = REQUIRED_PRODUCT_COLUMNS.filter((column) => !columns.has(column));
  if (missingColumns.length) {
    const error = new Error(
      `Product table is missing columns required by the Prisma client: ${missingColumns.join(", ")}. ` +
      "Run Prisma migrate deploy and generate before starting the API."
    );
    error.missingColumns = missingColumns;
    throw error;
  }

  const billColumns = new Set(await readBillColumns(kind));
  const missingBillColumns = REQUIRED_BILL_COLUMNS.filter((column) => !billColumns.has(column));
  if (missingBillColumns.length) {
    const error = new Error(
      `Bill table is missing columns required by the Prisma client: ${missingBillColumns.join(", ")}. ` +
      "Run Prisma migrate deploy and generate before starting the API."
    );
    error.missingColumns = missingBillColumns;
    throw error;
  }

  await db.product.findMany({ take: 1 });
  await db.bill.findMany({ take: 1 });

  console.log(JSON.stringify({
    type: "product_schema_check",
    status: "passed",
    database: kind,
    columnsChecked: REQUIRED_PRODUCT_COLUMNS.length + REQUIRED_BILL_COLUMNS.length,
  }));
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    type: "product_schema_check",
    status: "failed",
    message: error.message,
    missingColumns: error.missingColumns || [],
  }));
  process.exitCode = 1;
} finally {
  await db.$disconnect().catch(() => {});
}
