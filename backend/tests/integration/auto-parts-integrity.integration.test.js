import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, createProduct, createStaff, login } from "./factories.js";
import { settingsForBusinessType } from "../../src/verticals/registry.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("auto-parts integrity unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));
  async function fixture() {
    const tenant = await createTenant(ctx.db, { planCode: "pro" });
    await ctx.db.shop.update({ where: { id: tenant.shop.id }, data: { settingsJson: JSON.stringify(settingsForBusinessType("auto_parts")) } });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const options = { token: auth.accessToken };
    const product = await createProduct(ctx.db, tenant.shop.id);
    const fitment = { productId: product.id, make: "Maruti", model: "Swift", yearFrom: 2015, yearTo: 2020 };
    const reference = { productId: product.id, partNumber: "OEM-42", kind: "oem" };
    const post = async (path, data) => assertSuccess(await ctx.post(`/api/fitment${path}`, data, options), 201);
    return { tenant, product, options, fitment, reference, post };
  }
  test("concurrent fitment and reference retries create one record and one audit each", async () => {
    const f = await fixture();
    // Activate the test device before dispatching overlapping requests.
    assertSuccess(await ctx.get("/api/fitment", f.options));
    for (const [path, data, action] of [["", f.fitment, "FITMENT_CREATED"], ["/references", f.reference, "PART_REFERENCE_CREATED"]]) {
      const [a, b] = await Promise.all([f.post(path, data), f.post(path, data)]);
      assert.equal(a.id, b.id);
      const audits = await ctx.db.auditLog.findMany({ where: { entityId: a.id, action } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].userId, f.tenant.owner.id);
    }
  });
  test("updates cannot collide with another fitment or reference and reference replays cannot change meaning", async () => {
    const f = await fixture();
    const first = await f.post("", f.fitment);
    const second = await f.post("", { ...f.fitment, model: "Dzire" });
    assertFailure(await ctx.patch(`/api/fitment/${second.id}`, { model: "swift" }, f.options), 409);
    assertFailure(await ctx.patch(`/api/fitment/${first.id}`, { yearTo: 2010 }, f.options), 400);
    const ref = await f.post("/references", f.reference);
    const other = await f.post("/references", { ...f.reference, partNumber: "OEM-43" });
    assertFailure(await ctx.patch(`/api/fitment/references/${other.id}`, { partNumber: "oem-42" }, f.options), 409);
    assertFailure(await ctx.post("/api/fitment/references", { ...f.reference, kind: "superseded_by" }, f.options), 409);
    assert.equal((await f.post("/references", f.reference)).id, ref.id);
    assert.equal(await ctx.db.partFitment.count(), 2);
    assert.equal(await ctx.db.partCrossReference.count(), 2);
  });
  test("bulk saves roll back earlier entries when mandatory audit fails", async (t) => {
    if (!process.env.DATABASE_URL?.startsWith("file:")) return t.skip("SQLite fault injection");
    const f = await fixture();
    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER qa_fitment_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'FITMENT_CREATED' AND NEW.afterJson LIKE '%Dzire%' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
    try {
      assertFailure(await ctx.post("/api/fitment/bulk", { productId: f.product.id, fitments: [{ make: "Maruti", model: "Swift" }, { make: "Maruti", model: "Dzire" }] }, f.options), 503);
      assert.equal(await ctx.db.partFitment.count(), 0);
      assert.equal(await ctx.db.auditLog.count({ where: { action: "FITMENT_CREATED" } }), 0);
    } finally { await ctx.db.$executeRawUnsafe("DROP TRIGGER qa_fitment_audit"); }
    const result = await f.post("/bulk", { productId: f.product.id, fitments: [f.fitment, f.fitment, { ...f.fitment, model: "Dzire" }] });
    assert.equal(result.created.length, 2);
    assert.equal(result.skipped.length, 1);
  });
  test("reference mutations roll back on audit failure and successful edits and removals retain history", async (t) => {
    if (!process.env.DATABASE_URL?.startsWith("file:")) return t.skip("SQLite fault injection");
    const f = await fixture();
    const ref = await f.post("/references", f.reference);
    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER qa_reference_audit BEFORE INSERT ON AuditLog WHEN NEW.action IN ('PART_REFERENCE_UPDATED','PART_REFERENCE_REMOVED') BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
    try {
      assertFailure(await ctx.patch(`/api/fitment/references/${ref.id}`, { brand: "QA" }, f.options), 503);
      assertFailure(await ctx.request("DELETE", `/api/fitment/references/${ref.id}`, f.options), 503);
      const stored = await ctx.db.partCrossReference.findUnique({ where: { id: ref.id } });
      assert.equal(stored.brand, null);
      assert.equal(stored.deletedAt, null);
    } finally { await ctx.db.$executeRawUnsafe("DROP TRIGGER qa_reference_audit"); }
    assertSuccess(await ctx.patch(`/api/fitment/references/${ref.id}`, { brand: "QA" }, f.options));
    assertSuccess(await ctx.request("DELETE", `/api/fitment/references/${ref.id}`, f.options));
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: ref.id } }), 3);
    assert.equal(assertSuccess(await ctx.get("/api/fitment/part-number/OEM-42", f.options)).references.length, 0);
  });
  test("foreign products, references and fitments cannot be modified; deleted products do not count as mapped", async () => {
    const f = await fixture();
    const other = await fixture();
    const fit = await f.post("", f.fitment);
    const ref = await f.post("/references", f.reference);
    assertFailure(await ctx.post("/api/fitment", f.fitment, other.options), 404);
    assertFailure(await ctx.patch(`/api/fitment/${fit.id}`, { model: "Foreign" }, other.options), 404);
    assertFailure(await ctx.request("DELETE", `/api/fitment/references/${ref.id}`, other.options), 404);
    assertFailure(await ctx.post("/api/fitment/references", { ...other.reference, alternateProductId: f.product.id }, other.options), 404);
    await ctx.db.product.update({ where: { id: f.product.id }, data: { deletedAt: new Date() } });
    const summary = assertSuccess(await ctx.get("/api/fitment/summary", f.options));
    assert.equal(summary.mappedParts, 0);
    assert.equal(summary.catalogueSize, 0);
    assert.equal(summary.fitments, 1);
  });
  test("renames appear consistently and alternatives require real stock at the selected branch", async () => {
    const f = await fixture();
    await f.post("", f.fitment);
    const alternate = await createProduct(ctx.db, f.tenant.shop.id, { stockBaseQty: 8 });
    await f.post("/references", { ...f.reference, alternateProductId: alternate.id });
    await ctx.db.product.update({ where: { id: f.product.id }, data: { name: "Renamed oil filter" } });
    const branch = await ctx.db.storeLocation.create({ data: { shopId: f.tenant.shop.id, code: "PARTS", name: "Parts branch" } });
    const get = (path) => ctx.get(path, { ...f.options, headers: { "x-location-id": branch.id } }).then((response) => assertSuccess(response));
    const rows = await get("/api/fitment?search=renamed");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].productName, "Renamed oil filter");
    assert.equal(rows[0].inCatalogue, true);
    let detail = await get(`/api/fitment/for-product/${f.product.id}`);
    assert.equal(detail.fitments[0].productName, "Renamed oil filter");
    assert.equal(detail.references[0].productName, "Renamed oil filter");
    assert.equal(detail.references[0].isStocked, false, "global stock is not shelf stock at an empty branch");
    assert.equal(detail.references[0].stockKnown, true);
    await ctx.db.locationStock.create({ data: { shopId: f.tenant.shop.id, locationId: branch.id, productId: alternate.id, stockBaseQty: 2 } });
    let found = await get("/api/fitment/part-number/OEM-42");
    assert.equal(found.references[0].isStocked, true);
    assert.equal(found.references[0].alternateStockQty, 2);
    assert.equal(found.references[0].productName, "Renamed oil filter");
    const matched = await get("/api/fitment/search?make=Maruti&model=Swift");
    assert.equal(matched[0].fitments[0].productName, matched[0].productName);
    await ctx.db.product.updateMany({ where: { id: { in: [f.product.id, alternate.id] } }, data: { deletedAt: new Date() } });
    detail = await get(`/api/fitment/for-product/${f.product.id}`);
    assert.equal(detail.references[0].isStocked, false);
    assert.equal(detail.references[0].alternateInCatalogue, false);
    assert.equal(detail.references[0].inCatalogue, false);
    assert.equal(detail.fitments[0].inCatalogue, false);
    found = await get("/api/fitment/part-number/OEM-42");
    assert.equal(found.products.length, 0, "removed parts must not be billable lookup results");
    assert.equal(found.references.length, 1, "historical references remain visible");
  });
  test("staff can look up parts at an assigned counter but cannot change the book without inventory access", async () => {
    const f = await fixture();
    const fit = await f.post("", f.fitment);
    const ref = await f.post("/references", f.reference);
    const staff = await createStaff(ctx.db, f.tenant.shop.id);
    const auth = await login(ctx, staff.staffMobile, staff.staffPassword);
    const primary = await ctx.db.storeLocation.findFirst({ where: { shopId: f.tenant.shop.id, isPrimary: true } });
    const branch = await ctx.db.storeLocation.create({ data: { shopId: f.tenant.shop.id, code: "OTHER", name: "Other branch" } });
    const access = await ctx.db.userLocationAccess.create({ data: { shopId: f.tenant.shop.id, userId: staff.staff.id, locationId: primary.id, canSell: true, canManageInventory: false, canPurchase: false, canTransfer: false } });
    const options = { token: auth.accessToken, headers: { "x-location-id": primary.id } };
    assert.equal(assertSuccess(await ctx.get("/api/fitment/summary", options)).canManage, false);
    assert.equal(assertSuccess(await ctx.get("/api/fitment/summary", f.options)).canManage, true);
    assert.equal(assertSuccess(await ctx.get("/api/fitment/summary?locationId=all", f.options)).canManage, false);
    assertSuccess(await ctx.get("/api/fitment/search?make=Maruti", options));
    assertSuccess(await ctx.get("/api/fitment/part-number/OEM-42", options));
    for (const [method, path, body] of [
      ["POST", "", { ...f.fitment, model: "Dzire" }],
      ["POST", "/bulk", { productId: f.product.id, fitments: [f.fitment] }],
      ["PATCH", `/${fit.id}`, { model: "Blocked" }], ["DELETE", `/${fit.id}`],
      ["POST", "/references", { ...f.reference, partNumber: "BLOCKED" }],
      ["PATCH", `/references/${ref.id}`, { brand: "Blocked" }], ["DELETE", `/references/${ref.id}`],
    ]) assertFailure(await ctx.request(method, `/api/fitment${path}`, { ...options, body }), 403);
    for (const path of ["", "/vehicles", "/summary", "/search?make=Maruti", "/part-number/OEM-42", `/for-product/${f.product.id}`]) {
      assertFailure(await ctx.get(`/api/fitment${path}`, { token: auth.accessToken, headers: { "x-location-id": branch.id } }), 403);
    }
    assertFailure(await ctx.get("/api/fitment/search?make=Maruti&locationId=all", options), 403);
    await ctx.db.userLocationAccess.update({ where: { id: access.id }, data: { canManageInventory: true } });
    assert.equal(assertSuccess(await ctx.get("/api/fitment/summary", options)).canManage, true);
    assertSuccess(await ctx.post("/api/fitment", { ...f.fitment, model: "Dzire" }, options), 201);
  });

}
