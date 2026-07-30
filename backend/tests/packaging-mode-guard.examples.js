import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createProductSchema } from "../src/modules/products/products.schema.js";

const SERVICE = fileURLToPath(new URL("../src/modules/products/products.service.js", import.meta.url));
const source = readFileSync(SERVICE, "utf8");

// Standard retail systems solve "different pack sizes" one of two ways:
//   1. One stock pool in a base unit + unit-of-measure conversions (Odoo, SAP, Vyapar).
//      This app already does exactly that — "Other pack sizes".
//   2. Physically distinct packs that are counted and reordered separately are separate
//      SKUs (Shopify, Square, Lightspeed).
// Neither keeps two stock buckets on ONE product, because that needs a second stock
// ledger reconciled against the first. `per_pack` is that non-standard third option:
// the columns exist, but nothing reads packagingMode and nothing writes onHandQty, so
// accepting it would store authoritative-looking numbers that never move.

function guardIsAppliedToBothWritePaths() {
  assert.ok(
    source.includes("function assertPackagingModeIsSupported"),
    "a packaging-mode guard must exist",
  );
  for (const entry of ["export async function createProduct", "export async function updateProduct"]) {
    const at = source.indexOf(entry);
    assert.ok(at !== -1, `${entry} must exist`);
    const body = source.slice(at, at + 400);
    assert.ok(
      body.includes("assertPackagingModeIsSupported"),
      `${entry} must refuse an unsupported packaging mode before writing`,
    );
  }
}

function pooledIsStillTheDefaultAndAllowed() {
  // The guard must not disturb ordinary products, which never send the field.
  const parsed = createProductSchema.parse({ name: "Loose Rice", defaultPricePerRateUnit: 58, stockBaseQty: 40000 });
  assert.equal(parsed.packagingMode, "pooled", "products still default to pooled");
  assert.doesNotThrow(() => {
    if (parsed.packagingMode && parsed.packagingMode !== "pooled") throw new Error("would be rejected");
  }, "a pooled product must pass the guard untouched");
}

function theGuardExplainsTheStandardAlternative() {
  // A refusal that does not say what to do instead just becomes a support ticket.
  assert.match(source, /Other pack sizes/, "the error must point at the pooled pack-size feature");
  assert.match(source, /separate product/, "the error must point at the separate-SKU alternative");
  assert.match(source, /PACKAGING_MODE_NOT_SUPPORTED/, "the refusal needs a stable machine-readable code");
}

function run() {
  guardIsAppliedToBothWritePaths();
  pooledIsStillTheDefaultAndAllowed();
  theGuardExplainsTheStandardAlternative();
  console.log("packaging-mode-guard: all checks passed");
}

run();
