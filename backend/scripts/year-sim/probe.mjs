/** Diagnostic: replay a sim-shaped bill against the live server and print the error. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeClient, r2, toPaise, OWNER_PIN } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");

const mobile = process.env.PROBE_MOBILE;
const shopId = process.env.PROBE_SHOP;
const client = makeClient({ deviceId: "sim-probe-device", pin: OWNER_PIN });

const session = await client.post("/auth/login", { mobile, password: "Kirana@2025", shopId });
client.setToken(session.accessToken ?? session.token);

const products = await client.get("/products");
const list = Array.isArray(products) ? products : (products.products ?? []);
console.log(`fetched ${list.length} products`);

const sample = list.slice(0, 6);
for (const p of sample) {
  console.log(`${p.name}: price=${p.defaultPricePerRateUnit} mrp=${p.mrp} min=${p.minPricePerRateUnit} cost=${p.costPerRateUnit} rateUnit=${p.rateUnit} stock=${p.stockBaseQty}`);
}

async function tryBill(label, items, extra = {}) {
  let subtotalPaise = 0;
  for (const it of items) subtotalPaise += toPaise(r2(it.ratePerRateUnit * it.quantity));
  const grandTotal = subtotalPaise / 100;
  const payload = {
    billType: "normal_sale", gstMode: "inclusive", customerName: "Probe",
    items, discount: 0, payments: [{ mode: "cash", amount: grandTotal }],
    creditAmount: 0, waivedAmount: 0, sensitiveActions: [], ...extra,
  };
  try {
    const bill = await client.post("/bills/confirm", payload);
    console.log(`  OK   ${label} → ${bill.billNo ?? bill.bill?.billNo} total ${grandTotal}`);
    return bill;
  } catch (err) {
    console.log(`  FAIL ${label} → ${err.message.slice(0, 260)}`);
    return null;
  }
}

for (const p of list.slice(0, 12)) {
  const quantity = p.rateUnit === "kg" || p.rateUnit === "l" ? 1 : 1;
  await tryBill(p.name, [{
    productId: p.id, name: p.name, quantity,
    enteredUnit: p.rateUnit, ratePerRateUnit: p.defaultPricePerRateUnit,
    gstRate: p.gstRate, hsn: p.hsn ?? undefined, lineDiscount: 0,
  }]);
}

fs.writeFileSync(path.join(OUT, "probe-products.json"), JSON.stringify(list.slice(0, 40), null, 2));
