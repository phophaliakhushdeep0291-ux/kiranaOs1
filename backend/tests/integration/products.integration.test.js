import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess, todayRangeQuery } from "./setup.js";
import { activateDeviceViaApi, createProduct, createStaff, createTenant, login, productPayload } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("product/inventory integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, ownerAuth };
  }

  function packUnit(unitCode, conversionToBase, onHandQty, overrides = {}) {
    return {
      name: overrides.name ?? unitCode,
      unitType: overrides.unitType ?? "piece",
      unitCode,
      packSizeValue: null,
      packSizeUnit: null,
      conversionToBase,
      barcode: overrides.barcode ?? null,
      defaultPrice: overrides.defaultPrice ?? 20,
      minimumPrice: overrides.minimumPrice ?? 10,
      maximumPrice: overrides.maximumPrice ?? 30,
      costPrice: overrides.costPrice ?? 8,
      onHandQty,
      lowStockThreshold: overrides.lowStockThreshold ?? 1,
      reorderLevel: overrides.reorderLevel ?? 2,
      variantValue1: overrides.variantValue1 ?? null,
      variantValue2: overrides.variantValue2 ?? null,
      isDefault: overrides.isDefault === true,
      isActive: overrides.isActive !== false,
    };
  }

  function editableUnit(unit, overrides = {}) {
    return {
      id: unit.id,
      name: unit.name,
      unitType: unit.unitType,
      unitCode: unit.unitCode,
      packSizeValue: unit.packSizeValue,
      packSizeUnit: unit.packSizeUnit,
      conversionToBase: unit.conversionToBase,
      barcode: unit.barcode,
      defaultPrice: unit.defaultPrice,
      minimumPrice: unit.minimumPrice,
      maximumPrice: unit.maximumPrice,
      costPrice: unit.costPrice,
      onHandQty: unit.onHandQty,
      lowStockThreshold: unit.lowStockThreshold,
      reorderLevel: unit.reorderLevel,
      variantValue1: unit.variantValue1,
      variantValue2: unit.variantValue2,
      isDefault: unit.isDefault,
      isActive: unit.isActive,
      ...overrides,
    };
  }

  describe("product and inventory integration", () => {
    test("product create works", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = assertSuccess(await ctx.post("/api/products", productPayload({ name: "Rice" }), { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(product.name, "Rice");
    });

    test("stock history exposes immutable actor, source, quantity, time and resulting balance", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = assertSuccess(await ctx.post("/api/products", productPayload({
        name: "Traceable Rice",
        stockBaseQty: 12,
        baseUnit: "kg",
        displayUnit: "kg",
        rateUnit: "kg",
      }), { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);

      const stored = await ctx.db.stockLedger.findFirstOrThrow({
        where: { shopId: tenant.shop.id, productId: product.id, action: "opening_stock" },
      });
      assert.equal(stored.actorUserId, tenant.owner.id);
      assert.equal(stored.actorName, tenant.owner.name);
      assert.equal(stored.sourceType, "product_create");
      assert.equal(stored.sourceId, product.id);
      assert.equal(stored.changeBaseQty, 12);
      assert.equal(stored.oldStockBaseQty, 0);
      assert.equal(stored.newStockBaseQty, 12);
      assert.ok(stored.createdAt instanceof Date);

      const history = assertSuccess(await ctx.get(`/api/inventory/ledger?productId=${product.id}&page=1&limit=20`, {
        token: ownerAuth.accessToken,
      }));
      assert.equal(history.total, 1);
      assert.equal(history.entries[0].actorUserId, tenant.owner.id);
      assert.equal(history.entries[0].actorName, tenant.owner.name);
      assert.equal(history.entries[0].sourceType, "product_create");
      assert.equal(history.entries[0].unit, "kg");
      assert.equal(history.entries[0].newStockBaseQty, 12);
    });

    test("product update works", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Old Name" });
      const updated = assertSuccess(await ctx.patch(`/api/products/${product.id}`, { name: "New Name" }, { token: ownerAuth.accessToken }));
      assert.equal(updated.name, "New Name");
    });

    test("per-pack opening stock is reconciled and allocated by pack at a branch", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const branch = await ctx.db.storeLocation.create({
        data: { shopId: tenant.shop.id, code: "BR-PACK", name: "Pack Branch", isPrimary: false },
      });
      const units = [
        packUnit("small", 6, 2, { isDefault: true }),
        packUnit("large", 10, 3),
      ];
      const created = assertSuccess(await ctx.post("/api/products", {
        ...productPayload({ name: "Branch Pack Product", stockBaseQty: 42 }),
        packagingMode: "per_pack",
        sellingUnits: units,
      }, {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-location-id": branch.id },
      }), 201);

      assert.equal(created.stockBaseQty, 42);
      const opening = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: created.id, action: "opening_stock" },
        orderBy: { newStockBaseQty: "asc" },
      });
      assert.equal(opening.length, 2);
      assert.equal(opening.reduce((sum, row) => sum + row.changeBaseQty, 0), 42);
      assert.ok(opening.every((row) => row.sellingUnitId && row.locationId === branch.id));

      const locationRows = await ctx.db.locationStock.findMany({
        where: { shopId: tenant.shop.id, productId: created.id, locationId: branch.id },
      });
      assert.equal(locationRows.length, 3, "branch needs one base-total row plus one row per pack");
      assert.equal(locationRows.find((row) => row.sellingUnitId === null)?.stockBaseQty, 42);
      const storedUnits = await ctx.db.productSellingUnit.findMany({ where: { productId: created.id } });
      for (const unit of storedUnits) {
        assert.equal(
          locationRows.find((row) => row.sellingUnitId === unit.id)?.stockBaseQty,
          unit.onHandQty,
          `${unit.unitCode} branch allocation must match its opening count`,
        );
      }
    });

    test("per-pack creates reject a mismatched product total without partial data", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const name = "Mismatched Pack Product";
      const failure = assertFailure(await ctx.post("/api/products", {
        ...productPayload({ name, stockBaseQty: 99 }),
        packagingMode: "per_pack",
        sellingUnits: [packUnit("six", 6, 2, { isDefault: true }), packUnit("ten", 10, 3)],
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(failure.code, "PACKAGING_STOCK_TOTAL_MISMATCH");
      assert.equal(await ctx.db.product.count({ where: { shopId: tenant.shop.id, name } }), 0);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, productName: name } }), 0);
    });

    test("per-pack edits ledger count and conversion deltas and roll back completely on failure", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const created = assertSuccess(await ctx.post("/api/products", {
        ...productPayload({ name: "Editable Pack Product", stockBaseQty: 42 }),
        packagingMode: "per_pack",
        sellingUnits: [packUnit("small", 6, 2, { isDefault: true }), packUnit("large", 10, 3)],
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);

      const countUnits = created.sellingUnits.map((unit) => editableUnit(unit, unit.unitCode === "small" ? { onHandQty: 4 } : {}));
      const counted = assertSuccess(await ctx.patch(`/api/products/${created.id}`, {
        stockBaseQty: 54,
        sellingUnits: countUnits,
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(counted.stockBaseQty, 54);
      const countMovement = await ctx.db.stockLedger.findFirst({
        where: { productId: created.id, sourceType: "product_per_pack_edit", sellingUnitQty: 2 },
      });
      assert.equal(countMovement?.changeBaseQty, 12);

      const conversionUnits = counted.sellingUnits.map((unit) => editableUnit(unit, unit.unitCode === "small" ? { conversionToBase: 7 } : {}));
      const converted = assertSuccess(await ctx.patch(`/api/products/${created.id}`, {
        stockBaseQty: 58,
        sellingUnits: conversionUnits,
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(converted.stockBaseQty, 58);
      const conversionMovement = await ctx.db.stockLedger.findFirst({
        where: { productId: created.id, sourceType: "product_per_pack_edit", sellingUnitQty: 0 },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(conversionMovement?.changeBaseQty, 4, "changing 4 packs from 6 to 7 base units must add four base units");

      const ledgerBeforeFailure = await ctx.db.stockLedger.count({ where: { productId: created.id } });
      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_per_pack_update_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'PRODUCT_UPDATED'
        BEGIN
          SELECT RAISE(ABORT, 'forced per-pack product audit failure');
        END;
      `);
      try {
        const rollbackUnits = converted.sellingUnits.map((unit) => editableUnit(unit, unit.unitCode === "small" ? { onHandQty: 5 } : {}));
        assertFailure(await ctx.patch(`/api/products/${created.id}`, {
          stockBaseQty: 65,
          sellingUnits: rollbackUnits,
        }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 503);
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_per_pack_update_audit_failure");
      }
      const afterRollback = await ctx.db.product.findUniqueOrThrow({
        where: { id: created.id },
        include: { sellingUnits: true },
      });
      assert.equal(afterRollback.stockBaseQty, 58);
      assert.equal(afterRollback.sellingUnits.find((unit) => unit.unitCode === "small")?.onHandQty, 4);
      assert.equal(await ctx.db.stockLedger.count({ where: { productId: created.id } }), ledgerBeforeFailure);

      const disableUnits = converted.sellingUnits.map((unit) => editableUnit(unit, unit.unitCode === "large" ? { isActive: false } : {}));
      const disabled = assertFailure(await ctx.patch(`/api/products/${created.id}`, {
        stockBaseQty: 28,
        sellingUnits: disableUnits,
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(disabled.code, "PACKAGING_UNIT_HAS_STOCK");
      assert.equal((await ctx.db.productSellingUnit.findFirstOrThrow({ where: { productId: created.id, unitCode: "large" } })).isActive, true);

      const modeChange = assertFailure(await ctx.patch(`/api/products/${created.id}`, {
        packagingMode: "pooled",
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(modeChange.code, "PACKAGING_MODE_STOCK_MIGRATION_REQUIRED");
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: created.id } })).packagingMode, "per_pack");
    });

    test("product create, update, and barcode bind roll back when their required audit fails", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const branch = await ctx.db.storeLocation.create({
        data: { shopId: tenant.shop.id, code: "BR-AUDIT", name: "Audit Branch", isPrimary: false },
      });
      const branchHeaders = { "x-location-id": branch.id };

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_product_create_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action IN ('PRODUCT_CREATED_WITH_SENSITIVE_FIELDS', 'PRODUCT_CREATED')
        BEGIN
          SELECT RAISE(ABORT, 'forced product create audit failure');
        END;
      `);
      try {
        assertFailure(await ctx.post("/api/products", productPayload({ name: "Create Audit Rollback", stockBaseQty: 7 }), {
          token: ownerAuth.accessToken,
          ownerPin: tenant.ownerPin,
          headers: branchHeaders,
        }), 503);
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_product_create_audit_failure");
      }
      assert.equal(await ctx.db.product.count({ where: { shopId: tenant.shop.id, name: "Create Audit Rollback" } }), 0);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, sourceType: "product_create" } }), 0);
      assert.equal(await ctx.db.locationStock.count({ where: { shopId: tenant.shop.id, locationId: branch.id } }), 0);

      const created = assertSuccess(await ctx.post("/api/products", productPayload({ name: "Audited Branch Product", stockBaseQty: 7 }), {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
        headers: branchHeaders,
      }), 201);
      const opening = await ctx.db.stockLedger.findFirst({ where: { shopId: tenant.shop.id, productId: created.id, action: "opening_stock" } });
      assert.equal(opening?.locationId, branch.id);
      assert.equal(opening?.changeBaseQty, 7);
      assert.equal((await ctx.db.locationStock.findFirst({ where: { locationId: branch.id, productId: created.id, sellingUnitId: null } }))?.stockBaseQty, 7);
      assert.ok(await ctx.db.auditLog.findFirst({ where: { shopId: tenant.shop.id, entityId: created.id, action: "PRODUCT_CREATED_WITH_SENSITIVE_FIELDS" } }));

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_product_update_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'PRODUCT_UPDATED'
        BEGIN
          SELECT RAISE(ABORT, 'forced product update audit failure');
        END;
      `);
      try {
        assertFailure(await ctx.patch(`/api/products/${created.id}`, { stockBaseQty: 11, defaultPricePerRateUnit: 35 }, {
          token: ownerAuth.accessToken,
          ownerPin: tenant.ownerPin,
          headers: branchHeaders,
        }), 503);
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_product_update_audit_failure");
      }
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: created.id } })).defaultPricePerRateUnit, 20);
      assert.equal((await ctx.db.locationStock.findFirstOrThrow({ where: { locationId: branch.id, productId: created.id, sellingUnitId: null } })).stockBaseQty, 7);
      assert.equal(await ctx.db.stockLedger.count({ where: { productId: created.id, action: "correction" } }), 0);

      const barcodeProduct = await createProduct(ctx.db, tenant.shop.id, { name: "Barcode Audit Rollback", stockBaseQty: 0 });
      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_product_barcode_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'product_barcode_bound'
        BEGIN
          SELECT RAISE(ABORT, 'forced product barcode audit failure');
        END;
      `);
      try {
        assertFailure(await ctx.post(`/api/products/${barcodeProduct.id}/barcode`, { barcode: "8901234567890" }, {
          token: ownerAuth.accessToken,
        }), 503);
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_product_barcode_audit_failure");
      }
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: barcodeProduct.id } })).barcode, null);
    });

    test("server-side product management blocks cashier API bypass and protects sensitive offline updates", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const cashier = await createStaff(ctx.db, tenant.shop.id, { role: "staff" });
      const cashierAuth = await login(ctx, cashier.staffMobile, cashier.staffPassword);
      assertFailure(await ctx.post("/api/products", productPayload({ name: "Cashier Bypass" }), {
        token: cashierAuth.accessToken,
        ownerPin: tenant.ownerPin,
      }), 403);

      const device = await activateDeviceViaApi(ctx, ownerAuth.accessToken, { deviceId: "product-sync-approval" });
      const headers = { "x-device-id": device.deviceId };
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Offline Protected Product", defaultPricePerRateUnit: 20 });

      const harmless = assertSuccess(await ctx.post("/api/sync/push", { events: [{
        eventId: "product-name-only-update",
        type: "UPDATE_PRODUCT",
        payload: { productId: product.id, changes: { name: "Offline Renamed Product" } },
      }] }, { token: ownerAuth.accessToken, headers }));
      assert.equal(harmless.summary.synced, 1, "a name-only edit must not ask for a PIN just because full product payloads normally contain prices");

      const rejected = assertSuccess(await ctx.post("/api/sync/push", { events: [{
        eventId: "product-sensitive-update-without-pin",
        type: "UPDATE_PRODUCT",
        payload: { productId: product.id, changes: { defaultPricePerRateUnit: 45 } },
      }] }, { token: ownerAuth.accessToken, headers }));
      assert.equal(rejected.summary.failed, 1);
      assert.equal(rejected.results[0].code, "PERMISSION_DENIED");
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).defaultPricePerRateUnit, 20);

      const approved = assertSuccess(await ctx.post("/api/sync/push", { events: [{
        eventId: "product-sensitive-update-with-pin",
        type: "UPDATE_PRODUCT",
        payload: { productId: product.id, changes: { defaultPricePerRateUnit: 45 }, ownerPin: tenant.ownerPin, reason: "Approved price revision" },
      }] }, { token: ownerAuth.accessToken, headers }));
      assert.equal(approved.summary.synced, 1);
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).defaultPricePerRateUnit, 45);
      const audit = await ctx.db.auditLog.findFirst({ where: { shopId: tenant.shop.id, entityId: product.id, action: "PRODUCT_UPDATED" }, orderBy: { createdAt: "desc" } });
      assert.match(audit?.metadataJson ?? "", /Approved price revision/);
    });

    test("product findMany, loose-item fields, and search work for billing", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const created = assertSuccess(await ctx.post("/api/products", productPayload({
        name: "Loose Sugar",
        category: "grocery",
        displayUnit: "kg",
        baseUnit: "g",
        rateUnit: "kg",
        isLooseItem: true,
        brand: "Daily",
        mrp: 48,
        reorderLevel: 5,
        description: "Loose counter sugar",
        imageUrl: "https://example.test/sugar.png",
      }), { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);

      assert.equal(created.isLooseItem, true);
      assert.equal(created.brand, "Daily");
      assert.equal(created.mrp, 48);
      assert.equal(created.reorderLevel, 5);

      const rows = await ctx.db.product.findMany({ where: { shopId: tenant.shop.id, name: "Loose Sugar" } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].isLooseItem, true);

      const updated = assertSuccess(await ctx.patch(`/api/products/${created.id}`, {
        isLooseItem: false,
        brand: "Daily Select",
        mrp: 50,
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(updated.isLooseItem, false);
      assert.equal(updated.brand, "Daily Select");
      assert.equal(updated.mrp, 50);

      const search = assertSuccess(await ctx.get("/api/products?search=Sugar", { token: ownerAuth.accessToken }));
      assert.ok(search.some((product) => product.id === created.id), "billing product search should return the created product");
    });

    test("product soft delete works and list excludes deleted products", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Delete Me" });
      assertSuccess(await ctx.delete(`/api/products/${product.id}`, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      const list = assertSuccess(await ctx.get("/api/products", { token: ownerAuth.accessToken }));
      assert.equal(list.some((p) => p.id === product.id), false);
    });

    test("product restore works", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id);
      await ctx.delete(`/api/products/${product.id}`, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin });
      const restored = assertSuccess(await ctx.post(`/api/products/${product.id}/restore`, {}, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(restored.id, product.id);
      assert.equal(restored.deletedAt, null);
    });

    test("stock purchase increases stock", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5, costPerRateUnit: 10 });
      const purchaseRequest = {
        idempotencyKey: "products-purchase-proof-1",
        productId: product.id,
        supplierName: "Test Supplier",
        quantity: 3,
        enteredUnit: "piece",
        billAmount: 45,
        supplierBillNo: "SUP-1001",
        purchasePaymentStatus: "partial",
        purchasePaymentMode: "cash",
        purchasePaidAmount: 30,
        purchaseDueAmount: 15,
        purchaseDueDate: "2026-06-15",
        updateCost: false,
      };
      const result = assertSuccess(await ctx.post("/api/inventory/purchase", purchaseRequest, { token: ownerAuth.accessToken }), 201);
      assert.equal(result.newStock, 8);
      assert.equal(result.invoiceNumber, "SUP-1001");
      assert.equal(result.purchasePaymentStatus, "partial");
      assert.equal(result.purchasePaymentMode, "cash");
      assert.equal(result.purchasePaidAmount, 30);
      assert.equal(result.purchaseDueAmount, 15);

      const history = await ctx.db.purchaseHistory.findFirst({ where: { productId: product.id, shopId: tenant.shop.id } });
      assert.equal(history.invoiceNumber, "SUP-1001");
      assert.equal(history.purchasePaymentStatus, "partial");
      assert.equal(history.purchasePaymentMode, "cash");
      assert.equal(history.purchasePaidAmount, 30);
      assert.equal(history.purchaseDueAmount, 15);
      assert.equal(history.purchaseDueDate.toISOString().slice(0, 10), "2026-06-15");

      const ledger = await ctx.db.stockLedger.findFirst({ where: { productId: product.id, shopId: tenant.shop.id, action: "purchase" } });
      assert.equal(ledger.invoiceNumber, "SUP-1001");
      assert.equal(ledger.purchasePaidAmount, 30);
      assert.equal(ledger.purchaseDueAmount, 15);

      const summary = assertSuccess(await ctx.get(`/api/reports/payment-summary?${todayRangeQuery()}`, { token: ownerAuth.accessToken }));
      assert.equal(summary.purchaseCashPaid, 30);
      assert.equal(summary.purchaseDue, 15);

      const replay = assertSuccess(await ctx.post("/api/inventory/purchase", purchaseRequest, { token: ownerAuth.accessToken }), 200);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, idempotencyKey: purchaseRequest.idempotencyKey } }), 1);
      assert.equal(await ctx.db.purchaseHistory.count({ where: { shopId: tenant.shop.id, productId: product.id } }), 1);

      const changedReplay = assertFailure(await ctx.post("/api/inventory/purchase", {
        ...purchaseRequest,
        quantity: 4,
      }, { token: ownerAuth.accessToken }), 409);
      assert.equal(changedReplay.code, "IDEMPOTENCY_KEY_REUSED");
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, idempotencyKey: purchaseRequest.idempotencyKey } }), 1);
      assert.equal(await ctx.db.purchaseHistory.count({ where: { shopId: tenant.shop.id, productId: product.id } }), 1);
    });

    test("stock damage decreases stock", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5 });
      const result = assertSuccess(await ctx.post("/api/inventory/damage", {
        idempotencyKey: "products-damage-proof-1",
        productId: product.id,
        quantity: 2,
        enteredUnit: "piece",
        note: "broken",
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(result.newStockBaseQty, 3);

      const changedReplay = assertFailure(await ctx.post("/api/inventory/damage", {
        idempotencyKey: "products-damage-proof-1",
        productId: product.id,
        quantity: 1,
        enteredUnit: "piece",
        note: "changed retry",
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(changedReplay.code, "IDEMPOTENCY_KEY_REUSED");
      const refreshed = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshed.stockBaseQty, 3);
    });

    test("stock correction requires PIN for staff", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5 });
      assertFailure(await ctx.post("/api/inventory/correction", {
        productId: product.id,
        newStockBaseQty: 10,
      }, { token: staffAuth.accessToken }), 403);
    });

    test("low-stock endpoint returns low-stock product", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 2, lowStockThreshold: 5 });
      const low = assertSuccess(await ctx.get("/api/inventory/low-stock", { token: ownerAuth.accessToken }));
      assert.ok(low.some((p) => p.id === product.id));
    });
  });
}
