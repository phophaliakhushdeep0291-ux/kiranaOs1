import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BUSINESS_PROFILE_LIST, BUSINESS_TYPES } from "../src/verticals/registry.js";
import { ENGINE_CATALOG } from "../src/engines/catalog.js";

const root = dirname(fileURLToPath(new URL("../src/verticals/registry.js", import.meta.url)));

test("every backend business type owns an explicit vertical profile file", () => {
  assert.equal(BUSINESS_PROFILE_LIST.length, BUSINESS_TYPES.length);
  for (const profile of BUSINESS_PROFILE_LIST) {
    const directory = profile.businessType === "auto_parts" ? "auto-parts" : profile.businessType;
    assert.equal(existsSync(join(root, directory, "profile.js")), true, `${profile.businessType} profile missing`);
  }
});

test("shop modules use the registry facade instead of individual vertical imports", () => {
  const facade = readFileSync(join(root, "..", "modules", "shops", "businessProfiles.js"), "utf8");
  assert.match(facade, /export \* from "\.\.\/\.\.\/verticals\/registry\.js"/);
  const middleware = readFileSync(join(root, "..", "modules", "shops", "businessProfile.middleware.js"), "utf8");
  assert.doesNotMatch(middleware, /verticals\/(kirana|clothing|footwear|auto-parts|electronics|pharmacy|stationery|furniture|cosmetics|restaurant|other)/);
});

test("vertical profiles do not import sibling verticals", () => {
  for (const profile of BUSINESS_PROFILE_LIST) {
    const directory = profile.businessType === "auto_parts" ? "auto-parts" : profile.businessType;
    const source = readFileSync(join(root, directory, "profile.js"), "utf8");
    assert.doesNotMatch(source, /from "\.\.\/(kirana|clothing|footwear|auto-parts|electronics|pharmacy|stationery|furniture|cosmetics|restaurant|other)\//);
  }
});

test("every vertical selects a registered shared engine composition", () => {
  for (const profile of BUSINESS_PROFILE_LIST) assert.ok(ENGINE_CATALOG[profile.engine], `${profile.engine} is not registered`);
});
