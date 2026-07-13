/**
 * KiranaOS — Demo Seed
 * Run: node prisma/seed.js
 *
 * Creates:
 *   1 demo shop (Sharma General Store, Jodhpur)
 *   1 owner user  (mobile: 9800000001, password: demo1234)
 *   10 common kirana products
 *   1 udhar customer
 *   1 supplier
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PLAN_CODES, PLAN_CONFIGS } from "../src/modules/subscription/planConfig.js";

const db = new PrismaClient();

async function main() {
  console.log("🌱 Seeding KiranaOS demo data...");

  // ── SaaS Plans ─────────────────────────────────────────────
  for (const code of PLAN_CODES) {
    const plan = PLAN_CONFIGS[code];
    await db.plan.upsert({
      where: { code },
      update: {
        name: plan.name,
        priceMonthlyPaise: plan.priceMonthlyPaise,
        priceYearlyPaise: plan.priceYearlyPaise,
        maxDevices: plan.maxDevices,
        maxStores: plan.maxStores,
        maxStaff: plan.maxStaff,
        featuresJson: JSON.stringify(plan.features),
        isActive: code !== "standard",
      },
      create: {
        code,
        name: plan.name,
        priceMonthlyPaise: plan.priceMonthlyPaise,
        priceYearlyPaise: plan.priceYearlyPaise,
        maxDevices: plan.maxDevices,
        maxStores: plan.maxStores,
        maxStaff: plan.maxStaff,
        featuresJson: JSON.stringify(plan.features),
        isActive: code !== "standard",
      },
    });
  }
  console.log(`  ✅ ${PLAN_CODES.length} SaaS plans seeded`);

  // ── Shop ────────────────────────────────────────────────────
  const shop = await db.shop.upsert({
    where: { id: "demo-shop-001" },
    update: {},
    create: {
      id: "demo-shop-001",
      name: "Sharma General Store",
      ownerName: "Ramesh Sharma",
      city: "Jodhpur",
      address: "Near Ghanta Ghar, Sardarpura, Jodhpur, Rajasthan 342001",
      gstNumber: "08ABCDE1234F1Z5",
      phone: "0291-2512345",
    },
  });
  console.log(`  ✅ Shop: ${shop.name}`);

  // ── Owner User ───────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("demo1234", 10);
  const user = await db.user.upsert({
    where: { id: "demo-user-001" },
    update: {},
    create: {
      id: "demo-user-001",
      shopId: shop.id,
      name: "Ramesh Sharma",
      mobile: "9800000001",
      passwordHash,
      role: "owner",
    },
  });
  console.log(`  ✅ Owner: ${user.name} (mobile: 9800000001, password: demo1234)`);

  // ── Products ────────────────────────────────────────────────
  const products = [
    {
      id: "prod-001", name: "Shakkar (Sugar)", category: "grocery",
      aliasesJson: JSON.stringify(["sugar", "chini", "shakkar"]),
      displayUnit: "kg", baseUnit: "g", rateUnit: "kg",
      stockBaseQty: 50000, // 50 kg in grams
      costPerRateUnit: 40, minPricePerRateUnit: 42, defaultPricePerRateUnit: 45,
      gstRate: 5, lowStockThreshold: 5000,
    },
    {
      id: "prod-002", name: "Chawal (Rice)", category: "grocery",
      aliasesJson: JSON.stringify(["rice", "chawal"]),
      displayUnit: "kg", baseUnit: "g", rateUnit: "kg",
      stockBaseQty: 100000, // 100 kg
      costPerRateUnit: 38, minPricePerRateUnit: 40, defaultPricePerRateUnit: 44,
      gstRate: 5, lowStockThreshold: 10000,
    },
    {
      id: "prod-003", name: "Atta (Wheat Flour)", category: "grocery",
      aliasesJson: JSON.stringify(["atta", "flour", "gehun atta"]),
      displayUnit: "kg", baseUnit: "g", rateUnit: "kg",
      stockBaseQty: 80000,
      costPerRateUnit: 28, minPricePerRateUnit: 30, defaultPricePerRateUnit: 34,
      gstRate: 0, lowStockThreshold: 10000,
    },
    {
      id: "prod-004", name: "Tel (Mustard Oil)", category: "grocery",
      aliasesJson: JSON.stringify(["tel", "oil", "sarson ka tel", "mustard oil"]),
      displayUnit: "ltr", baseUnit: "ml", rateUnit: "ltr",
      stockBaseQty: 20000, // 20 litres
      costPerRateUnit: 140, minPricePerRateUnit: 145, defaultPricePerRateUnit: 155,
      gstRate: 5, lowStockThreshold: 2000,
    },
    {
      id: "prod-005", name: "Dal (Moong)", category: "grocery",
      aliasesJson: JSON.stringify(["dal", "moong dal", "moong"]),
      displayUnit: "kg", baseUnit: "g", rateUnit: "kg",
      stockBaseQty: 30000,
      costPerRateUnit: 95, minPricePerRateUnit: 100, defaultPricePerRateUnit: 110,
      gstRate: 0, lowStockThreshold: 5000,
    },
    {
      id: "prod-006", name: "Namak (Salt)", category: "grocery",
      aliasesJson: JSON.stringify(["namak", "salt"]),
      displayUnit: "kg", baseUnit: "g", rateUnit: "kg",
      stockBaseQty: 25000,
      costPerRateUnit: 10, minPricePerRateUnit: 12, defaultPricePerRateUnit: 15,
      gstRate: 0, lowStockThreshold: 5000,
    },
    {
      id: "prod-007", name: "Doodh (Milk)", category: "dairy",
      aliasesJson: JSON.stringify(["milk", "doodh"]),
      displayUnit: "ltr", baseUnit: "ml", rateUnit: "ltr",
      stockBaseQty: 5000,
      costPerRateUnit: 52, minPricePerRateUnit: 54, defaultPricePerRateUnit: 58,
      gstRate: 0, lowStockThreshold: 1000,
    },
    {
      id: "prod-008", name: "Biscuit (Parle-G)", category: "snacks",
      aliasesJson: JSON.stringify(["biscuit", "parle g", "parly"]),
      displayUnit: "piece", baseUnit: "piece", rateUnit: "piece",
      stockBaseQty: 120,
      costPerRateUnit: 5, minPricePerRateUnit: 5, defaultPricePerRateUnit: 6,
      gstRate: 12, lowStockThreshold: 20,
    },
    {
      id: "prod-009", name: "Sabun (Bathing Soap)", category: "personal care",
      aliasesJson: JSON.stringify(["soap", "sabun", "lux", "lifebuoy"]),
      displayUnit: "piece", baseUnit: "piece", rateUnit: "piece",
      stockBaseQty: 60,
      costPerRateUnit: 22, minPricePerRateUnit: 24, defaultPricePerRateUnit: 28,
      gstRate: 18, lowStockThreshold: 10,
    },
    {
      id: "prod-010", name: "Chai Patti (Tea)", category: "beverages",
      aliasesJson: JSON.stringify(["tea", "chai", "chai patti", "wagh bakri", "tata tea"]),
      displayUnit: "kg", baseUnit: "g", rateUnit: "kg",
      stockBaseQty: 10000,
      costPerRateUnit: 300, minPricePerRateUnit: 320, defaultPricePerRateUnit: 360,
      gstRate: 5, lowStockThreshold: 1000,
    },
  ];

  for (const p of products) {
    await db.product.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, shopId: shop.id },
    });
  }
  console.log(`  ✅ ${products.length} products created`);

  // ── Customer with Udhar ─────────────────────────────────────
  const customer = await db.customer.upsert({
    where: { id: "demo-customer-001" },
    update: {},
    create: {
      id: "demo-customer-001",
      shopId: shop.id,
      name: "Mohan Lal Verma",
      mobile: "9876500003",
      type: "udhar",
      udharAmount: 350,
    },
  });
  console.log(`  ✅ Udhar customer: ${customer.name} (₹${customer.udharAmount} outstanding)`);

  // Seed an udhar ledger entry for this customer
  await db.udharLedger.upsert({
    where: { id: "demo-udhar-001" },
    update: {},
    create: {
      id: "demo-udhar-001",
      shopId: shop.id,
      customerId: customer.id,
      customerName: customer.name,
      type: "debit",
      amount: 350,
      mode: "credit",
      note: "Opening balance",
    },
  });

  // ── Supplier ────────────────────────────────────────────────
  const supplier = await db.supplier.upsert({
    where: { id: "demo-supplier-001" },
    update: {},
    create: {
      id: "demo-supplier-001",
      shopId: shop.id,
      name: "Agarwal Whole Sale",
      mobile: "9800000099",
      address: "Tripolia Bazar, Jodhpur",
    },
  });
  console.log(`  ✅ Supplier: ${supplier.name}`);

  console.log("\n✨ Seed complete!");
  console.log("─────────────────────────────────────────");
  console.log("  Login mobile  : 9800000001");
  console.log("  Password      : demo1234");
  console.log("  Shop ID       : demo-shop-001");
  console.log("─────────────────────────────────────────");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
