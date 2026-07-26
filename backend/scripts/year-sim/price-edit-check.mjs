/**
 * Does a price edit actually take effect, and can the item still be sold?
 *
 * Reproduces the two payload shapes a client can send to PATCH /products/:id:
 *   A. product fields only (API/bulk/CSV client)
 *   B. product fields + the product's existing sellingUnits re-sent unchanged
 *      (what frontend/src/features/products/local-actions.ts builds)
 */
import { makeClient, OWNER_PIN } from "./lib.mjs";

const client = makeClient({ deviceId: "price-edit-check-device" });
const mobile = `9${Math.floor(Math.random() * 900000000) + 100000000}`;

const session = await client.post("/auth/register", {
  shopName: "Price Edit Check", ownerName: "Test Owner", city: "Pune",
  address: "1, Test Street, Pune 411001", mobile,
  password: "Kirana@2025", ownerPin: OWNER_PIN,
});
client.setToken(session.accessToken ?? session.token);

async function scenario(label, buildPatch) {
  const created = await client.post("/products", {
    name: `Probe ${label} ${Date.now()}`,
    category: "general", displayUnit: "piece", baseUnit: "piece", rateUnit: "piece",
    stockBaseQty: 100, costPerRateUnit: 80, minPricePerRateUnit: 82,
    defaultPricePerRateUnit: 100, mrp: 110, gstRate: 5, hsn: "1006",
  });
  const before = await client.get(`/products/${created.id}`);
  await client.patch(`/products/${created.id}`, buildPatch(before));
  const after = await client.get(`/products/${created.id}`);
  const unit = (after.sellingUnits ?? [])[0] ?? {};

  let sale = "not attempted";
  try {
    await client.post("/bills/confirm", {
      billType: "normal_sale", gstMode: "inclusive", customerName: "Walk-in",
      items: [{
        productId: after.id, name: after.name, quantity: 1, enteredUnit: "piece",
        ratePerRateUnit: after.defaultPricePerRateUnit, gstRate: after.gstRate, lineDiscount: 0,
      }],
      discount: 0,
      payments: [{ mode: "cash", amount: after.defaultPricePerRateUnit }],
    });
    sale = "SOLD OK";
  } catch (err) {
    sale = `REJECTED — ${String(err.body?.error ?? err.message).slice(0, 90)}`;
  }

  console.log(`\n${label}`);
  console.log(`  asked for      price 120, mrp 130`);
  console.log(`  product row    price ${after.defaultPricePerRateUnit}, mrp ${after.mrp}`);
  console.log(`  selling unit   defaultPrice ${unit.defaultPrice}, maximumPrice ${unit.maximumPrice}`);
  console.log(`  sell at listed price → ${sale}`);
}

await scenario("A. product fields only (API / bulk / CSV client)", () => ({
  defaultPricePerRateUnit: 120, mrp: 130, minPricePerRateUnit: 82,
}));

await scenario("B. product fields + existing sellingUnits re-sent (frontend shape)", (before) => ({
  defaultPricePerRateUnit: 120, mrp: 130, minPricePerRateUnit: 82,
  sellingUnits: (before.sellingUnits ?? []).map((u) => ({
    id: u.id, name: u.name, unitType: u.unitType, unitCode: u.unitCode,
    packSizeValue: u.packSizeValue, packSizeUnit: u.packSizeUnit,
    conversionToBase: u.conversionToBase, barcode: u.barcode,
    defaultPrice: u.defaultPrice, minimumPrice: u.minimumPrice,
    maximumPrice: u.maximumPrice, costPrice: u.costPrice,
    isDefault: u.isDefault, isActive: u.isActive,
  })),
}));
