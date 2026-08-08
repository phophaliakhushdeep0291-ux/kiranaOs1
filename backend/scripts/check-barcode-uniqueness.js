/**
 * Pre-flight for the `Product_shopId_barcode_key` unique index.
 *
 * `CREATE UNIQUE INDEX` fails outright if the target database already holds two
 * products in one shop sharing a barcode, and the container runs migrations before
 * the app boots — so an unnoticed duplicate is a failed deploy, not a warning.
 *
 * Run this against the target database BEFORE deploying migration
 * 000095_product_barcode_unique. It only reads; repairing a duplicate means
 * deciding which product legitimately owns the code, and that is a shopkeeper's
 * decision about their own stock, not a migration's.
 *
 * Exit 0 = safe to migrate. Exit 1 = duplicates listed on stdout.
 */
import process from "node:process";
import { PrismaClient } from "@prisma/client";

// Deliberately NOT filtered by deletedAt: the index covers every row, because a
// soft-deleted product keeps its barcode reserved so a restore from the recycle
// bin cannot resurrect a duplicate. A deleted row still collides.
const DUPLICATES_SQL = `
  SELECT "shopId", "barcode", COUNT(*) AS n
  FROM "Product"
  WHERE "barcode" IS NOT NULL
  GROUP BY "shopId", "barcode"
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
`;

function plainNumber(value) {
  return typeof value === "bigint" ? Number(value) : value;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(DUPLICATES_SQL);
    const duplicates = rows.map((row) => ({
      shopId: row.shopId,
      barcode: row.barcode,
      productCount: plainNumber(row.n),
    }));

    if (duplicates.length === 0) {
      console.log(JSON.stringify({ type: "barcode_uniqueness", status: "passed", duplicateGroups: 0 }));
      return 0;
    }

    for (const duplicate of duplicates) {
      // Name the products, so whoever fixes this can see which is the real owner
      // rather than going back to the database to find out.
      const products = await prisma.product.findMany({
        where: { shopId: duplicate.shopId, barcode: duplicate.barcode },
        select: { id: true, name: true, deletedAt: true, updatedAt: true },
        orderBy: { createdAt: "asc" },
      });
      console.error(JSON.stringify({
        type: "barcode_uniqueness_conflict",
        shopId: duplicate.shopId,
        barcode: duplicate.barcode,
        products: products.map((product) => ({
          id: product.id,
          name: product.name,
          inRecycleBin: Boolean(product.deletedAt),
        })),
      }));
    }

    console.error(JSON.stringify({
      type: "barcode_uniqueness",
      status: "failed",
      duplicateGroups: duplicates.length,
      hint: "Clear the barcode on every product except the one that truly owns each code, then re-run.",
    }));
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(JSON.stringify({ type: "barcode_uniqueness", status: "error", message: error.message }));
    process.exit(1);
  });
