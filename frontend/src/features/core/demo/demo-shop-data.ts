import { offlineDB } from "@/lib/offline/db";

const DEMO_SETTING_KEY = "demo:shop-data:v1";

function todayIso(hour: number, minute = 0) {
  const now = new Date();
  now.setHours(hour, minute, 0, 0);
  return now.toISOString();
}

function row<T extends Record<string, unknown>>(value: T): T {
  return {
    demo_data: true,
    sync_status: "synced",
    ...value,
  };
}

/**
 * What the four demo products are called in each trade.
 *
 * Ids and selling prices are deliberately untouched: every bill, payment,
 * ledger row and stock movement below is written against those ids and adds up
 * to those prices, so renaming is the only safe thing to vary. Costs are
 * derived figures and move with the trade — a kitchen does not run a 88% food
 * cost on a curry.
 *
 * A demo is a sales tool. Offering a cafe owner "Aashirvaad Atta 5kg" as their
 * sample menu is worse than offering nothing: it says the software was built
 * for a different shop and nobody thought about theirs.
 */
type DemoItem = { name: string; category: string; unit: string; cost: number };

const DEMO_CATALOGUE: Record<string, Record<string, DemoItem>> = {
  restaurant: {
    demo_product_atta:  { name: "Paneer Butter Masala", category: "Main Course", unit: "plate", cost: 78 },
    demo_product_rice:  { name: "Jeera Rice",           category: "Main Course", unit: "plate", cost: 34 },
    demo_product_sugar: { name: "Masala Chai",          category: "Beverages",   unit: "glass", cost: 11 },
    demo_product_tea:   { name: "Butter Naan (2)",      category: "Breads",      unit: "plate", cost: 38 },
  },
};

const UNIT_FIELDS = ["displayUnit", "rateUnit", "baseUnit", "stockUnit", "unit", "display_unit", "rate_unit"];
const COST_FIELDS = ["costPrice", "costPerRateUnit", "cost_per_rate_unit", "averageCostPrice"];

/** Rewrite a seeded row into the trade's own vocabulary, leaving ids and totals alone. */
function localiseDemoRow(businessType: string | undefined, value: Record<string, unknown>) {
  const catalogue = DEMO_CATALOGUE[businessType ?? ""];
  if (!catalogue) return value;
  const key = (value.productId ?? value.product_id ?? value.id) as string | undefined;
  const item = key ? catalogue[key] : undefined;
  if (!item) return value;

  const next: Record<string, unknown> = { ...value };
  if (typeof next.name === "string") next.name = item.name;
  if (typeof next.category === "string") next.category = item.category;
  for (const field of UNIT_FIELDS) if (typeof next[field] === "string") next[field] = item.unit;
  for (const field of COST_FIELDS) if (typeof next[field] === "number") next[field] = item.cost;
  return next;
}

export async function seedDemoShopData(businessType?: string): Promise<{ created: boolean }> {
  const put = (table: string, values: Record<string, unknown>[]) =>
    offlineDB.putMany(table, values.map((value) => localiseDemoRow(businessType, value)));
  const existing = await offlineDB.getSetting<{ seededAt: string }>(DEMO_SETTING_KEY).catch(() => null);
  if (existing?.seededAt) return { created: false };

  const createdAt = todayIso(9);
  const billAt = todayIso(11, 20);
  const paymentAt = todayIso(11, 22);
  const purchaseAt = todayIso(8, 30);

  await put("products", [
    row({
      id: "demo_product_atta",
      name: "Aashirvaad Atta 5kg",
      category: "Grocery",
      displayUnit: "bag",
      rateUnit: "bag",
      defaultPricePerRateUnit: 265,
      sellingPrice: 265,
      costPrice: 232,
      stockBaseQty: 24,
      lowStockThreshold: 8,
      aliases: ["atta", "flour"],
      createdAt,
      created_at: createdAt,
    }),
    row({
      id: "demo_product_rice",
      name: "Basmati Rice 1kg",
      category: "Grocery",
      displayUnit: "kg",
      rateUnit: "kg",
      defaultPricePerRateUnit: 118,
      sellingPrice: 118,
      costPrice: 94,
      stockBaseQty: 42,
      lowStockThreshold: 12,
      aliases: ["rice", "chawal"],
      createdAt,
      created_at: createdAt,
    }),
    row({
      id: "demo_product_sugar",
      name: "Sugar 1kg",
      category: "Grocery",
      displayUnit: "kg",
      rateUnit: "kg",
      defaultPricePerRateUnit: 46,
      sellingPrice: 46,
      costPrice: 39,
      stockBaseQty: 7,
      lowStockThreshold: 10,
      aliases: ["sugar", "chini"],
      createdAt,
      created_at: createdAt,
    }),
    row({
      id: "demo_product_tea",
      name: "Tata Tea 250g",
      category: "Beverage",
      displayUnit: "pack",
      rateUnit: "pack",
      defaultPricePerRateUnit: 145,
      sellingPrice: 145,
      costPrice: 121,
      stockBaseQty: 18,
      lowStockThreshold: 6,
      aliases: ["tea", "chai"],
      createdAt,
      created_at: createdAt,
    }),
  ]);

  await put("customers", [
    row({
      id: "demo_customer_ramesh",
      name: "Ramesh Kumar",
      mobile: "9876543210",
      type: "udhar",
      udharAmount: 360,
      totalUdhar: 360,
      createdAt,
      created_at: createdAt,
    }),
  ]);

  await put("suppliers", [
    row({
      id: "demo_supplier_wholesale",
      name: "City Wholesale",
      mobile: "9000000001",
      address: "Main Market",
      createdAt,
      created_at: createdAt,
    }),
  ]);

  await put("bills", [
    row({
      id: "demo_bill_today",
      billNo: "DEMO-1001",
      billNumber: "DEMO-1001",
      billType: "normal_sale",
      status: "paid",
      customerId: "demo_customer_ramesh",
      customer_id: "demo_customer_ramesh",
      customerName: "Ramesh Kumar",
      customerMobile: "9876543210",
      grandTotal: 574,
      totalAmount: 574,
      subtotal: 574,
      discount: 0,
      paidAmount: 454,
      buyerPaidAmount: 454,
      creditAmount: 120,
      cashAmount: 300,
      upiAmount: 154,
      grossProfit: 88,
      createdAt: billAt,
      created_at: billAt,
    }),
  ]);

  await put("bill_items", [
    row({
      id: "demo_item_atta",
      billId: "demo_bill_today",
      bill_id: "demo_bill_today",
      productId: "demo_product_atta",
      product_id: "demo_product_atta",
      name: "Aashirvaad Atta 5kg",
      quantity: 1,
      ratePerRateUnit: 265,
      rate_per_rate_unit: 265,
      costPerRateUnit: 232,
      cost_per_rate_unit: 232,
      line_total: 265,
      createdAt: billAt,
      created_at: billAt,
    }),
    row({
      id: "demo_item_rice",
      billId: "demo_bill_today",
      bill_id: "demo_bill_today",
      productId: "demo_product_rice",
      product_id: "demo_product_rice",
      name: "Basmati Rice 1kg",
      quantity: 1,
      ratePerRateUnit: 118,
      rate_per_rate_unit: 118,
      costPerRateUnit: 94,
      cost_per_rate_unit: 94,
      line_total: 118,
      createdAt: billAt,
      created_at: billAt,
    }),
    row({
      id: "demo_item_sugar",
      billId: "demo_bill_today",
      bill_id: "demo_bill_today",
      productId: "demo_product_sugar",
      product_id: "demo_product_sugar",
      name: "Sugar 1kg",
      quantity: 1,
      ratePerRateUnit: 46,
      rate_per_rate_unit: 46,
      costPerRateUnit: 39,
      cost_per_rate_unit: 39,
      line_total: 46,
      createdAt: billAt,
      created_at: billAt,
    }),
    row({
      id: "demo_item_tea",
      billId: "demo_bill_today",
      bill_id: "demo_bill_today",
      productId: "demo_product_tea",
      product_id: "demo_product_tea",
      name: "Tata Tea 250g",
      quantity: 1,
      ratePerRateUnit: 145,
      rate_per_rate_unit: 145,
      costPerRateUnit: 121,
      cost_per_rate_unit: 121,
      line_total: 145,
      createdAt: billAt,
      created_at: billAt,
    }),
  ]);

  await put("payments", [
    row({
      id: "demo_payment_cash",
      billId: "demo_bill_today",
      bill_id: "demo_bill_today",
      customerId: "demo_customer_ramesh",
      customer_id: "demo_customer_ramesh",
      mode: "cash",
      amount: 300,
      paidAt: paymentAt,
      paid_at: paymentAt,
      createdAt: paymentAt,
      created_at: paymentAt,
    }),
    row({
      id: "demo_payment_upi",
      billId: "demo_bill_today",
      bill_id: "demo_bill_today",
      customerId: "demo_customer_ramesh",
      customer_id: "demo_customer_ramesh",
      mode: "upi",
      amount: 154,
      paidAt: paymentAt,
      paid_at: paymentAt,
      createdAt: paymentAt,
      created_at: paymentAt,
    }),
  ]);

  await put("customer_ledger", [
    row({
      id: "demo_ledger_old_udhar",
      customerId: "demo_customer_ramesh",
      customer_id: "demo_customer_ramesh",
      type: "BILL",
      source_type: "BILL",
      amount: 240,
      entry_at: todayIso(8),
      createdAt: todayIso(8),
      created_at: todayIso(8),
      note: "Previous udhar",
    }),
    row({
      id: "demo_ledger_today_udhar",
      customerId: "demo_customer_ramesh",
      customer_id: "demo_customer_ramesh",
      type: "BILL",
      source_type: "BILL",
      source_id: "demo_bill_today",
      billId: "demo_bill_today",
      bill_id: "demo_bill_today",
      amount: 120,
      entry_at: billAt,
      createdAt: billAt,
      created_at: billAt,
      note: "Udhar from DEMO-1001",
    }),
  ]);

  await put("inventory_movements", [
    row({
      id: "demo_purchase_sugar",
      productId: "demo_product_sugar",
      product_id: "demo_product_sugar",
      productName: "Sugar 1kg",
      product_name: "Sugar 1kg",
      action: "purchase",
      type: "purchase",
      quantityDelta: 25,
      quantity_delta: 25,
      unit: "kg",
      supplierId: "demo_supplier_wholesale",
      supplier_id: "demo_supplier_wholesale",
      supplierName: "City Wholesale",
      supplier_name: "City Wholesale",
      supplierBillNo: "CW-4512",
      supplier_bill_no: "CW-4512",
      billAmount: 1250,
      bill_amount: 1250,
      purchasePaymentStatus: "partial",
      purchase_payment_status: "partial",
      purchasePaymentMode: "cash",
      purchase_payment_mode: "cash",
      purchasePaidAmount: 800,
      purchase_paid_amount: 800,
      purchaseDueAmount: 450,
      purchase_due_amount: 450,
      createdAt: purchaseAt,
      created_at: purchaseAt,
    }),
  ]);

  await offlineDB.setSetting(DEMO_SETTING_KEY, { seededAt: new Date().toISOString() });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kirana:local-data-changed"));
    window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"));
  }

  return { created: true };
}

// Every demo row is tagged demo_data:true with a "demo_" id and written sync_status:"synced"
// (never enqueued), so demo data is local-only and never reaches the server. That makes both
// detection and removal a pure local-data operation — no sync deletes required.
const DEMO_TABLES = [
  "products",
  "customers",
  "suppliers",
  "bills",
  "bill_items",
  "payments",
  "customer_ledger",
  "inventory_movements",
  "local_audit_logs",
];

function isDemoRow(row: Record<string, unknown> | undefined): boolean {
  if (!row) return false;
  return row.demo_data === true || String(row.id ?? "").startsWith("demo_");
}

/** True if any demo sample data is currently present locally. */
export async function hasDemoData(): Promise<boolean> {
  for (const table of ["products", "bills"]) {
    const rows = await offlineDB.getAll<Record<string, unknown>>(table).catch(() => []);
    if (rows.some(isDemoRow)) return true;
  }
  return false;
}

/**
 * Removes every demo sample record (Start fresh). Safe because demo rows are local-only and
 * tagged; real records the user added are left untouched. Also resets the seed guard so the
 * "Load demo shop data" button can be used again later.
 */
export async function clearDemoShopData(): Promise<{ removed: number }> {
  let removed = 0;
  for (const table of DEMO_TABLES) {
    const rows = await offlineDB.getAll<Record<string, unknown>>(table).catch(() => []);
    for (const r of rows) {
      if (isDemoRow(r) && typeof r.id === "string") {
        await offlineDB.delete(table, r.id).catch(() => {});
        removed += 1;
      }
    }
  }
  // Catch pre-fix orphans: any local row whose serialized contents reference a demo_ id
  // (a real bill made with a demo product before the demo-tag fix, the audit logs that go
  // with it, and the CONFLICT outbox op that will never sync). The server doesn't know
  // demo_ ids, so this data is unrecoverable — better cleaned than left dangling.
  const orphanRegex = /(^|")demo_/;
  const sweepTables: { table: string; keyFields: string[] }[] = [
    { table: "bills", keyFields: ["id"] },
    { table: "bill_items", keyFields: ["id"] },
    { table: "payments", keyFields: ["id"] },
    { table: "customer_ledger", keyFields: ["id"] },
    { table: "inventory_movements", keyFields: ["id"] },
    { table: "local_audit_logs", keyFields: ["id"] },
    // sync_outbox's Dexie primary key is `clientEventId`, not `id`.
    { table: "sync_outbox", keyFields: ["clientEventId", "op_id", "id"] },
  ];
  for (const { table, keyFields } of sweepTables) {
    const rows = await offlineDB.getAll<Record<string, unknown>>(table).catch(() => []);
    for (const r of rows) {
      const ref = JSON.stringify(r);
      if (!orphanRegex.test(ref)) continue;
      let key: string | null = null;
      for (const f of keyFields) {
        const v = r[f];
        if (typeof v === "string" && v) { key = v; break; }
      }
      if (!key) continue;
      await offlineDB.delete(table, key).catch(() => {});
      removed += 1;
    }
  }
  await offlineDB.setSetting(DEMO_SETTING_KEY, null).catch(() => {});
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kirana:local-data-changed"));
    window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"));
  }
  return { removed };
}
