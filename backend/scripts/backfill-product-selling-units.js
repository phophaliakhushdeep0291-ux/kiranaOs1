import db from "../src/db.js";
import { moneyShadows } from "../src/utils/money.js";

function conversionFor(product) {
  const rate = String(product.rateUnit ?? "").toLowerCase();
  const base = String(product.baseUnit ?? "").toLowerCase();
  if (["kg", "kilogram"].includes(rate) && ["g", "gram"].includes(base)) return 1000;
  if (["litre", "liter", "l"].includes(rate) && base === "ml") return 1000;
  if (rate === "dozen" && base === "piece") return 12;
  return 1;
}

async function main() {
  const products = await db.product.findMany({
    where: { sellingUnits: { none: {} } },
    orderBy: { createdAt: "asc" },
  });

  let created = 0;
  for (const product of products) {
    const unitType = product.rateUnit || product.displayUnit || "piece";
    await db.productSellingUnit.create({
      data: {
        shopId: product.shopId,
        productId: product.id,
        name: product.displayUnit || unitType,
        unitType,
        unitCode: unitType.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "piece",
        conversionToBase: conversionFor(product),
        barcode: product.barcode,
        defaultPrice: product.defaultPricePerRateUnit,
        minimumPrice: product.minPricePerRateUnit > 0 ? product.minPricePerRateUnit : null,
        maximumPrice: product.mrp > 0 ? product.mrp : null,
        costPrice: product.costPerRateUnit > 0 ? product.costPerRateUnit : null,
        isDefault: true,
        isActive: true,
        ...moneyShadows({
          defaultPrice: product.defaultPricePerRateUnit,
          minimumPrice: product.minPricePerRateUnit > 0 ? product.minPricePerRateUnit : null,
          maximumPrice: product.mrp > 0 ? product.mrp : null,
          costPrice: product.costPerRateUnit > 0 ? product.costPerRateUnit : null,
        }),
      },
    });
    created += 1;
  }

  console.log(`Product selling-unit backfill complete: ${created} created, ${products.length - created} skipped.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
