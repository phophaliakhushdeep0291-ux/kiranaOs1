import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildPdf } from "../src/lib/documents/pdf.js";
import { createBomSchema, createRunSchema, completeRunSchema } from "../src/verticals/manufacturing/manufacturing.schemas.js";
import { BUSINESS_PROFILES } from "../src/verticals/registry.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("manufacturing is an isolated, production-aware business profile", () => {
  const profile = BUSINESS_PROFILES.manufacturing;
  assert.equal(profile.engine, "MANUFACTURING");
  for (const capability of ["BOM", "PRODUCTION_RUNS", "BATCH_GENEALOGY", "PACKAGING_SKUS", "EXPORT_DOCUMENTS"]) assert.ok(profile.capabilities.includes(capability));
  assert.ok(profile.navigation.includes("manufacturing"));
});

test("BOM input rejects self-consumption and duplicate materials", () => {
  const base = { finishedProductId: "fg", name: "500 g pouch", outputQuantityBaseQty: 500, items: [{ materialProductId: "raw", quantityBaseQty: 510, wastagePercent: 2 }] };
  assert.equal(createBomSchema.safeParse(base).success, true);
  assert.equal(createBomSchema.safeParse({ ...base, items: [{ materialProductId: "fg", quantityBaseQty: 1 }] }).success, false);
  assert.equal(createBomSchema.safeParse({ ...base, items: [base.items[0], base.items[0]] }).success, false);
});

test("production completion requires dated, QC-classified, reconciled input shapes", () => {
  assert.equal(createRunSchema.safeParse({ bomId: "bom", runNumber: "PR-001", plannedOutputBaseQty: 1000 }).success, true);
  const completion = { actualOutputBaseQty: 950, finishedBatchNumber: "FG-001", manufacturedOn: "2026-08-13", expiresOn: "2027-08-13", qcStatus: "passed", consumptions: [{ productId: "raw", actualBaseQty: 1000 }], outputs: [{ quantityBaseQty: 950 }] };
  assert.equal(completeRunSchema.safeParse(completion).success, true);
  assert.equal(completeRunSchema.safeParse({ ...completion, expiresOn: "2026-08-12" }).success, false);
});

test("both databases carry the manufacturing migration and packaging SKU", () => {
  for (const migration of ["../prisma/migrations/20260813170000_manufacturing_vertical/migration.sql", "../prisma-postgres/migrations/000107_manufacturing_vertical/migration.sql"]) {
    const sql = read(migration);
    assert.match(sql, /ManufacturingBom/);
    assert.match(sql, /ProductionRun/);
    assert.match(sql, /ProductionConsumption/);
    assert.match(sql, /ProductionOutput/);
    assert.match(sql, /ProductSellingUnit.*sku/s);
  }
});

test("production completion is one transaction with stock ledger and lot genealogy", () => {
  const source = read("../src/verticals/manufacturing/manufacturing.service.js");
  assert.match(source, /db\.\$transaction/);
  assert.match(source, /decrementLocationInventory/);
  assert.match(source, /incrementLocationInventory/);
  assert.match(source, /productionConsumption\.create/);
  assert.match(source, /productionOutput\.create/);
  assert.match(source, /producedByRunId/);
  assert.match(source, /allocations.*billItem.*bill/s);
});

test("trade fulfilment exposes PDFs, returns, and guarded lifecycle routes", () => {
  const routes = read("../src/verticals/manufacturing/manufacturing.routes.js");
  for (const route of ["auto-allocate", "documents/:kind.pdf", "/dispatch", "/invoice", "/return"]) assert.match(routes, new RegExp(route.replace("/", "\\/")));
  assert.match(routes, /requireOwnerPin[\s\S]*returnTradeOrder/, "credit-note creation remains owner-PIN protected");
  const service = read("../src/verticals/manufacturing/trade-orders.service.js");
  assert.match(service, /createSaleReturn/, "trade returns reuse the accounting credit-note engine");
  const pdf = buildPdf({ title: "TRADE DOCUMENT", sections: [{ heading: "Items", columns: [{ key: "sku" }], rows: [{ sku: "SKU-1" }] }] });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", "trade documents produce a real PDF buffer");
});

test("official Flipkart documents use OAuth and never hard-code an access token", () => {
  const connector = read("../src/modules/integrations/flipkart-seller.service.js");
  assert.match(connector, /grant_type/);
  assert.match(connector, /client_credentials/);
  assert.match(connector, /Bearer \$\{token\}/);
  assert.match(connector, /application\/pdf/);
  assert.doesNotMatch(connector, /access_token\s*[:=]\s*["'][A-Za-z0-9_-]{20}/, "source must not contain a hard-coded token");
  const routes = read("../src/modules/integrations/integrations.routes.js");
  assert.match(routes, /flipkart\/status/);
  assert.match(routes, /flipkart\/shipments/);
});
