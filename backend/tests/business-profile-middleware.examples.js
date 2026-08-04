import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("batch endpoints enforce the business capability after tenant and plan gates", () => {
  const routes = readFileSync(new URL("../src/modules/inventory-lots/inventoryLots.routes.js", import.meta.url), "utf8");
  const auth = routes.indexOf("requireAuth");
  const shop = routes.indexOf("requireShop", auth);
  const plan = routes.indexOf('requireFeature("batch_expiry")', shop);
  const capability = routes.indexOf('requireCapability("BATCH_TRACKING")', plan);
  assert.ok(auth >= 0 && shop > auth && plan > shop && capability > plan);
});

test("capability failures use the stable FEATURE_NOT_AVAILABLE contract", () => {
  const middleware = readFileSync(new URL("../src/modules/shops/businessProfile.middleware.js", import.meta.url), "utf8");
  assert.match(middleware, /FEATURE_NOT_AVAILABLE/);
  assert.match(middleware, /req\.shopId/);
  assert.match(middleware, /hasCapability/);
});
