import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  buildFlipkartSearchBody,
  mapFlipkartOrderStatus,
  parseFlipkartLocationMap,
} from "../src/modules/integrations/flipkart-seller.service.js";

assert.deepEqual([...parseFlipkartLocationMap('{"FK-WH-1":"MAIN","FK-WH-2":"BLR"}')], [
  ["FK-WH-1", "MAIN"],
  ["FK-WH-2", "BLR"],
]);
assert.throws(() => parseFlipkartLocationMap("[]"), (error) => error.code === "FLIPKART_LOCATION_MAP_INVALID");
assert.throws(() => parseFlipkartLocationMap("{}"), (error) => error.code === "FLIPKART_LOCATION_MAP_INVALID");

const search = buildFlipkartSearchBody(
  { type: "preDispatch", states: ["APPROVED"] },
  { from: "2026-08-01", to: "2026-08-20" },
);
assert.equal(search.pagination.pageSize, 20);
assert.equal(search.filter.orderDate.from, "2026-08-01T00:00:00.000+05:30");
assert.equal(search.filter.orderDate.to, "2026-08-20T23:59:59.999+05:30");

for (const [provider, local] of [
  ["APPROVED", "new"],
  ["PACKED", "accepted"],
  ["READY_TO_DISPATCH", "ready"],
  ["SHIPPED", "ready"],
  ["DELIVERED", "fulfilled"],
  ["CANCELLED", "cancelled"],
]) {
  assert.equal(mapFlipkartOrderStatus(provider), local, `${provider} must map to ${local}`);
}

const PRODUCTION_ENV = {
  NODE_ENV: "production",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough-1234567890",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  OWNER_PIN_REQUIRED: "true",
  LICENSE_SIGNING_SECRET: "test-license-secret-long-enough-1234567890",
  INTEGRATION_SIGNING_SECRET: "test-integration-secret-long-enough-12345",
  ALLOWED_ORIGINS: "https://pos.example.com",
  METRICS_ENABLED: "false",
  WHATSAPP_PROVIDER: "disabled",
  CARD_TERMINAL_PROVIDER: "none",
  GST_PROVIDER: "disabled",
  RAZORPAY_ENABLED: "false",
  RETAIL_PAYMENT_PROVIDER: "manual",
};

function bootEnv(overrides) {
  return spawnSync(process.execPath, ["-e", "import('./src/config/env.js').then(() => console.log('BOOTED'))"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...PRODUCTION_ENV, ...overrides },
  });
}

const missingTenant = bootEnv({
  FLIPKART_SELLER_API_ENABLED: "true",
  FLIPKART_APP_ID: "app-id",
  FLIPKART_APP_SECRET: "app-secret",
  FLIPKART_SHOP_ID: "",
  FLIPKART_LOCATION_MAP_JSON: '{"FK-WH":"MAIN"}',
});
assert.doesNotMatch(missingTenant.stdout, /BOOTED/, "an unbound global Seller API credential must not boot");
assert.match(`${missingTenant.stdout}${missingTenant.stderr}`, /FLIPKART_SHOP_ID/);

const unsafeHost = bootEnv({
  FLIPKART_SELLER_API_ENABLED: "true",
  FLIPKART_APP_ID: "app-id",
  FLIPKART_APP_SECRET: "app-secret",
  FLIPKART_SHOP_ID: "shop-1",
  FLIPKART_LOCATION_MAP_JSON: '{"FK-WH":"MAIN"}',
  FLIPKART_API_BASE_URL: "https://seller-api.example.com",
});
assert.doesNotMatch(unsafeHost.stdout, /BOOTED/, "production must not send seller credentials to a custom host");
assert.match(`${unsafeHost.stdout}${unsafeHost.stderr}`, /OFFICIAL_HTTPS_HOST_REQUIRED/);

const complete = bootEnv({
  FLIPKART_SELLER_API_ENABLED: "true",
  FLIPKART_APP_ID: "app-id",
  FLIPKART_APP_SECRET: "app-secret",
  FLIPKART_SHOP_ID: "shop-1",
  FLIPKART_LOCATION_MAP_JSON: '{"FK-WH":"MAIN"}',
  FLIPKART_API_BASE_URL: "https://api.flipkart.net",
});
assert.match(complete.stdout, /BOOTED/, `complete production connector should boot: ${complete.stderr}`);

console.log("Flipkart seller connector examples passed");
