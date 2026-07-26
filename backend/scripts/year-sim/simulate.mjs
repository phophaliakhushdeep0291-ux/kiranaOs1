/**
 * ONE-YEAR KIRANA SHOP SIMULATION
 *
 * Drives the real HTTP API (no direct DB writes for business data) for 365
 * simulated days: catalog, suppliers, staff, customers, purchases, bills,
 * udhar, returns, damages, stock counts, purchase orders, offers, loyalty,
 * gift cards and expenses.
 *
 * Because the API stamps createdAt = now(), each simulated day is written and
 * then back-dated in place with Prisma so the year of history is real for every
 * report. Nothing else about the business logic is bypassed.
 *
 *   DATABASE_URL="file:./yearsim.db" SIM_DAYS=365 node scripts/year-sim/simulate.mjs
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTS, LATE_LAUNCH, SUPPLIERS, buildCustomers, MONTHLY_EXPENSES, AD_HOC_EXPENSES, FESTIVALS, OFFER_PLAN,
} from "./catalog.mjs";
import {
  makeRng, pick, between, intBetween, weightedPick, r2, toPaise, iso, addDays, atTime,
  makeClient, baseUnitsFor, ApiError, OWNER_PIN,
} from "./lib.mjs";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SIM_OUT ?? path.join(HERE, "out");
fs.mkdirSync(OUT, { recursive: true });

const DAYS = Number(process.env.SIM_DAYS ?? 365);
const START = new Date(2025, 6, 26); // 26 Jul 2025
const rng = makeRng(Number(process.env.SIM_SEED ?? 20260725));

const owner = makeClient({ deviceId: "sim-counter-desktop-01" });
const staffClients = [];

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const stats = {
  bills: 0, estimates: 0, returns: 0, cancelled: 0, items: 0, revenue: 0,
  purchases: 0, purchaseValue: 0, expenses: 0, expenseValue: 0,
  udharPayments: 0, udharCollected: 0, creditSales: 0, creditValue: 0,
  damages: 0, corrections: 0, offersApplied: 0, offerDiscount: 0,
  loyaltyRedemptions: 0, giftCardsIssued: 0, giftCardRedemptions: 0,
  stockCounts: 0, purchaseOrders: 0, waived: 0, waivedValue: 0, discounts: 0, discountValue: 0,
  newCustomers: 0, newProducts: 0, priceRevisions: 0, apiErrors: [],
};

// ── back-dating ────────────────────────────────────────────────────
const BACKDATE_MODELS = [
  "bill", "billItem", "payment", "udharLedger", "stockLedger", "purchaseHistory",
  "expense", "customer", "product", "supplier", "offer", "loyaltyAccount",
  "loyaltyTransaction", "auditLog", "financialLedger", "giftCard", "giftCardTransaction",
  "purchaseOrder", "purchaseOrderItem", "purchaseReceipt", "purchaseReceiptItem",
  "stockCountSession", "stockCountLine", "inventoryLot", "complianceDocument",
  "productSellingUnit", "billItemLotAllocation",
];
const badModels = new Set();

/**
 * The day-by-day back-dating pass scans on createdAt. Without an index that is
 * a full table scan of Bill/StockLedger/AuditLog on every one of 365 days.
 */
async function indexCreatedAt() {
  for (const model of BACKDATE_MODELS) {
    const table = model[0].toUpperCase() + model.slice(1);
    try {
      await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "sim_${table}_createdAt" ON "${table}"("createdAt")`);
    } catch { /* table has no createdAt column */ }
  }
}

async function backdate(mark, ts) {
  for (const model of BACKDATE_MODELS) {
    if (badModels.has(model)) continue;
    try {
      await db[model].updateMany({ where: { createdAt: { gte: mark } }, data: { createdAt: ts } });
    } catch (err) {
      badModels.add(model);
      log(`  (backdate skipped for ${model}: ${err.message.split("\n")[0]})`);
    }
  }
}

// ── demand model ───────────────────────────────────────────────────
const WEEKDAY = [1.22, 0.9, 0.94, 0.98, 1.0, 1.09, 1.18]; // Sun..Sat
const MONTH = { 0: 1.0, 1: 0.95, 2: 1.06, 3: 1.02, 4: 1.06, 5: 0.97, 6: 0.95, 7: 1.0, 8: 1.03, 9: 1.26, 10: 1.12, 11: 1.08 };
const festivalIndex = new Map();
for (const f of FESTIVALS) {
  const d = new Date(`${f.date}T00:00:00`);
  for (let back = 0; back <= f.ramp; back += 1) {
    const key = iso(addDays(d, -back));
    const boost = 1 + (f.boost - 1) * (1 - back / (f.ramp + 1));
    festivalIndex.set(key, Math.max(festivalIndex.get(key) ?? 1, boost));
  }
}

function seasonFactor(season, month) {
  if (season === "summer") return [0.5, 0.5, 0.8, 1.6, 2.1, 1.9, 1.3, 1.1, 0.9, 0.8, 0.6, 0.5][month];
  if (season === "winter") return [1.5, 1.4, 1.1, 0.9, 0.7, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6][month];
  if (season === "monsoon") return [0.9, 0.9, 0.9, 0.95, 1.0, 1.3, 1.5, 1.4, 1.2, 1.0, 0.95, 0.9][month];
  if (season === "festive") return [0.9, 0.9, 1.3, 0.95, 0.9, 0.9, 0.9, 1.2, 1.3, 2.0, 1.4, 1.0][month];
  return 1;
}

function dayFactor(date, dayIndex) {
  const growth = 1 + 0.2 * (dayIndex / Math.max(1, DAYS));
  const salaryWeek = date.getDate() <= 6 ? 1.12 : date.getDate() >= 26 ? 0.92 : 1;
  const festival = festivalIndex.get(iso(date)) ?? 1;
  const noise = between(rng, 0.86, 1.14);
  return WEEKDAY[date.getDay()] * MONTH[date.getMonth()] * growth * salaryWeek * festival * noise;
}

// ── world state ────────────────────────────────────────────────────
const world = {
  shop: null, ownerUser: null,
  suppliers: [], products: [], customers: [],
  offers: [], activeGiftCards: [], recentBills: [], pendingReturns: [],
  loyaltyEnabled: false,
};

const PERISHABLE = new Set(["dairy", "vegetables", "bakery"]);

// ── setup ──────────────────────────────────────────────────────────
async function register() {
  const mobile = `98${String(Math.floor(rng() * 90000000) + 10000000)}`;
  const data = await owner.post("/auth/register", {
    shopName: "Shree Ganesh Kirana & General Stores",
    ownerName: "Mahesh Patil",
    city: "Pune",
    address: "Shop No. 4, Balaji Complex, Sinhagad Road, Pune 411041",
    mobile,
    email: `mahesh.kirana.${Date.now()}@example.com`,
    password: "Kirana@2025",
    ownerPin: OWNER_PIN,
    gstNumber: "27AAGCS9012K1Z3",
    phone: "02024567890",
  });
  owner.setToken(data.accessToken ?? data.token);
  world.shop = data.shop;
  world.ownerUser = data.user;
  world.ownerMobile = mobile;
  log(`Registered shop ${data.shop.name} (${data.shop.id}) owner mobile ${mobile}`);
}

async function upgradeToPro() {
  // A full-feature run needs the Pro plan. Manual activation is disabled in the
  // API by design (payments-only), so the simulation grants it at the data layer.
  await db.plan.updateMany({ where: { code: "pro" }, data: { maxDevices: 12, maxStaff: 12, maxStores: 5 } });
  const subscriptionData = {
    planCode: "pro", status: "active", provider: "admin",
    currentPeriodStart: new Date(2025, 6, 1),
    currentPeriodEnd: new Date(2027, 0, 1),
    trialEndsAt: null, graceEndsAt: new Date(2027, 1, 1), cancelledAt: null,
  };
  await db.subscription.upsert({
    where: { shopId: world.shop.id },
    create: { shopId: world.shop.id, ...subscriptionData },
    update: subscriptionData,
  });
  await db.shop.update({ where: { id: world.shop.id }, data: { createdAt: new Date(2025, 6, 20) } });
  log("Subscription upgraded to Pro (active through 2027-01-01)");
}

async function createStaff() {
  const people = [
    { name: "Ravi Kamble", mobile: "9822771144", role: "staff", device: "sim-counter-2-tablet" },
    { name: "Sunil Waghmare", mobile: "9822771155", role: "admin", device: "sim-manager-mobile" },
  ];
  for (const person of people) {
    await owner.post("/auth/staff", { name: person.name, mobile: person.mobile, password: "Staff@2025", role: person.role });
    const client = makeClient({ deviceId: person.device });
    const session = await client.post("/auth/login", { mobile: person.mobile, password: "Staff@2025", shopId: world.shop.id });
    client.setToken(session.accessToken ?? session.token);
    staffClients.push({ ...person, client });
  }
  log(`Created ${staffClients.length} staff logins`);
}

async function createSuppliers() {
  for (const s of SUPPLIERS) {
    const created = await owner.post("/suppliers", { name: s.name, mobile: s.mobile, address: s.address });
    world.suppliers.push({ ...s, id: created.id });
  }
  log(`Created ${world.suppliers.length} suppliers`);
}

function supplierFor(category) {
  const match = world.suppliers.filter((s) => s.cats.includes(category));
  return (match.length ? match : world.suppliers)[0];
}

async function createProduct(def) {
  const u = baseUnitsFor(def.mode);
  const created = await owner.post("/products", {
    name: def.name,
    category: def.category,
    brand: def.brand || undefined,
    displayUnit: u.displayUnit,
    baseUnit: u.baseUnit,
    rateUnit: u.rateUnit,
    stockBaseQty: 0,
    costPerRateUnit: r2(def.cost),
    minPricePerRateUnit: r2(def.cost * 1.02),
    defaultPricePerRateUnit: r2(def.price),
    mrp: r2(def.mrp),
    gstRate: def.gst,
    hsn: def.hsn,
    sku: def.name.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase().slice(0, 24),
    reorderLevel: def.reorder,
    lowStockThreshold: def.reorder,
    isLooseItem: u.isLoose,
    description: def.packLabel ? `${def.packLabel}${def.brand ? ` · ${def.brand}` : ""}` : undefined,
  });
  const product = {
    ...def, id: created.id, ...u, stock: 0,
    cost: r2(def.cost), price: r2(def.price), mrp: r2(def.mrp),
  };
  world.products.push(product);
  stats.newProducts += 1;
  return product;
}

async function createCatalog() {
  const initial = PRODUCTS.filter((p) => !LATE_LAUNCH.has(p.name));
  for (const def of initial) await createProduct(def);
  log(`Created ${world.products.length} products (${LATE_LAUNCH.size} held back for mid-year launch)`);
}

async function enableLoyalty() {
  await owner.put("/loyalty/program", {
    active: true,
    pointsPerRupee: 0.1,          // 1 point per ₹10 spent
    redemptionPaisePerPoint: 25,  // 1 point = ₹0.25
    minimumRedeemPoints: 200,
    pointsExpireDays: 365,
    tiers: [
      { name: "Bronze", minLifetimePoints: 0 },
      { name: "Silver", minLifetimePoints: 1000 },
      { name: "Gold", minLifetimePoints: 5000 },
    ],
  });
  world.loyaltyEnabled = true;
  log("Loyalty program enabled (1 pt / ₹10, 1 pt = ₹0.25, min 200 pts)");
}

async function addCustomers(defs) {
  for (const c of defs) {
    try {
      const created = await owner.post("/customers", {
        name: c.name, mobile: c.mobile, address: c.address, type: c.type,
        gstNumber: c.gstNumber, stateCode: c.stateCode,
      });
      world.customers.push({ ...c, id: created.id, balance: 0, spent: 0, visits: 0 });
      stats.newCustomers += 1;
    } catch (err) {
      recordError("create-customer", err);
    }
  }
}

const errorCodes = new Map();

function recordError(where, err) {
  const detail = err instanceof ApiError ? `${err.status} ${JSON.stringify(err.body?.error ?? err.body)}` : err.message;
  const code = err instanceof ApiError ? (err.body?.code ?? `HTTP_${err.status}`) : "CLIENT_ERROR";
  const key = `${where}:${code}`;
  errorCodes.set(key, (errorCodes.get(key) ?? 0) + 1);
  stats.apiErrors.push(`${where}: ${detail}`.slice(0, 400));
  // log the first occurrence of every distinct failure, not the first N overall
  if (errorCodes.get(key) === 1) log(`  ! ${where}: ${detail}`.slice(0, 300));
}

// ── purchases ──────────────────────────────────────────────────────
async function restock(product, date, { multiplier = 2.5 } = {}) {
  const targetBase = product.reorder * multiplier;
  const needBase = targetBase - product.stock;
  if (needBase <= 0) return;
  const qtyInRate = product.isLoose ? Math.max(1, Math.round(needBase / product.factor)) : Math.max(1, Math.ceil(needBase));
  const supplier = supplierFor(product.category);
  const unitCost = r2(product.cost * between(rng, 0.985, 1.02));
  const billAmount = r2(unitCost * qtyInRate);
  if (billAmount <= 0) return;

  const roll = rng();
  let payment = { purchasePaymentStatus: "paid", purchasePaymentMode: pick(rng, ["cash", "upi", "bank"]), purchasePaidAmount: billAmount, purchaseDueAmount: 0 };
  if (roll > 0.62 && roll <= 0.86) {
    const paid = r2(billAmount * between(rng, 0.3, 0.7));
    payment = { purchasePaymentStatus: "partial", purchasePaymentMode: pick(rng, ["cash", "upi"]), purchasePaidAmount: paid, purchaseDueAmount: r2(billAmount - paid) };
  } else if (roll > 0.86) {
    payment = { purchasePaymentStatus: "due", purchasePaidAmount: 0, purchaseDueAmount: billAmount };
  }

  try {
    await owner.post("/inventory/purchase", {
      productId: product.id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      quantity: qtyInRate,
      enteredUnit: product.rateUnit,
      billAmount,
      invoiceNumber: `${supplier.name.slice(0, 3).toUpperCase()}/${iso(date).replace(/-/g, "")}/${intBetween(rng, 100, 999)}`,
      purchaseDueDate: payment.purchaseDueAmount > 0 ? iso(addDays(date, 21)) : undefined,
      note: `Stock-in ${iso(date)}`,
      updateCost: true,
      ...payment,
    });
    product.stock += qtyInRate * product.factor;
    stats.purchases += 1;
    stats.purchaseValue += billAmount;
  } catch (err) {
    recordError("purchase", err);
  }
}

// ── billing ────────────────────────────────────────────────────────
function looseQty() {
  const roll = rng();
  if (roll < 0.3) return 0.25;
  if (roll < 0.6) return 0.5;
  if (roll < 0.85) return 1;
  if (roll < 0.96) return 2;
  return 5;
}
function unitQty(product) {
  const roll = rng();
  if (roll < 0.62) return 1;
  if (roll < 0.85) return 2;
  if (roll < 0.95) return 3;
  return product.price < 25 ? intBetween(rng, 4, 12) : 4;
}

function buildBasket(date, sizeBias = 1) {
  const month = date.getMonth();
  const available = world.products.filter((p) => p.launched !== false);
  const roll = rng();
  let size = roll < 0.5 ? intBetween(rng, 1, 3) : roll < 0.85 ? intBetween(rng, 4, 6) : intBetween(rng, 7, 12);
  size = Math.max(1, Math.round(size * sizeBias));
  const chosen = new Map();
  for (let i = 0; i < size; i += 1) {
    const product = weightedPick(rng, available, (p) => p.pop * seasonFactor(p.season, month));
    if (chosen.has(product.id)) continue;
    const quantity = product.isLoose ? looseQty() : unitQty(product);
    chosen.set(product.id, { product, quantity });
  }
  return [...chosen.values()];
}

function priceLines(lines) {
  let subtotalPaise = 0;
  const items = [];
  for (const { product, quantity } of lines) {
    // occasional counter-level line discount on a big line
    const gross = r2(product.price * quantity);
    const lineDiscount = gross > 200 && rng() < 0.05 ? r2(Math.min(gross * 0.05, 25)) : 0;
    const lineTotal = r2(gross - lineDiscount);
    subtotalPaise += toPaise(lineTotal);
    items.push({
      productId: product.id,
      name: product.name,
      quantity,
      enteredUnit: product.rateUnit,
      ratePerRateUnit: product.price,
      gstRate: product.gst,
      hsn: product.hsn,
      lineDiscount,
    });
  }
  return { items, subtotal: subtotalPaise / 100 };
}

function liveOffer(date) {
  const today = iso(date);
  return world.offers.find((o) => o.from <= today && today <= o.to && o.used < o.usageLimit);
}

function offerDiscountFor(offer, subtotal) {
  if (subtotal < offer.minBillAmount) return 0;
  if (offer.type === "flat") return r2(Math.min(offer.value, subtotal));
  const raw = subtotal * (offer.value / 100);
  const capped = offer.maxDiscount > 0 ? Math.min(raw, offer.maxDiscount) : raw;
  return r2(Math.min(capped, subtotal));
}

async function makeBill(date, hour, { billType = "normal_sale", client = owner, actor = "owner" } = {}) {
  const lines = buildBasket(date, billType === "estimate" ? 1.4 : 1);
  if (!lines.length) return null;

  // customer selection
  let customer = null;
  if (rng() < 0.46 && world.customers.length) {
    customer = weightedPick(rng, world.customers, (c) => c.weight);
  }

  const { items, subtotal } = priceLines(lines);
  if (subtotal <= 0) return null;

  // coupon
  let offerId; let offerCode; let offerDiscount = 0;
  const offer = liveOffer(date);
  if (offer && rng() < 0.22) {
    const d = offerDiscountFor(offer, subtotal);
    if (d > 0) { offerId = offer.id; offerCode = offer.code; offerDiscount = d; }
  }

  // manual discount (always includes the coupon value — server requirement)
  let discount = offerDiscount;
  let discountReason;
  const sensitiveActions = [];
  if (rng() < 0.07) {
    const extra = r2(Math.min(between(rng, 5, 45), Math.max(0, subtotal - discount - 10)));
    if (extra > 0) {
      discount = r2(discount + extra);
      discountReason = pick(rng, ["Regular customer", "Round off request", "Bulk purchase", "Festival goodwill", "Damaged packaging"]);
      stats.discounts += 1; stats.discountValue += extra;
      if (extra > 35) sensitiveActions.push("large_discount");
    }
  }
  if (discount > subtotal) discount = subtotal;

  // loyalty redemption (occasional, owner-approved)
  let loyaltyPointsToRedeem;
  if (world.loyaltyEnabled && customer && rng() < 0.012 && subtotal > 300) {
    try {
      const account = await client.get(`/loyalty/accounts/${customer.id}`);
      const points = Number(account?.account?.pointsBalance ?? account?.pointsBalance ?? 0);
      if (points >= 200) {
        loyaltyPointsToRedeem = Math.min(Math.floor(points / 100) * 100, 800);
        sensitiveActions.push("loyalty_redemption");
      }
    } catch (err) { /* account may not exist yet */ }
  }
  const loyaltyDiscount = loyaltyPointsToRedeem ? r2((loyaltyPointsToRedeem * 25) / 100) : 0;
  const billDiscount = r2(discount + loyaltyDiscount);
  if (billDiscount > subtotal) { loyaltyPointsToRedeem = undefined; }
  const grandTotal = r2(subtotal - discount - (loyaltyPointsToRedeem ? loyaltyDiscount : 0));
  if (grandTotal <= 0) return null;

  // tender
  const payments = [];
  let creditAmount = 0;
  let waivedAmount = 0;
  const isUdharCustomer = customer?.type === "udhar";
  const roll = rng();

  if (billType !== "estimate" && isUdharCustomer && roll < 0.42) {
    // khata sale — fully or partly on credit
    if (rng() < 0.72) {
      creditAmount = grandTotal;
    } else {
      const part = r2(Math.max(1, Math.floor(grandTotal * between(rng, 0.2, 0.6))));
      payments.push({ mode: pick(rng, ["cash", "upi"]), amount: part });
      creditAmount = r2(grandTotal - part);
    }
    stats.creditSales += 1; stats.creditValue += creditAmount;
  } else {
    const modeRoll = rng();
    const giftCard = world.activeGiftCards.find((g) => g.balance >= 50);
    if (giftCard && modeRoll < 0.012 && grandTotal > 80) {
      const used = r2(Math.min(giftCard.balance, Math.floor(grandTotal * 0.6)));
      payments.push({ mode: "gift_card", amount: used, giftCardCode: giftCard.code });
      payments.push({ mode: "cash", amount: r2(grandTotal - used) });
      giftCard.balance = r2(giftCard.balance - used);
      stats.giftCardRedemptions += 1;
    } else if (modeRoll < 0.47) {
      // cash — kirana round-off ("chhod do") on the paise
      const fraction = r2(grandTotal - Math.floor(grandTotal));
      if (fraction > 0 && rng() < 0.55) {
        waivedAmount = fraction;
        stats.waived += 1; stats.waivedValue += fraction;
      }
      payments.push({ mode: "cash", amount: r2(grandTotal - waivedAmount) });
    } else if (modeRoll < 0.9) {
      payments.push({ mode: "upi", amount: grandTotal });
    } else if (modeRoll < 0.96) {
      const cash = r2(Math.max(1, Math.floor(grandTotal * between(rng, 0.3, 0.7))));
      payments.push({ mode: "cash", amount: cash });
      payments.push({ mode: "upi", amount: r2(grandTotal - cash) });
    } else {
      payments.push({ mode: "bank", amount: grandTotal });
    }
  }

  const payload = {
    billType,
    gstMode: customer?.gstNumber && rng() < 0.8 ? "inclusive" : "inclusive",
    customerId: customer?.id,
    customerName: customer?.name ?? "Walk-in",
    items,
    discount: r2(discount),
    discountReason,
    offerId, offerCode,
    offerDiscount: offerId ? offerDiscount : 0,
    loyaltyPointsToRedeem,
    payments,
    creditAmount,
    waivedAmount,
    sensitiveActions,
    reason: sensitiveActions.length ? (discountReason ?? "Owner approved") : undefined,
    clientBillId: `sim-${iso(date)}-${stats.bills + stats.estimates}-${Math.floor(rng() * 1e6)}`,
  };

  try {
    const bill = await client.post("/bills/confirm", payload);
    for (const { product, quantity } of lines) product.stock -= quantity * product.factor;
    if (billType === "estimate") stats.estimates += 1;
    else {
      stats.bills += 1;
      stats.revenue += grandTotal;
      stats.items += items.length;
    }
    if (offerId) { offer.used += 1; stats.offersApplied += 1; stats.offerDiscount += offerDiscount; }
    if (loyaltyPointsToRedeem) stats.loyaltyRedemptions += 1;
    if (customer) {
      customer.visits += 1;
      customer.spent += grandTotal;
      customer.balance = r2(customer.balance + creditAmount);
    }
    // keep the rate each line was actually sold at — a return has to quote the
    // original line's price, not the product's current (possibly revised) price
    const soldLines = lines.map(({ product, quantity }, index) => ({
      product, quantity, rate: items[index]?.ratePerRateUnit ?? product.price,
    }));
    world.recentBills.push({ id: bill.id ?? bill.bill?.id, date: iso(date), total: grandTotal, lines: soldLines, customer });
    if (world.recentBills.length > 400) world.recentBills.shift();
    return bill;
  } catch (err) {
    recordError(`bill(${billType})`, err);
    return null;
  }
}

// ── udhar collections ──────────────────────────────────────────────
/**
 * Local balances drift from the server (a udhar-mode sales return credits the
 * khata behind our back), and the server rightly rejects an overpayment. The
 * server ledger is authoritative — re-read it instead of trusting local state.
 */
async function resyncUdharBalances() {
  try {
    const summary = await owner.get("/udhar/summary");
    const byId = new Map((summary.customers ?? []).map((c) => [c.id, Number(c.udharAmount) || 0]));
    for (const customer of world.customers) customer.balance = byId.get(customer.id) ?? 0;
  } catch (err) { recordError("udhar-resync", err); }
}

async function collectUdhar(date) {
  const debtors = world.customers.filter((c) => c.balance > 20);
  if (!debtors.length) return;
  const count = Math.min(debtors.length, intBetween(rng, 2, 9));
  for (let i = 0; i < count; i += 1) {
    const customer = weightedPick(rng, debtors, (c) => c.balance);
    if (customer.balance <= 20) continue;
    const full = rng() < 0.45;
    const amount = full ? r2(customer.balance) : r2(Math.max(50, Math.floor(customer.balance * between(rng, 0.2, 0.8))));
    if (amount <= 0) continue;
    try {
      await owner.post(`/customers/${customer.id}/udhar-payment`, {
        amount: Math.min(amount, r2(customer.balance)),
        mode: pick(rng, ["cash", "cash", "upi", "bank"]),
        note: `Khata payment ${iso(date)}`,
      });
      customer.balance = r2(customer.balance - Math.min(amount, customer.balance));
      stats.udharPayments += 1;
      stats.udharCollected += amount;
    } catch (err) {
      recordError("udhar-payment", err);
    }
  }
}

// ── expenses ───────────────────────────────────────────────────────
async function postExpense(date, body) {
  try {
    await owner.post("/expenses", { ...body, spentAt: new Date(atTime(date, 11, 0)).toISOString() });
    stats.expenses += 1;
    stats.expenseValue += body.amount;
  } catch (err) { recordError("expense", err); }
}

async function dailyExpenses(date) {
  const day = date.getDate();
  for (const e of MONTHLY_EXPENSES) {
    if (e.day !== day) continue;
    let amount = e.amount;
    if (e.category === "utilities" && e.title.startsWith("Electricity")) {
      const summer = [3, 4, 5].includes(date.getMonth());
      amount = Math.round(between(rng, summer ? 5200 : 3200, summer ? 7400 : 4600));
    }
    await postExpense(date, {
      title: e.title, amount, category: e.category, paymentMode: e.mode,
      vendor: e.vendor, status: rng() < 0.94 ? "paid" : "pending",
      recurringInterval: e.recurring, notes: `${e.title} for ${date.toLocaleString("en-IN", { month: "long", year: "numeric" })}`,
    });
  }
  if (rng() < 0.28) {
    const e = pick(rng, AD_HOC_EXPENSES);
    await postExpense(date, {
      title: e.title, amount: Math.round(between(rng, e.amount[0], e.amount[1])),
      category: e.category, paymentMode: e.mode, status: "paid",
    });
  }
}

// ── inventory hygiene ──────────────────────────────────────────────
async function writeOffDamage(date) {
  const perishables = world.products.filter((p) => PERISHABLE.has(p.category) && p.stock > p.factor * 2);
  if (!perishables.length) return;
  const count = intBetween(rng, 1, 3);
  for (let i = 0; i < count; i += 1) {
    const product = pick(rng, perishables);
    const qty = product.isLoose ? r2(between(rng, 0.25, 2)) : intBetween(rng, 1, 4);
    try {
      await owner.post("/inventory/damage", {
        productId: product.id, quantity: qty, enteredUnit: product.rateUnit,
        note: pick(rng, ["Expired stock", "Leaked packet", "Spoiled in transit", "Rat damage", "Broken seal"]),
      });
      product.stock -= qty * product.factor;
      stats.damages += 1;
    } catch (err) { recordError("damage", err); }
  }
}

async function stockCorrection(date) {
  const candidates = world.products.filter((p) => p.stock > 0);
  if (!candidates.length) return;
  for (let i = 0; i < 2; i += 1) {
    const product = pick(rng, candidates);
    const drift = Math.round(product.stock * between(rng, -0.03, 0.02));
    const target = Math.max(0, Math.round(product.stock + drift));
    try {
      await owner.post("/inventory/correction", {
        productId: product.id, newStockBaseQty: target,
        note: `Shelf recount ${iso(date)}`,
      });
      product.stock = target;
      stats.corrections += 1;
    } catch (err) { recordError("correction", err); }
  }
}

async function runStockCount(date) {
  const subset = world.products.slice(0, 200).filter(() => rng() < 0.35).slice(0, 40);
  if (subset.length < 5) return;
  try {
    const session = await owner.post("/inventory/counts", {
      name: `Physical count ${date.toLocaleString("en-IN", { month: "short", year: "numeric" })}`,
      blindCount: true,
      productIds: subset.map((p) => p.id),
    });
    const id = session.id ?? session.session?.id;
    const lines = subset.map((p) => {
      const counted = Math.max(0, Math.round(p.stock * between(rng, 0.96, 1.02)));
      return { productId: p.id, countedBaseQty: counted, reason: counted !== Math.round(p.stock) ? "Physical variance" : undefined };
    });
    await owner.patch(`/inventory/counts/${id}/lines`, { lines });
    await owner.post(`/inventory/counts/${id}/submit`, {});
    await owner.post(`/inventory/counts/${id}/apply`, { note: `Applied after ${iso(date)} count` });
    for (const line of lines) {
      const product = world.products.find((p) => p.id === line.productId);
      if (product) product.stock = line.countedBaseQty;
    }
    stats.stockCounts += 1;
  } catch (err) { recordError("stock-count", err); }
}

async function runPurchaseOrder(date) {
  const supplier = pick(rng, world.suppliers);
  const items = world.products
    .filter((p) => supplier.cats.includes(p.category))
    .slice(0, 6)
    .map((p) => ({
      productId: p.id,
      orderedBaseQty: p.isLoose ? p.reorder * 2 : Math.max(6, Math.round(p.reorder / 2)),
      expectedRate: r2(p.cost),
    }));
  if (items.length < 2) return;
  try {
    const po = await owner.post("/purchase-orders", {
      supplierId: supplier.id,
      supplierName: supplier.name,
      expectedOn: iso(addDays(date, 4)),
      vendorReference: `PO-${iso(date).replace(/-/g, "")}`,
      paymentTerms: "21 days credit",
      note: "Monthly indent",
      items,
    });
    const id = po.id ?? po.purchaseOrder?.id;
    await owner.post(`/purchase-orders/${id}/send`, {});
    const full = await owner.get(`/purchase-orders/${id}`);
    const poItems = full.items ?? full.purchaseOrder?.items ?? [];
    const receiveItems = poItems.map((line) => {
      const product = world.products.find((p) => p.id === line.productId);
      const received = rng() < 0.8 ? line.orderedBaseQty : Math.round(line.orderedBaseQty * 0.7);
      return {
        purchaseOrderItemId: line.id,
        quantityBaseQty: received,
        actualRate: r2((product?.cost ?? line.expectedRate) * between(rng, 0.98, 1.05)),
      };
    });
    const invoiceTotal = r2(receiveItems.reduce((sum, line) => {
      const product = world.products.find((p) => p.id === (poItems.find((i) => i.id === line.purchaseOrderItemId)?.productId));
      const factor = product?.factor ?? 1;
      return sum + line.actualRate * (line.quantityBaseQty / factor);
    }, 0));
    await owner.post(`/purchase-orders/${id}/receive`, {
      supplierInvoiceNumber: `INV-${intBetween(rng, 10000, 99999)}`,
      supplierInvoiceAmount: invoiceTotal,
      varianceReason: "Depot rate revision and short supply on some lines",
      paidAmount: rng() < 0.5 ? invoiceTotal : r2(invoiceTotal / 2),
      paymentMode: "bank",
      dueDate: iso(addDays(date, 21)),
      items: receiveItems,
      updateCost: true,
    });
    for (const line of receiveItems) {
      const poLine = poItems.find((i) => i.id === line.purchaseOrderItemId);
      const product = world.products.find((p) => p.id === poLine?.productId);
      if (product) product.stock += line.quantityBaseQty;
    }
    stats.purchaseOrders += 1;
  } catch (err) { recordError("purchase-order", err); }
}

async function issueGiftCard(date) {
  const customer = pick(rng, world.customers);
  try {
    const card = await owner.post("/gift-cards", {
      amount: pick(rng, [500, 1000, 1500, 2000]),
      customerId: customer?.id,
      // validity is checked against real "now", so cards are issued with a
      // long-dated expiry instead of simulated-date + 300 days
      expiresOn: "2027-06-30",
      note: "Festival gift card",
    });
    const code = card.code ?? card.giftCard?.code;
    const amount = Number(card.issuedAmount ?? card.amount ?? card.giftCard?.balance ?? 0);
    if (code) {
      world.activeGiftCards.push({ code, balance: amount || 500 });
      stats.giftCardsIssued += 1;
    }
  } catch (err) { recordError("gift-card", err); }
}

async function makeReturn(date) {
  const candidates = world.recentBills.filter((b) => b.id && b.lines.length);
  if (!candidates.length) return;
  const source = pick(rng, candidates.slice(-60));
  const line = pick(rng, source.lines);
  const quantity = line.product.isLoose ? Math.min(line.quantity, 0.5) : 1;
  const damaged = rng() < 0.35;
  try {
    await owner.post("/bills/returns", {
      returnOfBillId: source.id,
      customerId: source.customer?.id,
      customerName: source.customer?.name,
      refundMode: source.customer && rng() < 0.3 ? "udhar" : pick(rng, ["cash", "upi"]),
      reason: pick(rng, ["Item damaged", "Wrong item given", "Customer changed mind", "Expired batch", "Leaking packet"]),
      items: [{
        productId: line.product.id,
        name: line.product.name,
        quantity,
        enteredUnit: line.product.rateUnit,
        ratePerRateUnit: line.rate ?? line.product.price,
        gstRate: line.product.gst,
        hsn: line.product.hsn,
        damaged,
      }],
    });
    if (!damaged) line.product.stock += quantity * line.product.factor;
    stats.returns += 1;
  } catch (err) { recordError("sale-return", err); }
}

async function cancelABill(date) {
  const candidates = world.recentBills.filter((b) => b.id).slice(-40);
  if (!candidates.length) return;
  const target = pick(rng, candidates);
  try {
    await owner.post(`/bills/${target.id}/cancel`, { reason: pick(rng, ["Billed twice by mistake", "Customer cancelled order", "Wrong customer selected"]) });
    stats.cancelled += 1;
    world.recentBills = world.recentBills.filter((b) => b.id !== target.id);
  } catch (err) { recordError("cancel-bill", err); }
}

async function reviseSellingPrices(date) {
  const subset = world.products.filter(() => rng() < 0.45);
  for (const product of subset) {
    const bump = between(rng, 1.02, 1.07);
    const price = r2(product.price * bump);
    const mrp = r2(Math.max(product.mrp * bump, price * 1.02));
    try {
      // The product's selling units carry their own price ceiling and billing
      // reads THAT, not product.mrp — so a price revision has to move both or
      // the item becomes unsellable at its own new price.
      const current = await owner.get(`/products/${product.id}`);
      const units = (current.sellingUnits ?? []).map((unit) => ({
        id: unit.id,
        name: unit.name,
        unitType: unit.unitType,
        unitCode: unit.unitCode,
        packSizeValue: unit.packSizeValue,
        packSizeUnit: unit.packSizeUnit,
        conversionToBase: unit.conversionToBase,
        barcode: unit.barcode,
        defaultPrice: price,
        minimumPrice: r2(product.cost * 1.02),
        maximumPrice: mrp,
        costPrice: r2(product.cost),
        isDefault: unit.isDefault,
        isActive: unit.isActive,
      }));
      await owner.patch(`/products/${product.id}`, {
        defaultPricePerRateUnit: price,
        mrp,
        minPricePerRateUnit: r2(product.cost * 1.02),
        ...(units.length ? { sellingUnits: units } : {}),
      });
      product.price = price;
      product.mrp = mrp;
      stats.priceRevisions += 1;
    } catch (err) { recordError("price-revision", err); }
  }
  log(`  price revision applied to ${subset.length} products`);
}

async function createOffersDue(date) {
  const today = iso(date);
  for (const plan of OFFER_PLAN) {
    if (plan.from !== today || world.offers.some((o) => o.code === plan.code)) continue;
    try {
      // validity windows are enforced against real "now" by the API, so the
      // coupon is created open-ended here and the real window is stamped on at
      // the end of the run (see finalise()).
      const offer = await owner.post("/offers", {
        title: plan.title, code: plan.code, type: plan.type, value: plan.value,
        minBillAmount: plan.minBillAmount, maxDiscount: plan.maxDiscount ?? 0,
        scope: "all", usageLimit: plan.usageLimit, active: true,
      });
      world.offers.push({ ...plan, id: offer.id, used: 0, maxDiscount: plan.maxDiscount ?? 0 });
      log(`  coupon ${plan.code} launched`);
    } catch (err) { recordError("create-offer", err); }
  }
}

// ── one simulated day ──────────────────────────────────────────────
async function runDay(date, dayIndex) {
  const mark = new Date();
  const month = date.getMonth();
  const day = date.getDate();

  await createOffersDue(date);

  // new customers walk in through the year
  if (rng() < 0.55 && world.pendingCustomers.length) {
    const batch = world.pendingCustomers.splice(0, intBetween(rng, 1, 3));
    await addCustomers(batch);
  }

  // mid-year product launches
  if (world.pendingLaunches.length && rng() < 0.035) {
    const def = world.pendingLaunches.shift();
    const product = await createProduct(def);
    product.launched = true;
    await restock(product, date, { multiplier: 3 });
    log(`  launched new product: ${def.name}`);
  }

  // restocking
  if (date.getDay() === 2 || date.getDay() === 5) {
    for (const product of world.products) {
      if (PERISHABLE.has(product.category)) continue;
      if (product.stock < product.reorder * 1.2) await restock(product, date);
    }
  }
  if (dayIndex % 3 === 0) {
    for (const product of world.products) {
      if (!PERISHABLE.has(product.category)) continue;
      if (product.stock < product.reorder * 1.5) await restock(product, date, { multiplier: 2 });
    }
  }
  // festival load-up
  if ((festivalIndex.get(iso(addDays(date, 2))) ?? 1) > 1.5) {
    for (const product of world.products) {
      if (seasonFactor(product.season, month) > 1.2 && product.stock < product.reorder * 3) {
        await restock(product, date, { multiplier: 4 });
      }
    }
  }

  // the day's sales
  const billCount = Math.max(4, Math.round(26 * dayFactor(date, dayIndex)));
  const billTimes = [];
  for (let i = 0; i < billCount; i += 1) {
    // two rushes: 9-12 morning, 17-21 evening
    const hour = rng() < 0.45 ? intBetween(rng, 8, 12) : rng() < 0.8 ? intBetween(rng, 17, 21) : intBetween(rng, 12, 17);
    billTimes.push(hour);
  }
  billTimes.sort((a, b) => a - b);

  for (const hour of billTimes) {
    // staff work the counter for part of the day
    const operator = staffClients.length && rng() < 0.42
      ? staffClients[rng() < 0.7 ? 0 : 1]
      : null;
    await makeBill(date, hour, { client: operator?.client ?? owner, actor: operator?.name ?? "owner" });
  }
  // rough/estimate bills (kacha bill)
  if (rng() < 0.35) await makeBill(date, 12, { billType: "estimate" });

  // money in / money out
  if (dayIndex % 15 === 7) await resyncUdharBalances();
  if (dayIndex % 3 === 1) await collectUdhar(date);
  await dailyExpenses(date);

  // exceptions
  if (rng() < 0.09) await makeReturn(date);
  if (rng() < 0.02) await cancelABill(date);
  if (dayIndex % 10 === 4) await writeOffDamage(date);
  if (day === 18) await stockCorrection(date);
  if (day === 1 && dayIndex > 20) await runPurchaseOrder(date);
  if (day === 28 && [8, 11, 2, 5].includes(month)) await runStockCount(date);
  if (rng() < 0.03 && world.customers.length) await issueGiftCard(date);
  if ((iso(date) === "2025-10-01" || iso(date) === "2026-04-01")) await reviseSellingPrices(date);

  // stamp everything written above onto the simulated day
  await backdate(mark, atTime(date, 12, 30));
  const bills = await db.bill.findMany({ where: { shopId: world.shop.id, createdAt: atTime(date, 12, 30) }, select: { id: true } });
  let index = 0;
  for (const bill of bills) {
    const hour = billTimes[index] ?? intBetween(rng, 9, 20);
    index += 1;
    await db.bill.update({ where: { id: bill.id }, data: { createdAt: atTime(date, hour, intBetween(rng, 0, 59)) } });
  }
}

// ── finalise ───────────────────────────────────────────────────────
/**
 * The API stamps bill numbers with the real calendar year (2026) because the
 * counter has no notion of a simulated clock. Renumber them so KOS-2025-… /
 * KOS-2026-… line up with the dates the bills actually carry.
 */
async function renumberBills() {
  const bills = await db.bill.findMany({
    where: { shopId: world.shop.id },
    select: { id: true, billNo: true, billType: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const seq = new Map();
  const updates = [];
  for (const bill of bills) {
    const prefix = bill.billType === "estimate" ? "EST" : bill.billType === "sales_return" ? "RET" : "KOS";
    const year = bill.createdAt.getFullYear();
    const key = `${prefix}-${year}`;
    const next = (seq.get(key) ?? 0) + 1;
    seq.set(key, next);
    const billNo = `${key}-${String(next).padStart(6, "0")}`;
    if (billNo !== bill.billNo) updates.push({ id: bill.id, billNo });
  }
  // two passes so the unique (shopId, billNo) index never collides mid-way
  for (const u of updates) await db.bill.update({ where: { id: u.id }, data: { billNo: `TMP-${u.id.slice(-8)}` } });
  for (const u of updates) await db.bill.update({ where: { id: u.id }, data: { billNo: u.billNo } });
  log(`Renumbered ${updates.length} bills to their simulated year`);
}

async function finalise() {
  await renumberBills();
  // stamp the intended validity window on each coupon
  for (const offer of world.offers) {
    await db.offer.updateMany({
      where: { id: offer.id },
      data: { validFrom: new Date(`${offer.from}T00:00:00`), validTo: new Date(`${offer.to}T23:59:59`), active: false },
    });
  }
  const counts = {
    bills: await db.bill.count({ where: { shopId: world.shop.id } }),
    billItems: await db.billItem.count(),
    payments: await db.payment.count({ where: { shopId: world.shop.id } }),
    udharLedger: await db.udharLedger.count({ where: { shopId: world.shop.id } }),
    stockLedger: await db.stockLedger.count({ where: { shopId: world.shop.id } }),
    purchases: await db.purchaseHistory.count({ where: { shopId: world.shop.id } }),
    expenses: await db.expense.count({ where: { shopId: world.shop.id } }),
    customers: await db.customer.count({ where: { shopId: world.shop.id } }),
    products: await db.product.count({ where: { shopId: world.shop.id } }),
    loyaltyTx: await db.loyaltyTransaction.count({ where: { shopId: world.shop.id } }),
    auditLogs: await db.auditLog.count({ where: { shopId: world.shop.id } }),
    financialLedger: await db.financialLedger.count({ where: { shopId: world.shop.id } }),
  };
  const summary = {
    shopId: world.shop.id,
    shopName: world.shop.name,
    ownerMobile: world.ownerMobile,
    ownerPin: OWNER_PIN,
    apiCalls: owner.state.calls + staffClients.reduce((sum, s) => sum + s.client.state.calls, 0),
    period: { from: iso(START), to: iso(addDays(START, DAYS - 1)) },
    stats: { ...stats, apiErrors: stats.apiErrors.slice(0, 40), apiErrorCount: stats.apiErrors.length },
    errorCodes: Object.fromEntries([...errorCodes.entries()].sort((a, b) => b[1] - a[1])),
    dbCounts: counts,
  };
  fs.writeFileSync(path.join(OUT, "simulation-summary.json"), JSON.stringify(summary, null, 2));
  log("── simulation complete ──");
  console.log(JSON.stringify(summary.stats, null, 2));
  console.log(JSON.stringify(counts, null, 2));
}

// ── main ───────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  await indexCreatedAt();
  await register();
  await upgradeToPro();
  await createStaff();
  await createSuppliers();
  await createCatalog();
  await enableLoyalty();

  const allCustomers = buildCustomers(rng, 150);
  world.pendingCustomers = allCustomers.slice(55);
  world.pendingLaunches = PRODUCTS.filter((p) => LATE_LAUNCH.has(p.name));
  await addCustomers(allCustomers.slice(0, 55));

  // opening stock — the shop starts the year fully loaded
  const openingMark = new Date();
  for (const product of world.products) await restock(product, START, { multiplier: 2 });
  await backdate(openingMark, atTime(addDays(START, -1), 9, 0));
  log(`Opening stock loaded (${stats.purchases} purchase entries)`);

  for (let i = 0; i < DAYS; i += 1) {
    const date = addDays(START, i);
    await runDay(date, i);
    if (i % 10 === 0 || i === DAYS - 1) {
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      log(`day ${i + 1}/${DAYS} ${iso(date)} — bills ${stats.bills} rev ₹${Math.round(stats.revenue)} purch ${stats.purchases} err ${stats.apiErrors.length} (${mins}m)`);
    }
  }

  await finalise();
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { fs.writeFileSync(path.join(OUT, "crash.json"), JSON.stringify({ message: err.message, stats }, null, 2)); } catch { /* ignore */ }
  await db.$disconnect();
  process.exit(1);
});
