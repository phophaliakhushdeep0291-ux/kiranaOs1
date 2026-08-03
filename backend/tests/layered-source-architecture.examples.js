import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = dirname(fileURLToPath(new URL("../src/app.js", import.meta.url)));

const EXPECTED = {
  core: ["auth", "shops", "staff", "permissions", "devices", "subscriptions", "taxes", "payments", "expenses", "audit", "sync"],
  domains: ["catalog", "inventory", "purchases", "sales", "returns", "customers", "suppliers"],
  infrastructure: ["database", "cache", "jobs", "storage", "notifications"],
  shared: ["errors", "validation", "middleware", "types"],
};

test("requested source layers have importable entry-point files", () => {
  for (const [layer, areas] of Object.entries(EXPECTED)) {
    assert.equal(existsSync(join(src, layer, "index.js")), true, `${layer}/index.js missing`);
    for (const area of areas) {
      assert.equal(existsSync(join(src, layer, area, "index.js")), true, `${layer}/${area}/index.js missing`);
    }
  }
});

test("requested vertical families have explicit entry points", () => {
  for (const vertical of ["kirana", "variants", "auto-parts", "electronics", "pharmacy", "books", "furniture", "cosmetics", "restaurant"]) {
    const entry = vertical === "variants" || vertical === "books" ? "index.js" : "profile.js";
    assert.equal(existsSync(join(src, "verticals", vertical, entry)), true, `verticals/${vertical}/${entry} missing`);
  }
});

test("application composition imports mapped features through architectural layers", () => {
  const app = readFileSync(join(src, "app.js"), "utf8");
  assert.match(app, /from "\.\/core\/auth\/index\.js"/);
  assert.match(app, /from "\.\/core\/shops\/index\.js"/);
  assert.match(app, /from "\.\/domains\/catalog\/index\.js"/);
  assert.match(app, /from "\.\/domains\/inventory\/index\.js"/);
  assert.match(app, /from "\.\/infrastructure\/database\/index\.js"/);
  assert.match(app, /from "\.\/shared\/errors\/index\.js"/);
});

test("shared and domain layer entry points never depend on a shop vertical", () => {
  for (const layer of ["shared", "domains", "core", "infrastructure"]) {
    const files = [join(src, layer, "index.js"), ...EXPECTED[layer].map((area) => join(src, layer, area, "index.js"))];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /verticals\//, `${file} imports a vertical`);
    }
  }
});

test("API job entry point cannot initialize the worker runtime", () => {
  const jobs = readFileSync(join(src, "infrastructure", "jobs", "index.js"), "utf8");
  assert.doesNotMatch(jobs, /workers\/(queues|schedulers)/);
  assert.equal(existsSync(join(src, "infrastructure", "jobs", "worker-runtime.js")), true);
});
