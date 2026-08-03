import test from "node:test";
import assert from "node:assert/strict";
import {
  BUSINESS_PROFILES,
  BUSINESS_TYPES,
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
