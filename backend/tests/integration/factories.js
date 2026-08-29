import bcrypt from "bcryptjs";
import { moneyShadows } from "../../src/utils/money.js";

let seq = 1;

export function unique(prefix = "test") {
  return `${prefix}-${Date.now()}-${seq++}`;
}

export function uniqueMobile() {
  const n = String(6000000000 + (seq++ % 999999999)).padStart(10, "0");
  return n.startsWith("6") ? n : `6${n.slice(1)}`;
}

export async function createTenant(db, overrides = {}) {
  const password = overrides.password || "Password123";
  const ownerPin = overrides.ownerPin || "1234";
  const ownerMobile = overrides.ownerMobile || uniqueMobile();

  const shop = await db.shop.create({
    data: {
      name: overrides.shopName || unique("Shop"),
      ownerName: overrides.ownerName || "Owner User",
      city: overrides.city || "Jodhpur",
      address: overrides.address || "Integration Test Address",
      phone: overrides.phone || ownerMobile,
      gstNumber: overrides.gstNumber || null,
    },
  });

  const owner = await db.user.create({
    data: {
      shopId: shop.id,
      name: overrides.ownerName || "Owner User",
      mobile: ownerMobile,
      passwordHash: await bcrypt.hash(password, 10),
      pinHash: await bcrypt.hash(ownerPin, 10),
      role: "owner",
    },
  });

  if (overrides.planCode !== null) {
    await activateTestSubscription(db, shop.id, overrides.planCode || "pro");
  }

  return { shop, owner, ownerPassword: password, ownerPin, ownerMobile };
}

export async function activateTestSubscription(db, shopId, planCode = "pro") {
  const now = new Date();
  const currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return db.subscription.upsert({
    where: { shopId },
    update: {
      planCode,
      status: "active",
      provider: "integration",
      currentPeriodStart: now,
      currentPeriodEnd,
      trialEndsAt: null,
      graceEndsAt: new Date(currentPeriodEnd.getTime() + 3 * 24 * 60 * 60 * 1000),
      cancelledAt: null,
    },
    create: {
      shopId,
      planCode,
      status: "active",
      provider: "integration",
      currentPeriodStart: now,
      currentPeriodEnd,
      graceEndsAt: new Date(currentPeriodEnd.getTime() + 3 * 24 * 60 * 60 * 1000),
    },
  });
}

export async function createStaff(db, shopId, overrides = {}) {
  const password = overrides.password || "StaffPass123";
  const mobile = overrides.mobile || uniqueMobile();
  const staff = await db.user.create({
    data: {
      shopId,
      name: overrides.name || "Staff User",
      mobile,
      passwordHash: await bcrypt.hash(password, 10),
      role: overrides.role || "staff",
    },
  });
  return { staff, staffPassword: password, staffMobile: mobile };
}

export async function login(ctx, mobile, password, extra = {}) {
  const response = await ctx.post("/api/auth/login", { mobile, password, ...extra });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${mobile}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

export async function createProduct(db, shopId, overrides = {}) {
  return db.product.create({ data: productData(shopId, overrides) });
}

export function productData(shopId, overrides = {}) {
  return {
    shopId,
    name: overrides.name || unique("Product"),
    category: overrides.category || "general",
    aliasesJson: JSON.stringify(overrides.aliases || []),
    displayUnit: overrides.displayUnit || "piece",
    baseUnit: overrides.baseUnit || "piece",
    rateUnit: overrides.rateUnit || "piece",
    stockBaseQty: overrides.stockBaseQty ?? 20,
    costPerRateUnit: overrides.costPerRateUnit ?? 10,
    // Keep the default fixture internally valid when a test lowers only the
    // ordinary selling price. Tests that exercise below-minimum approval still
    // opt in explicitly by supplying minPricePerRateUnit.
    minPricePerRateUnit: overrides.minPricePerRateUnit ?? Math.min(12, overrides.defaultPricePerRateUnit ?? 20),
    defaultPricePerRateUnit: overrides.defaultPricePerRateUnit ?? 20,
    ...moneyShadows({
      costPerRateUnit: overrides.costPerRateUnit ?? 10,
      minPricePerRateUnit: overrides.minPricePerRateUnit ?? Math.min(12, overrides.defaultPricePerRateUnit ?? 20),
      defaultPricePerRateUnit: overrides.defaultPricePerRateUnit ?? 20,
    }),
    gstRate: overrides.gstRate ?? 0,
    hsn: overrides.hsn || null,
    lowStockThreshold: overrides.lowStockThreshold ?? 5,
    ...(overrides.restaurantItemType !== undefined ? { restaurantItemType: overrides.restaurantItemType } : {}),
    ...(overrides.reorderLevel !== undefined ? { reorderLevel: overrides.reorderLevel } : {}),
  };
}

export async function createCustomer(db, shopId, overrides = {}) {
  return db.customer.create({ data: customerData(shopId, overrides) });
}

export function customerData(shopId, overrides = {}) {
  return {
    shopId,
    name: overrides.name || unique("Customer"),
    mobile: overrides.mobile === null ? null : overrides.mobile || uniqueMobile(),
    type: overrides.type || "regular",
    address: overrides.address ?? null,
    gstNumber: overrides.gstNumber ?? null,
    stateCode: overrides.stateCode ?? null,
    udharAmount: overrides.udharAmount ?? 0,
    ...moneyShadows({ udharAmount: overrides.udharAmount ?? 0 }),
  };
}

export function productPayload(overrides = {}) {
  return {
    name: overrides.name || unique("Api Product"),
    category: overrides.category || "general",
    aliases: overrides.aliases || [],
    displayUnit: overrides.displayUnit || "piece",
    baseUnit: overrides.baseUnit || "piece",
    rateUnit: overrides.rateUnit || "piece",
    stockBaseQty: overrides.stockBaseQty ?? 20,
    costPerRateUnit: overrides.costPerRateUnit ?? 10,
    minPricePerRateUnit: overrides.minPricePerRateUnit ?? Math.min(12, overrides.defaultPricePerRateUnit ?? 20),
    defaultPricePerRateUnit: overrides.defaultPricePerRateUnit ?? 20,
    ...moneyShadows({
      costPerRateUnit: overrides.costPerRateUnit ?? 10,
      minPricePerRateUnit: overrides.minPricePerRateUnit ?? Math.min(12, overrides.defaultPricePerRateUnit ?? 20),
      defaultPricePerRateUnit: overrides.defaultPricePerRateUnit ?? 20,
    }),
    gstRate: overrides.gstRate ?? 0,
    lowStockThreshold: overrides.lowStockThreshold ?? 5,
    ...(overrides.hsn !== undefined ? { hsn: overrides.hsn } : {}),
    ...(overrides.brand !== undefined ? { brand: overrides.brand } : {}),
    ...(overrides.mrp !== undefined ? { mrp: overrides.mrp } : {}),
    ...(overrides.reorderLevel !== undefined ? { reorderLevel: overrides.reorderLevel } : {}),
    ...(overrides.description !== undefined ? { description: overrides.description } : {}),
    ...(overrides.imageUrl !== undefined ? { imageUrl: overrides.imageUrl } : {}),
    ...(overrides.isLooseItem !== undefined ? { isLooseItem: overrides.isLooseItem } : {}),
  };
}

export function customerPayload(overrides = {}) {
  return {
    name: overrides.name || unique("Api Customer"),
    mobile: overrides.mobile === null ? undefined : overrides.mobile || uniqueMobile(),
    type: overrides.type || "regular",
  };
}

export function billPayload(product, overrides = {}) {
  const quantity = overrides.quantity ?? 2;
  const rate = overrides.ratePerRateUnit ?? product.defaultPricePerRateUnit ?? 20;
  const total = quantity * rate;
  const payable = Math.max(0, total - (overrides.lineDiscount ?? 0));
  return {
    billType: overrides.billType || "normal_sale",
    gstMode: overrides.gstMode ?? "inclusive",
    customerId: overrides.customerId,
    customerName: overrides.customerName || "Walk-in",
    items: [
      {
        productId: product.id,
        name: product.name,
        quantity,
        enteredUnit: overrides.enteredUnit || product.rateUnit || "piece",
        ratePerRateUnit: rate,
        gstRate: overrides.gstRate ?? 0,
        hsn: overrides.hsn ?? product.hsn ?? undefined,
        lineDiscount: overrides.lineDiscount ?? 0,
      },
    ],
    discount: overrides.discount ?? 0,
    actualAmount: overrides.actualAmount ?? payable,
    buyerPaidAmount: overrides.buyerPaidAmount ?? payable,
    waivedAmount: overrides.waivedAmount ?? 0,
    payments: overrides.payments ?? [{ mode: "cash", amount: payable }],
  };
}

export async function createPaidBillViaApi(ctx, token, product, overrides = {}) {
  const response = await ctx.post("/api/bills/confirm", billPayload(product, overrides), { token });
  if (response.status !== 201) {
    throw new Error(`Bill create failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}


export async function activateDeviceViaApi(ctx, token, overrides = {}) {
  const deviceId = overrides.deviceId || unique("device");
  const response = await ctx.post("/api/devices/activate", {
    deviceId,
    deviceName: overrides.deviceName || "Integration Device",
    platform: overrides.platform || "test",
    fingerprintHash: overrides.fingerprintHash || `fp-${deviceId}`,
  }, { token });
  if (response.status !== 201) {
    throw new Error(`Device activation failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}
