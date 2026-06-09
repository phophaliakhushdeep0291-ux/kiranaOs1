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

export async function seedDemoShopData(): Promise<{ created: boolean }> {
  const existing = await offlineDB.getSetting<{ seededAt: string }>(DEMO_SETTING_KEY).catch(() => null);
  if (existing?.seededAt) return { created: false };

  const createdAt = todayIso(9);
  const billAt = todayIso(11, 20);
  const paymentAt = todayIso(11, 22);
  const purchaseAt = todayIso(8, 30);

  await offlineDB.putMany("products", [
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

  await offlineDB.putMany("customers", [
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

  await offlineDB.putMany("suppliers", [
    row({
      id: "demo_supplier_wholesale",
      name: "City Wholesale",
      mobile: "9000000001",
      address: "Main Market",
      createdAt,
      created_at: createdAt,
    }),
  ]);

  await offlineDB.putMany("bills", [
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
      paidAmount: 454,
      buyerPaidAmount: 454,
      creditAmount: 120,
      cashAmount: 300,
      upiAmount: 154,
      grossProfit: 104,
      createdAt: billAt,
      created_at: billAt,
    }),
  ]);

  await offlineDB.putMany("bill_items", [
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
      quantity: 2,
      ratePerRateUnit: 118,
      rate_per_rate_unit: 118,
      costPerRateUnit: 94,
      cost_per_rate_unit: 94,
      line_total: 236,
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

  await offlineDB.putMany("payments", [
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

  await offlineDB.putMany("customer_ledger", [
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

  await offlineDB.putMany("inventory_movements", [
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
