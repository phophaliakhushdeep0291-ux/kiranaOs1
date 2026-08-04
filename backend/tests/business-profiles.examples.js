import test from "node:test";
import assert from "node:assert/strict";
import {
  BUSINESS_PROFILES,
  BUSINESS_TYPES,
  CAPABILITIES,
  bootstrapForShop,
  settingsForBusinessType,
} from "../src/modules/shops/businessProfiles.js";

test("every supported business type has a versioned capability preset", () => {
  assert.deepEqual(Object.keys(BUSINESS_PROFILES).sort(), [...BUSINESS_TYPES].sort());
  for (const businessType of BUSINESS_TYPES) {
    const settings = settingsForBusinessType(businessType);
    assert.equal(settings.storeProfile.businessTypeKey, businessType);
    assert.equal(settings.businessProfile.businessType, businessType);
    assert.equal(settings.businessProfile.profileVersion, 1);
    assert.ok(settings.businessProfile.engine);
    assert.ok(Array.isArray(settings.businessProfile.capabilities));
  }
});

test("bootstrap is derived from the persisted server profile", () => {
  const shop = {
    id: "shop_1",
    name: "Om Hari Traders",
    settingsJson: JSON.stringify(settingsForBusinessType("electronics")),
  };
  const bootstrap = bootstrapForShop(shop, "owner");
  assert.equal(bootstrap.shop.businessType, "electronics");
  assert.equal(bootstrap.engine, "SERIALIZED_RETAIL");
  assert.ok(bootstrap.capabilities.includes("SERIAL_TRACKING"));
  assert.ok(bootstrap.navigation.includes("serial-numbers"));
});

test("restaurant and pharmacy use specialised engines", () => {
  assert.equal(BUSINESS_PROFILES.restaurant.engine, "RESTAURANT");
  assert.ok(BUSINESS_PROFILES.restaurant.capabilities.includes("KOT"));
  assert.equal(BUSINESS_PROFILES.pharmacy.engine, "BATCH_RETAIL");
  assert.ok(BUSINESS_PROFILES.pharmacy.capabilities.includes("EXPIRY_TRACKING"));
});

test("configured capabilities are bounded by the known catalog and preset", () => {
  const settings = settingsForBusinessType("clothing");
  settings.businessProfile.capabilities.push("BATCH_TRACKING", "NOT_A_REAL_CAPABILITY");
  const bootstrap = bootstrapForShop({ id: "shop_2", name: "Fashion", settingsJson: JSON.stringify(settings) }, "owner");
  assert.ok(CAPABILITIES.includes("BATCH_TRACKING"));
  assert.equal(bootstrap.capabilities.includes("BATCH_TRACKING"), false);
  assert.equal(bootstrap.capabilities.includes("NOT_A_REAL_CAPABILITY"), false);
});

test("custom shops preserve known owner-selected capabilities", () => {
  const settings = settingsForBusinessType("other");
  settings.businessProfile.capabilities = ["BASIC_INVENTORY", "PRODUCT_VARIANTS", "NOT_A_REAL_CAPABILITY"];
  const next = settingsForBusinessType("other", settings);
  assert.deepEqual(next.businessProfile.capabilities, ["BASIC_INVENTORY", "PRODUCT_VARIANTS"]);
});
