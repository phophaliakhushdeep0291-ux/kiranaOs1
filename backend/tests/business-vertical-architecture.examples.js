import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BUSINESS_PROFILE_LIST, BUSINESS_TYPES } from "../src/verticals/registry.js";
import { NAVIGATION_KEYS, SHARED_NAVIGATION } from "../src/verticals/profile.js";
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

/**
 * The isolation guarantee, enforced rather than agreed — the server-side twin of
 * frontend/src/tests/vertical-boundaries.test.ts.
 *
 * Now that a vertical holds real code and not just a profile preset (cloth rentals
 * live at verticals/clothing/rentals/), checking the barrel files is no longer
 * enough: the whole tree has to be walked, or one trade quietly becomes a
 * dependency of every shop.
 */

const src = join(root, "..");
const VERTICAL_DIRS = readdirSync(root).filter((entry) => statSync(join(root, entry)).isDirectory());

/** Every .js file under a directory, recursively. */
function sourceFilesUnder(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/** Module specifiers from static imports, re-exports and dynamic import(). */
function importsOf(file) {
  return [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

/** The individual trade a specifier reaches into, or null for the shared registry facade. */
function verticalTouchedBy(specifier) {
  const match = specifier.match(/verticals\/([^/"']+)/);
  if (!match) return null;
  return VERTICAL_DIRS.includes(match[1]) ? match[1] : null;
}

test("shared server code never imports an individual vertical", () => {
  // app.js is the composition root: mounting a trade's routes is its job. Every
  // other shared area reaches profiles through the registry facade instead.
  const shared = ["core", "domains", "infrastructure", "shared", "modules", "engines", "middleware", "utils", "workers"];
  const offenders = [];

  for (const area of shared) {
    const dir = join(src, area);
    if (!existsSync(dir)) continue;
    for (const file of sourceFilesUnder(dir)) {
      for (const specifier of importsOf(file)) {
        const trade = verticalTouchedBy(specifier);
        if (trade) offenders.push(`${area}/${file.slice(dir.length + 1).replace(/\\/g, "/")} -> ${trade}`);
      }
    }
  }

  // The shared spine every trade runs on. The moment it imports one trade's code,
  // that trade's bugs and releases become every shop's problem.
  assert.deepEqual(offenders, []);
});

test("no vertical imports another vertical", () => {
  const offenders = [];

  for (const trade of VERTICAL_DIRS) {
    for (const file of sourceFilesUnder(join(root, trade))) {
      for (const specifier of importsOf(file)) {
        const touched = verticalTouchedBy(specifier);
        const sibling = specifier.match(/^\.\.\/([^/]+)\//);
        const other = touched ?? (sibling && VERTICAL_DIRS.includes(sibling[1]) ? sibling[1] : null);
        if (other && other !== trade) offenders.push(`${trade} -> ${other} (${file.slice(root.length + 1).replace(/\\/g, "/")})`);
      }
    }
  }

  // Sideways imports are how one trade becomes a dependency of another. Shared
  // code belongs in a shared layer, not in a sibling pack.
  assert.deepEqual(offenders, []);
});

test("verticals holds one directory per business type and nothing else", () => {
  const expected = BUSINESS_PROFILE_LIST.map((profile) =>
    profile.businessType === "auto_parts" ? "auto-parts" : profile.businessType,
  ).sort();

  // A directory that is not a shop type — a family alias, a leftover — makes the
  // listing lie about what verticals exist.
  assert.deepEqual([...VERTICAL_DIRS].sort(), expected);
});

/**
 * The shared spine, enforced rather than assumed.
 *
 * `bootstrapForShop` ships `navigation` to the client, which hard-blocks any route
 * whose key is absent — so an entry a vertical forgets is not a missing shortcut,
 * it is a "Not part of this business profile" wall on a core screen. Every profile
 * used to hand-write its own full list, and every one of the eleven had dropped
 * something: kirana had no `products`, ten had no `cash-payments`, electronics had
 * no `customers`. Composing the spine in `defineBusinessProfile` fixed it; this
 * keeps it fixed.
 */
test("every vertical keeps the shared spine in its navigation", () => {
  for (const profile of BUSINESS_PROFILE_LIST) {
    const missing = SHARED_NAVIGATION.filter((key) => !profile.navigation.includes(key));
    assert.deepEqual(missing, [], `${profile.businessType} cannot reach: ${missing.join(", ")}`);
  }
});

test("every vertical offers a way to sell and something to sell", () => {
  for (const profile of BUSINESS_PROFILE_LIST) {
    // The client maps /billing onto either key, and /products onto these three.
    const sells = ["billing", "pos"].some((key) => profile.navigation.includes(key));
    const stocks = ["products", "menu", "medicines"].some((key) => profile.navigation.includes(key));
    assert.ok(sells, `${profile.businessType} has no billing or pos entry`);
    assert.ok(stocks, `${profile.businessType} has no products, menu or medicines entry`);
  }
});

test("trade navigation declares only trade entries, never the shared spine", () => {
  for (const profile of BUSINESS_PROFILE_LIST) {
    const repeated = profile.verticalNavigation.filter((key) => SHARED_NAVIGATION.includes(key));
    // A vertical that repeats the spine is a vertical that will drift from it.
    assert.deepEqual(repeated, [], `${profile.businessType} repeats shared keys: ${repeated.join(", ")}`);
  }
});

test("every navigation key a vertical declares is a known key", () => {
  for (const profile of BUSINESS_PROFILE_LIST) {
    const unknown = profile.navigation.filter((key) => !NAVIGATION_KEYS.includes(key));
    assert.deepEqual(unknown, [], `${profile.businessType} declares unknown keys: ${unknown.join(", ")}`);
  }
});

test("every vertical is laid out the same way", () => {
  // profile.js composes; capabilities.js and navigation.js are the two lists an
  // owner-facing change actually edits; index.js is the module's public face.
  for (const directory of VERTICAL_DIRS) {
    for (const file of ["profile.js", "capabilities.js", "navigation.js", "index.js"]) {
      assert.equal(existsSync(join(root, directory, file)), true, `${directory}/${file} missing`);
    }
  }
});
