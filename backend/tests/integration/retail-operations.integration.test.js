import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { billPayload, createCustomer, createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("retail operations integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  // Batch and gift-card expiry must be stated relative to the run, never as a
  // literal date: a hardcoded `expiresOn` silently becomes a past date and the
  // API then correctly refuses the fixture (BATCH_ALREADY_EXPIRED), so the suite
  // turns red one morning on a code change that never happened.
  function isoDaysFromNow(days) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  async function ownerContext(overrides = {}) {
    const tenant = await createTenant(ctx.db, { planCode: "pro", gstNumber: "27AAPFU0939F1ZV", ...overrides });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, auth };
  }

  describe("retail operations foundation", () => {
    test("creates a second store and atomically transfers location stock", async () => {
      const { tenant, auth } = await ownerContext();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Branch Rice", stockBaseQty: 20 });
      const locations = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken }));
      assert.equal(locations.locations.length, 1);
      assert.equal(locations.locations[0].isPrimary, true);

      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Market Branch", code: "MKT01", city: "Pune" }, { token: auth.accessToken }), 201);
      const transfer = assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: locations.locations[0].id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 7, declaredTaxableValue: 350 }],
        note: "Opening stock",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(transfer.status, "completed");

      const mainInventory = assertSuccess(await ctx.get(`/api/stores/${locations.locations[0].id}/inventory`, { token: auth.accessToken }));
      const branchInventory = assertSuccess(await ctx.get(`/api/stores/${branch.id}/inventory`, { token: auth.accessToken }));
      assert.equal(mainInventory.products.find((row) => row.id === product.id).stockBaseQty, 13);
      assert.equal(branchInventory.products.find((row) => row.id === product.id).stockBaseQty, 7);
      const mainCatalog = assertSuccess(await ctx.get("/api/products", { token: auth.accessToken, headers: { "x-location-id": locations.locations[0].id } }));
      const branchCatalog = assertSuccess(await ctx.get("/api/products", { token: auth.accessToken, headers: { "x-location-id": branch.id } }));
      assert.equal(mainCatalog.find((row) => row.id === product.id).stockBaseQty, 13, "primary catalog must show residual branch stock");
      assert.equal(branchCatalog.find((row) => row.id === product.id).stockBaseQty, 7, "branch catalog must show branch stock instead of company stock");
      assert.equal(branchCatalog.find((row) => row.id === product.id).inventoryLocationId, branch.id);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 20, "a transfer must not change company-wide stock");

      const overdraw = assertFailure(await ctx.post("/api/stores/transfers", {
        fromLocationId: branch.id,
        toLocationId: locations.locations[0].id,
        items: [{ productId: product.id, quantityBaseQty: 8, declaredTaxableValue: 200 }], ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(overdraw.code, "INSUFFICIENT_LOCATION_STOCK");
    });

    test("dispatches multi-line shipments, reserves in-transit stock, and receives them partially", async () => {
      const { tenant, auth } = await ownerContext();
      const rice = await createProduct(ctx.db, tenant.shop.id, { name: "Shipment Rice", stockBaseQty: 20, lowStockThreshold: 5, reorderLevel: 10, gstRate: 5, hsn: "1006" });
      const oil = await createProduct(ctx.db, tenant.shop.id, { name: "Shipment Oil", stockBaseQty: 10, lowStockThreshold: 0, gstRate: 5, hsn: "1507" });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];
      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Shipment Branch", code: "SHIP01", city: "Pune" }, { token: auth.accessToken }), 201);

      const initialReplenishment = assertSuccess(await ctx.get("/api/stores/replenishment-suggestions", { token: auth.accessToken }));
      assert.equal(initialReplenishment.sourceLocation.id, primary.id);
      assert.equal(initialReplenishment.suggestions.length, 1);
      assert.equal(initialReplenishment.suggestions[0].destinationLocation.id, branch.id);
      assert.equal(initialReplenishment.suggestions[0].productId, rice.id);
      assert.equal(initialReplenishment.suggestions[0].recommendedTransferBaseQty, 15);
      assert.equal(initialReplenishment.suggestions[0].reasonCode, "out_of_stock");

      const transfer = assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        fulfillmentMode: "shipment",
        expectedArrivalDate: "2026-08-12",
        carrierName: "Local branch van",
        trackingNumber: "VAN-2026-001",
        items: [
          { productId: rice.id, quantityBaseQty: 7, declaredTaxableValue: 350 },
          { productId: oil.id, quantityBaseQty: 4, declaredTaxableValue: 400 },
        ],
        note: "Weekly replenishment",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(transfer.status, "in_transit");
      assert.equal(transfer.fulfillmentMode, "shipment");
      assert.equal(transfer.items.length, 2);
      assert.equal(transfer.items.every((item) => item.receivedBaseQty === 0), true);

      const whileMovingMain = assertSuccess(await ctx.get(`/api/stores/${primary.id}/inventory`, { token: auth.accessToken }));
      const whileMovingBranch = assertSuccess(await ctx.get(`/api/stores/${branch.id}/inventory`, { token: auth.accessToken }));
      assert.equal(whileMovingMain.products.find((row) => row.id === rice.id).stockBaseQty, 13, "dispatched primary stock must not remain sellable");
      assert.equal(whileMovingMain.products.find((row) => row.id === oil.id).stockBaseQty, 6);
      assert.equal(whileMovingBranch.products.find((row) => row.id === rice.id).stockBaseQty, 0, "destination stock appears only after receipt");
      const coveredReplenishment = assertSuccess(await ctx.get("/api/stores/replenishment-suggestions", { token: auth.accessToken }));
      assert.equal(coveredReplenishment.suggestions.some((row) => row.destinationLocation.id === branch.id && row.productId === rice.id), false, "open incoming stock must prevent duplicate replenishment advice");

      const riceLine = transfer.items.find((item) => item.productId === rice.id);
      const oilLine = transfer.items.find((item) => item.productId === oil.id);
      const partial = assertSuccess(await ctx.post(`/api/stores/transfers/${transfer.id}/receive`, {
        items: [
          { transferItemId: riceLine.id, quantityBaseQty: 3 },
          { transferItemId: oilLine.id, quantityBaseQty: 4 },
        ],
        note: "First van unload",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(partial.status, "partially_received");
      assert.equal(partial.receiptSummary.openLineCount, 1);
      assert.equal(partial.items.find((item) => item.id === riceLine.id).remainingBaseQty, 4);

      const afterPartialMain = assertSuccess(await ctx.get(`/api/stores/${primary.id}/inventory`, { token: auth.accessToken }));
      const afterPartialBranch = assertSuccess(await ctx.get(`/api/stores/${branch.id}/inventory`, { token: auth.accessToken }));
      assert.equal(afterPartialMain.products.find((row) => row.id === rice.id).stockBaseQty, 13, "partial receipt must not release the unreceived reservation");
      assert.equal(afterPartialBranch.products.find((row) => row.id === rice.id).stockBaseQty, 3);
      assert.equal(afterPartialBranch.products.find((row) => row.id === oil.id).stockBaseQty, 4);

      const overReceive = assertFailure(await ctx.post(`/api/stores/transfers/${transfer.id}/receive`, {
        items: [{ transferItemId: riceLine.id, quantityBaseQty: 5 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(overReceive.code, "TRANSFER_RECEIPT_EXCEEDS_REMAINING");

      const completed = assertSuccess(await ctx.post(`/api/stores/transfers/${transfer.id}/receive`, {
        items: [{ transferItemId: riceLine.id, quantityBaseQty: 4 }],
        note: "Final unload",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(completed.status, "completed");
      assert.equal(completed.receiptSummary.openLineCount, 0);
      const finalBranch = assertSuccess(await ctx.get(`/api/stores/${branch.id}/inventory`, { token: auth.accessToken }));
      assert.equal(finalBranch.products.find((row) => row.id === rice.id).stockBaseQty, 7);
      assert.equal((await ctx.db.product.findUnique({ where: { id: rice.id } })).stockBaseQty, 20, "shipments never change company-wide stock");

      const cancellable = assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        fulfillmentMode: "shipment",
        items: [{ productId: rice.id, quantityBaseQty: 2, declaredTaxableValue: 100 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      const cancelled = assertSuccess(await ctx.post(`/api/stores/transfers/${cancellable.id}/cancel`, {
        reason: "Carrier could not collect the shipment",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(cancelled.status, "cancelled");
      const afterCancelMain = assertSuccess(await ctx.get(`/api/stores/${primary.id}/inventory`, { token: auth.accessToken }));
      assert.equal(afterCancelMain.products.find((row) => row.id === rice.id).stockBaseQty, 13, "cancelling returns the unreceived reservation to source");

      const audits = await ctx.db.auditLog.findMany({ where: { shopId: tenant.shop.id, entityId: transfer.id } });
      assert.equal(audits.some((row) => row.action === "STOCK_TRANSFER_DISPATCHED"), true);
      assert.equal(audits.some((row) => row.action === "STOCK_TRANSFER_PARTIALLY_RECEIVED"), true);
      assert.equal(audits.some((row) => row.action === "STOCK_TRANSFER_RECEIVED"), true);
    });

    test("validates location GSTINs, documents distinct-registration transfers, and preserves bill seller snapshots", async () => {
      const { tenant, auth } = await ownerContext();
      const product = await createProduct(ctx.db, tenant.shop.id, {
        name: "Registered Transfer Goods",
        stockBaseQty: 10,
        defaultPricePerRateUnit: 118,
        gstRate: 18,
        hsn: "1905",
      });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];
      assert.equal(primary.gstNumber, "27AAPFU0939F1ZV");
      assert.equal(primary.gstStateCode, "27");
      assert.equal(primary.taxRegistration.formatValid, true);
      assert.equal(primary.taxRegistration.notice.includes("not verified"), true);

      const invalidLocation = assertFailure(await ctx.post("/api/stores", {
        name: "Invalid Registration Branch",
        code: "BADGST",
        gstNumber: "29AAPFU0939F1ZA",
      }, { token: auth.accessToken }), 400);
      assert.equal(invalidLocation.code, "VALIDATION_FAILED");
      assert.match(invalidLocation.details.gstNumber.join(" "), /checksum/i);

      const branch = assertSuccess(await ctx.post("/api/stores", {
        name: "Karnataka Registered Branch",
        code: "KAR01",
        city: "Bengaluru",
        address: "12 Market Road",
        gstNumber: "29AAPFU0939F1ZR",
        gstLegalName: "Karnataka Branch Private Limited",
        gstTradeName: "KiranaOS Karnataka",
        gstRegistrationType: "regular",
      }, { token: auth.accessToken }), 201);
      assert.equal(branch.gstStateCode, "29");
      assert.equal(branch.taxRegistration.formatValid, true);
      assert.equal(branch.taxRegistration.status, "format_valid");

      const missingValue = assertFailure(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 2 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 422);
      assert.equal(missingValue.code, "TRANSFER_VALUE_REQUIRED");

      const missingInvoice = assertFailure(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 2, declaredTaxableValue: 200 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 422);
      assert.equal(missingInvoice.code, "TRANSFER_TAX_INVOICE_REQUIRED");

      const transfer = assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        movementReason: "branch_transfer",
        documentType: "tax_invoice",
        documentNumber: "INV/26-27/001",
        documentDate: "2026-07-28",
        items: [{ productId: product.id, quantityBaseQty: 2, declaredTaxableValue: 200 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(transfer.gstTreatment, "distinct_registration_supply");
      assert.equal(transfer.isInterstate, true);
      assert.equal(transfer.fromGstin, "27AAPFU0939F1ZV");
      assert.equal(transfer.toGstin, "29AAPFU0939F1ZR");
      assert.equal(transfer.taxableValue, 200);
      assert.equal(transfer.igst, 36);
      assert.equal(transfer.cgst, 0);
      assert.equal(transfer.sgst, 0);
      assert.equal(transfer.taxTotal, 36);
      assert.equal(transfer.consignmentValue, 236);
      assert.equal(transfer.legalSubmissionStatus, "not_submitted");
      assert.match(transfer.complianceNotice, /not verified/i);

      const duplicateDocument = assertFailure(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        documentType: "tax_invoice",
        documentNumber: "INV/26-27/001",
        documentDate: "2026-07-28",
        items: [{ productId: product.id, quantityBaseQty: 1, declaredTaxableValue: 100 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(duplicateDocument.code, "TRANSFER_DOCUMENT_DUPLICATE");
      const branchInventoryAfterDuplicate = assertSuccess(await ctx.get(`/api/stores/${branch.id}/inventory`, { token: auth.accessToken }));
      assert.equal(branchInventoryAfterDuplicate.products.find((row) => row.id === product.id).stockBaseQty, 2, "a duplicate document must roll back stock movement");
      const externalReviewTransfer = assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        documentType: "tax_invoice",
        documentNumber: "INV/26-27/002",
        documentDate: "2026-07-28",
        items: [{ productId: product.id, quantityBaseQty: 1, declaredTaxableValue: 60000 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      const notRequiredTransfer = assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        documentType: "tax_invoice",
        documentNumber: "INV/26-27/003",
        documentDate: "2026-07-28",
        items: [{ productId: product.id, quantityBaseQty: 1, declaredTaxableValue: 60000 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(externalReviewTransfer.eWayReviewRequired, true);
      assert.equal(externalReviewTransfer.eWayReviewStatus, "pending");
      assert.equal(notRequiredTransfer.eWayReviewStatus, "pending");

      const pendingReadiness = assertSuccess(await ctx.get("/api/compliance/readiness", { token: auth.accessToken }));
      assert.equal(pendingReadiness.gaps.pendingEWayReviewCount, 2);
      assert.equal(pendingReadiness.checks.find((row) => row.key === "eway").ready, false);

      const invalidExternalEvidence = assertFailure(await ctx.post(`/api/stores/transfers/${externalReviewTransfer.id}/compliance-review`, {
        decision: "external_reference_recorded",
        reason: "Generated externally by the authorised operator",
        eWayBillNumber: "1234",
        eWayBillDate: "2026-07-28",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 400);
      assert.equal(invalidExternalEvidence.code, "VALIDATION_FAILED");

      const externalEvidence = assertSuccess(await ctx.post(`/api/stores/transfers/${externalReviewTransfer.id}/compliance-review`, {
        decision: "external_reference_recorded",
        reason: "Generated externally by the authorised operator",
        eWayBillNumber: "181000609270",
        eWayBillDate: "2026-07-28",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(externalEvidence.eWayReviewRequired, false);
      assert.equal(externalEvidence.eWayReviewStatus, "external_reference_recorded");
      assert.equal(externalEvidence.eWayBillNumber, "181000609270");
      assert.equal(externalEvidence.legalSubmissionStatus, "external_reference_recorded_not_verified");
      assert.match(externalEvidence.complianceNotice, /not verified/i);

      const reasonedDecision = assertSuccess(await ctx.post(`/api/stores/transfers/${notRequiredTransfer.id}/compliance-review`, {
        decision: "not_required_after_review",
        reason: "Movement was reviewed against the applicable exemption evidence",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(reasonedDecision.eWayReviewRequired, false);
      assert.equal(reasonedDecision.eWayReviewStatus, "not_required_after_review");
      assert.equal(reasonedDecision.eWayBillNumber, null);
      assert.match(reasonedDecision.complianceNotice, /does not make the legal determination/i);

      const duplicateReview = assertFailure(await ctx.post(`/api/stores/transfers/${externalReviewTransfer.id}/compliance-review`, {
        decision: "not_required_after_review",
        reason: "Attempted duplicate review must not overwrite evidence",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(duplicateReview.code, "TRANSFER_EWAY_REVIEW_NOT_PENDING");
      const resolvedReadiness = assertSuccess(await ctx.get("/api/compliance/readiness", { token: auth.accessToken }));
      assert.equal(resolvedReadiness.gaps.pendingEWayReviewCount, 0);
      assert.equal(resolvedReadiness.checks.find((row) => row.key === "eway").ready, true);

      const firstBill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        billType: "gst_invoice",
        quantity: 1,
        ratePerRateUnit: 118,
        gstRate: 18,
        hsn: "1905",
      }), { token: auth.accessToken, headers: { "x-location-id": branch.id } }), 201);
      assert.equal(firstBill.sellerGstin, "29AAPFU0939F1ZR");
      assert.equal(firstBill.sellerStateCode, "29");
      assert.equal(firstBill.sellerLegalName, "Karnataka Branch Private Limited");
      assert.equal(firstBill.sellerTradeName, "KiranaOS Karnataka");

      const movedRegistration = assertSuccess(await ctx.request("PATCH", `/api/stores/${branch.id}`, {
        token: auth.accessToken,
        body: {
          gstNumber: "07AAPFU0939F1ZX",
          gstLegalName: "Delhi Branch Private Limited",
          gstTradeName: "KiranaOS Delhi",
          city: "New Delhi",
        },
      }));
      assert.equal(movedRegistration.gstStateCode, "07");
      const storedFirstBill = await ctx.db.bill.findUnique({ where: { id: firstBill.id } });
      assert.equal(storedFirstBill.sellerGstin, "29AAPFU0939F1ZR", "location edits must not rewrite historical seller identity");
      assert.equal(storedFirstBill.sellerLegalName, "Karnataka Branch Private Limited");

      const secondBill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        billType: "gst_invoice",
        quantity: 1,
        ratePerRateUnit: 118,
        gstRate: 18,
        hsn: "1905",
      }), { token: auth.accessToken, headers: { "x-location-id": branch.id } }), 201);
      assert.equal(secondBill.sellerGstin, "07AAPFU0939F1ZX");
      assert.equal(secondBill.sellerStateCode, "07");

      const register = assertSuccess(await ctx.get("/api/compliance/gst-register?range=yearly&format=json&locationId=all", { token: auth.accessToken }));
      assert.equal(register.registrationScope.filingScopeRequired, true);
      assert.deepEqual(new Set(register.rows.map((row) => row.sellerGstin)), new Set(["29AAPFU0939F1ZR", "07AAPFU0939F1ZX"]));
      const unsafeWorking = assertFailure(await ctx.get("/api/compliance/gstr1-working?range=yearly&format=json&locationId=all", { token: auth.accessToken }), 422);
      assert.equal(unsafeWorking.code, "SELLER_GSTIN_SCOPE_REQUIRED");
      const scopedWorking = assertSuccess(await ctx.get("/api/compliance/gstr1-working?range=yearly&format=json&sellerGstin=29AAPFU0939F1ZR", { token: auth.accessToken }));
      assert.equal(scopedWorking.registrationScope.selectedGstin, "29AAPFU0939F1ZR");
      assert.equal(scopedWorking.registrationScope.filingScopeRequired, false);
      assert.equal(scopedWorking.documentSeries.length, 1);

      const audits = await ctx.db.auditLog.findMany({ where: { shopId: tenant.shop.id, entityId: { in: [branch.id, transfer.id, externalReviewTransfer.id, notRequiredTransfer.id] } } });
      assert.equal(audits.some((row) => row.action === "STORE_LOCATION_CREATED"), true);
      assert.equal(audits.some((row) => row.action === "STORE_LOCATION_UPDATED"), true);
      assert.equal(audits.some((row) => row.action === "STOCK_TRANSFER_COMPLETED"), true);
      assert.equal(audits.filter((row) => row.action === "STOCK_TRANSFER_COMPLIANCE_REVIEWED").length, 2);
    });
    test("enforces the subscribed store limit", async () => {
      const { tenant, auth } = await ownerContext();
      const current = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken }));
      assert.ok(current.usage.maximum >= current.usage.current);
      for (let number = current.usage.current + 1; number <= current.usage.maximum; number += 1) {
        assertSuccess(await ctx.post("/api/stores", { name: `Store ${number}`, code: `S${String(number).padStart(2, "0")}` }, { token: auth.accessToken }), 201);
      }
      const blocked = assertFailure(await ctx.post("/api/stores", { name: "Over Limit Store", code: "OVER" }, { token: auth.accessToken }), 403);
      assert.equal(blocked.code, "STORE_LIMIT_REACHED");
    });

    test("routes public customer orders to one branch with live stock, pricing, and guarded fulfillment", async () => {
      const { tenant, auth } = await ownerContext();
      await ctx.db.shop.update({
        where: { id: tenant.shop.id },
        data: { settingsJson: JSON.stringify({ customerOrdering: { enabled: true } }) },
      });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Online Branch Rice", stockBaseQty: 20, defaultPricePerRateUnit: 50 });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];
      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Online Branch", code: "ONL02", city: "Pune" }, { token: auth.accessToken }), 201);
      assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 4, declaredTaxableValue: 200 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      await ctx.db.pricingRule.create({ data: {
        shopId: tenant.shop.id,
        locationId: branch.id,
        name: "Online branch price",
        ruleType: "PROMOTIONAL_PRICE",
        status: "ACTIVE",
        priority: 7,
        productId: product.id,
        fixedUnitPrice: 45,
      } });

      const catalog = assertSuccess(await ctx.get(`/api/public/shops/${tenant.shop.id}/catalog?locationId=${branch.id}`));
      assert.equal(catalog.location.id, branch.id);
      assert.equal(catalog.products.find((row) => row.id === product.id).price, 45);

      const submitted = assertSuccess(await ctx.post(`/api/public/shops/${tenant.shop.id}/orders`, {
        locationId: branch.id,
        fulfillmentType: "pickup",
        promisedSlot: "Tomorrow morning",
        customerName: "Online Customer",
        customerMobile: "9876543210",
        items: [{ productId: product.id, qty: 2 }],
      }, { headers: { "Idempotency-Key": "branch-order-integration-1" } }), 201);
      assert.equal(submitted.locationId, branch.id);
      assert.equal(submitted.estimatedTotal, 90);

      const branchOrders = assertSuccess(await ctx.get("/api/orders", { token: auth.accessToken, headers: { "x-location-id": branch.id } }));
      const primaryOrders = assertSuccess(await ctx.get("/api/orders", { token: auth.accessToken, headers: { "x-location-id": primary.id } }));
      assert.equal(branchOrders.orders.length, 1);
      assert.equal(primaryOrders.orders.length, 0);
      const accepted = assertSuccess(await ctx.patch(`/api/orders/${submitted.orderId}`, { status: "accepted" }, { token: auth.accessToken, headers: { "x-location-id": branch.id } }));
      assert.equal(accepted.status, "accepted");
      assert.ok(accepted.acceptedAt);
      const ready = assertSuccess(await ctx.patch(`/api/orders/${submitted.orderId}`, { status: "ready" }, { token: auth.accessToken, headers: { "x-location-id": branch.id } }));
      assert.equal(ready.status, "ready");
      const invalid = assertFailure(await ctx.patch(`/api/orders/${submitted.orderId}`, { status: "accepted" }, { token: auth.accessToken, headers: { "x-location-id": branch.id } }), 409);
      assert.equal(invalid.code, "INVALID_ORDER_TRANSITION");
    });

    test("keeps branch billing, purchasing, stock ledger, reports, and closing isolated", async () => {
      const { tenant, auth } = await ownerContext();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Branch-owned Flour", stockBaseQty: 20, defaultPricePerRateUnit: 25 });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];
      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Billing Branch", code: "BILL02" }, { token: auth.accessToken }), 201);
      await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 8, declaredTaxableValue: 200 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin });

      const branchHeaders = { "x-location-id": branch.id };
      const bill = assertSuccess(await ctx.post(
        "/api/bills/confirm",
        billPayload(product, { quantity: 3, ratePerRateUnit: 25 }),
        { token: auth.accessToken, headers: branchHeaders },
      ), 201);
      assert.equal(bill.locationId, branch.id);

      assertSuccess(await ctx.post("/api/inventory/purchase", {
        idempotencyKey: "retail-operations-purchase-1",
        productId: product.id,
        supplierName: "Branch Supplier",
        quantity: 2,
        enteredUnit: "piece",
        billAmount: 20,
        updateCost: false,
      }, { token: auth.accessToken, headers: branchHeaders }), 201);

      const [mainInventory, branchInventory, storedBill, branchLedger] = await Promise.all([
        ctx.get(`/api/stores/${primary.id}/inventory`, { token: auth.accessToken }),
        ctx.get(`/api/stores/${branch.id}/inventory`, { token: auth.accessToken }),
        ctx.db.bill.findUnique({ where: { id: bill.id } }),
        ctx.db.stockLedger.findMany({ where: { shopId: tenant.shop.id, locationId: branch.id } }),
      ]);
      assert.equal(assertSuccess(mainInventory).products.find((row) => row.id === product.id).stockBaseQty, 12);
      assert.equal(assertSuccess(branchInventory).products.find((row) => row.id === product.id).stockBaseQty, 7);
      assert.equal(storedBill.locationId, branch.id);
      assert.equal(branchLedger.some((row) => row.action === "sale"), true);
      assert.equal(branchLedger.some((row) => row.action === "purchase"), true);

      const branchClosing = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", { token: auth.accessToken, headers: branchHeaders }));
      const mainClosing = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", { token: auth.accessToken, headers: { "x-location-id": primary.id } }));
      assert.equal(branchClosing.location.id, branch.id);
      assert.equal(branchClosing.totalBills, 1);
      assert.equal(mainClosing.totalBills, 0);

      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const snapshot = assertSuccess(await ctx.post("/api/reports/daily-closing/snapshot", { date }, { token: auth.accessToken, headers: branchHeaders }), 201);
      assert.equal(snapshot.snapshot.storeId, branch.id);
    });

    test("runs a branch-aware purchase order through partial and complete atomic receiving", async () => {
      const { tenant, auth } = await ownerContext();
      const product = await createProduct(ctx.db, tenant.shop.id, {
        name: "Reorder Oil",
        stockBaseQty: 3,
        lowStockThreshold: 5,
        reorderLevel: 10,
        costPerRateUnit: 20,
        baseUnit: "piece",
        rateUnit: "piece",
      });
      const supplier = await ctx.db.supplier.create({ data: { shopId: tenant.shop.id, name: "Reliable Wholesale" } });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];

      const suggestions = assertSuccess(await ctx.get("/api/purchase-orders/suggestions", { token: auth.accessToken, headers: { "x-location-id": primary.id } }));
      const reorderSuggestion = suggestions.find((row) => row.productId === product.id);
      assert.equal(reorderSuggestion.recommendedOrderBaseQty, 10);
      assert.equal(reorderSuggestion.reasonCode, "manual_reorder_floor");
      assert.equal(reorderSuggestion.forecastConfidence, "no_history");
      assert.equal(reorderSuggestion.calculationVersion, "deterministic_reorder_v1");

      const order = assertSuccess(await ctx.post("/api/purchase-orders", {
        supplierId: supplier.id,
        supplierName: supplier.name,
        expectedOn: "2026-07-20",
        vendorReference: "QUOTE-RW-42",
        paymentTerms: "Net 15 days",
        deliveryAddress: "Primary receiving bay, Pune",
        termsAndConditions: "Quote this PO on the supplier invoice.",
        items: [{ productId: product.id, orderedBaseQty: 10, expectedRate: 18 }],
      }, { token: auth.accessToken, headers: { "x-location-id": primary.id } }), 201);
      assert.equal(order.status, "draft");
      assert.equal(order.reconciliation.status, "not_received");
      assert.equal(order.expectedTotal, 180);
      assert.equal(order.vendorReference, "QUOTE-RW-42");
      assert.equal(order.paymentTerms, "Net 15 days");
      assert.equal(order.deliveryAddress, "Primary receiving bay, Pune");
      assert.equal(order.termsAndConditions, "Quote this PO on the supplier invoice.");

      const coveredSuggestions = assertSuccess(await ctx.get("/api/purchase-orders/suggestions", { token: auth.accessToken, headers: { "x-location-id": primary.id } }));
      assert.equal(coveredSuggestions.some((row) => row.productId === product.id), false, "an open supplier order must suppress duplicate replenishment");

      const tracked = assertSuccess(await ctx.patch(`/api/inventory-lots/products/${product.id}/tracking`, { enabled: true }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(tracked.batchTrackingEnabled, true);

      const sent = assertSuccess(await ctx.post(`/api/purchase-orders/${order.id}/send`, {}, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(sent.status, "sent");
      const orderItemId = sent.items[0].id;

      const firstReceiptPayload = {
        idempotencyKey: `po-receipt-${order.id}-1`,
        supplierInvoiceNumber: "SUP-1001",
        paidAmount: 20,
        paymentMode: "cash",
        updateCost: true,
        // Both lots must be saleable now, with EARLY expiring first — that ordering
        // is what the FEFO allocation assertion below actually proves.
        items: [{ purchaseOrderItemId: orderItemId, quantityBaseQty: 4, actualRate: 17, batchNumber: "OIL-EARLY", manufacturedOn: isoDaysFromNow(-90), expiresOn: isoDaysFromNow(30) }],
      };
      const partial = assertSuccess(await ctx.post(`/api/purchase-orders/${order.id}/receive`, firstReceiptPayload, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(partial.purchaseOrder.status, "partially_received");
      assert.equal(partial.purchaseOrder.items[0].receivedBaseQty, 4);
      assert.equal(partial.receipt.totalAmount, 68);
      assert.equal(partial.receipt.paidAmount, 20);
      assert.equal(partial.receipt.dueAmount, 48);
      assert.equal(partial.receipt.matchStatus, "invoice_pending");
      assert.equal(partial.receipt.expectedGoodsAmount, 72);
      assert.equal(partial.receipt.priceVarianceAmount, -4);
      assert.equal(partial.purchaseOrder.reconciliation.status, "invoice_pending");
      const productAfterPartial = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(productAfterPartial.stockBaseQty, 7);
      assert.equal(productAfterPartial.costPerRateUnit, 18.29, "receipt must apply weighted-average cost when requested");
      const partialHistory = await ctx.db.purchaseHistory.findFirst({ where: { purchaseReceiptId: partial.receipt.id } });
      assert.equal(partialHistory.purchasePaymentStatus, "partial");
      assert.equal(partialHistory.purchasePaidAmount, 20);
      assert.equal(partialHistory.purchaseDueAmount, 48);
      const partialJournal = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, sourceType: "purchase_receipt", sourceId: partial.receipt.id }, orderBy: { entryType: "asc" } });
      assert.deepEqual(partialJournal.map((row) => [row.entryType, row.direction, row.amountPaise]), [
        ["cash_out", "credit", 2000n],
        ["inventory_purchase", "debit", 6800n],
        ["supplier_payable", "credit", 4800n],
      ], "partial receipt must balance inventory against exact paid and due legs");

      const outsider = await ownerContext();
      const crossTenantReconcile = assertFailure(await ctx.post(`/api/purchase-orders/${order.id}/receipts/${partial.receipt.id}/reconcile`, {
        supplierInvoiceNumber: "SUP-1001", supplierInvoiceAmount: 68, varianceReason: "Should never be accepted",
      }, { token: outsider.auth.accessToken, ownerPin: outsider.tenant.ownerPin }), 404);
      assert.equal(crossTenantReconcile.code, "PURCHASE_ORDER_NOT_FOUND");

      const unexplainedFirstVariance = assertFailure(await ctx.post(`/api/purchase-orders/${order.id}/receipts/${partial.receipt.id}/reconcile`, {
        supplierInvoiceNumber: "SUP-1001", supplierInvoiceAmount: 68,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 422);
      assert.equal(unexplainedFirstVariance.code, "PURCHASE_VARIANCE_REASON_REQUIRED");
      assert.deepEqual({
        expectedGoodsAmount: unexplainedFirstVariance.expectedGoodsAmount,
        goodsReceivedAmount: unexplainedFirstVariance.goodsReceivedAmount,
        supplierInvoiceAmount: unexplainedFirstVariance.supplierInvoiceAmount,
        priceVarianceAmount: unexplainedFirstVariance.priceVarianceAmount,
        invoiceVarianceAmount: unexplainedFirstVariance.invoiceVarianceAmount,
      }, {
        expectedGoodsAmount: 72,
        goodsReceivedAmount: 68,
        supplierInvoiceAmount: 68,
        priceVarianceAmount: -4,
        invoiceVarianceAmount: 0,
      });

      const reconciledFirst = assertSuccess(await ctx.post(`/api/purchase-orders/${order.id}/receipts/${partial.receipt.id}/reconcile`, {
        supplierInvoiceNumber: "SUP-1001", supplierInvoiceAmount: 68, varianceReason: "Supplier promotional price approved",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      const reconciledFirstReceipt = reconciledFirst.receipts.find((row) => row.id === partial.receipt.id);
      assert.equal(reconciledFirstReceipt.matchStatus, "approved_variance");
      assert.equal(reconciledFirstReceipt.varianceReason, "Supplier promotional price approved");
      assert.equal(reconciledFirst.reconciliation.status, "partial_delivery");
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "PURCHASE_RECEIPT_RECONCILED", entityId: partial.receipt.id } }), 1);

      const replay = assertSuccess(await ctx.post(`/api/purchase-orders/${order.id}/receive`, firstReceiptPayload, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 200);
      assert.equal(replay.idempotentReplay, true);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 7, "receipt retry must not add stock twice");
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "PURCHASE_ORDER_RECEIVED", entityId: order.id } }), 1, "receipt retry must not duplicate the owner audit event");
      assert.equal(await ctx.db.purchaseHistory.count({ where: { purchaseReceiptId: partial.receipt.id } }), 1, "receipt retry must not duplicate supplier due history");
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, sourceType: "purchase_receipt", sourceId: partial.receipt.id } }), 3, "receipt retry must not duplicate journal legs");
      const changedReplay = assertFailure(await ctx.post(`/api/purchase-orders/${order.id}/receive`, {
        ...firstReceiptPayload,
        paidAmount: 21,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(changedReplay.code, "IDEMPOTENCY_KEY_REUSED");
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 7, "changed replay payload must not mutate stock");

      const otherOrder = assertSuccess(await ctx.post("/api/purchase-orders", {
        supplierId: supplier.id,
        supplierName: supplier.name,
        items: [{ productId: product.id, orderedBaseQty: 1, expectedRate: 17 }],
      }, { token: auth.accessToken, headers: { "x-location-id": primary.id } }), 201);
      await ctx.post(`/api/purchase-orders/${otherOrder.id}/send`, {}, { token: auth.accessToken, ownerPin: tenant.ownerPin });
      const crossOrderReplay = assertFailure(await ctx.post(`/api/purchase-orders/${otherOrder.id}/receive`, firstReceiptPayload, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(crossOrderReplay.code, "IDEMPOTENCY_KEY_REUSED", "one receipt key cannot alias another purchase order");

      const overReceipt = assertFailure(await ctx.post(`/api/purchase-orders/${order.id}/receive`, {
        idempotencyKey: `po-receipt-${order.id}-over`, paidAmount: 133, paymentMode: "cash",
        items: [{ purchaseOrderItemId: orderItemId, quantityBaseQty: 7, actualRate: 19 }],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(overReceipt.code, "PURCHASE_ORDER_OVER_RECEIPT");

      const completed = assertSuccess(await ctx.post(`/api/purchase-orders/${order.id}/receive`, {
        idempotencyKey: `po-receipt-${order.id}-2`, supplierInvoiceNumber: "SUP-1001", paidAmount: 114, paymentMode: "bank",
        items: [{ purchaseOrderItemId: orderItemId, quantityBaseQty: 6, actualRate: 19, batchNumber: "OIL-LATE", manufacturedOn: isoDaysFromNow(-60), expiresOn: isoDaysFromNow(150) }],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(completed.purchaseOrder.status, "received");
      assert.equal(completed.purchaseOrder.items[0].receivedBaseQty, 10);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 13);
      assert.equal(await ctx.db.purchaseReceipt.count({ where: { purchaseOrderId: order.id } }), 2);
      assert.equal(await ctx.db.purchaseHistory.count({ where: { purchaseOrderId: order.id } }), 2);
      assert.equal(completed.receipt.matchStatus, "invoice_pending");
      assert.equal(completed.receipt.expectedGoodsAmount, 108);
      assert.equal(completed.receipt.priceVarianceAmount, 6);
      assert.equal(completed.purchaseOrder.reconciliation.invoicePendingCount, 1);
      const completedJournal = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, sourceType: "purchase_receipt", sourceId: completed.receipt.id }, orderBy: { entryType: "asc" } });
      assert.deepEqual(completedJournal.map((row) => [row.entryType, row.direction, row.amountPaise]), [
        ["bank_out", "credit", 11400n],
        ["inventory_purchase", "debit", 11400n],
      ], "fully paid receipt must balance inventory against the selected bank tender");

      const unexplainedSecondVariance = assertFailure(await ctx.post(`/api/purchase-orders/${order.id}/receipts/${completed.receipt.id}/reconcile`, {
        supplierInvoiceNumber: "SUP-1001-B", supplierInvoiceAmount: 114,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 422);
      assert.equal(unexplainedSecondVariance.code, "PURCHASE_VARIANCE_REASON_REQUIRED");
      const fullyReconciled = assertSuccess(await ctx.post(`/api/purchase-orders/${order.id}/receipts/${completed.receipt.id}/reconcile`, {
        supplierInvoiceNumber: "SUP-1001-B", supplierInvoiceAmount: 114, varianceReason: "Supplier list-price increase approved",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(fullyReconciled.reconciliation.status, "approved_variance");
      assert.equal(fullyReconciled.reconciliation.invoicePendingCount, 0);
      assert.equal(fullyReconciled.reconciliation.approvedVarianceCount, 2);
      assert.equal(fullyReconciled.reconciliation.expectedGoodsAmount, 180);
      assert.equal(fullyReconciled.reconciliation.goodsReceivedAmount, 182);
      assert.equal(fullyReconciled.reconciliation.supplierInvoiceAmount, 182);
      assert.equal(fullyReconciled.reconciliation.priceVarianceAmount, 2);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "PURCHASE_RECEIPT_RECONCILED" } }), 2);

      const lots = assertSuccess(await ctx.get("/api/inventory-lots?status=all", { token: auth.accessToken, headers: { "x-location-id": primary.id } }));
      assert.deepEqual(lots.map((lot) => lot.batchNumber), ["OIL-EARLY", "OIL-LATE"]);
      const lotSale = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 5, ratePerRateUnit: 30, payments: [{ mode: "cash", amount: 150 }], actualAmount: 150, buyerPaidAmount: 150,
      }), { token: auth.accessToken, headers: { "x-location-id": primary.id } }), 201);
      const allocations = await ctx.db.billItemLotAllocation.findMany({ where: { billItem: { billId: lotSale.id } }, include: { inventoryLot: true }, orderBy: { inventoryLot: { expiresOn: "asc" } } });
      assert.deepEqual(allocations.map((row) => [row.inventoryLot.batchNumber, row.quantityBaseQty]), [["OIL-EARLY", 4], ["OIL-LATE", 1]], "checkout must consume the earliest-expiring saleable lot first");
      assertSuccess(await ctx.post(`/api/bills/${lotSale.id}/cancel`, { reason: "Batch sale cancelled" }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      const restoredLots = await ctx.db.inventoryLot.findMany({ where: { productId: product.id }, orderBy: { expiresOn: "asc" } });
      assert.deepEqual(restoredLots.map((lot) => lot.availableBaseQty), [4, 6], "bill cancellation must restore exact lot balances");

      const returnedLotSale = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 2, ratePerRateUnit: 30, payments: [{ mode: "cash", amount: 60 }], actualAmount: 60, buyerPaidAmount: 60,
      }), { token: auth.accessToken, headers: { "x-location-id": primary.id } }), 201);
      assertSuccess(await ctx.post("/api/bills/returns", {
        refundMode: "cash", returnOfBillId: returnedLotSale.id, reason: "One unit returned",
        items: [{ productId: product.id, name: product.name, quantity: 1, enteredUnit: "piece", ratePerRateUnit: 30, gstRate: 0, damaged: false }],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin, headers: { "x-location-id": primary.id } }), 201);
      const afterLotReturn = await ctx.db.inventoryLot.findMany({ where: { productId: product.id }, orderBy: { expiresOn: "asc" } });
      assert.deepEqual(afterLotReturn.map((lot) => lot.availableBaseQty), [3, 6], "a partial return must restore the exact FEFO lot used by its original sale");

      const supplierReturnPayload = {
        purchaseReceiptId: completed.receipt.id,
        refundMode: "bank",
        reason: "Supplier shipment damaged in transit",
        supplierReference: "CN-RW-1001",
        idempotencyKey: "supplier-return-retry-001",
        items: [{ purchaseReceiptItemId: completed.receipt.items[0].id, quantityBaseQty: 2 }],
      };
      const supplierReturn = assertSuccess(await ctx.post("/api/purchase-returns", supplierReturnPayload, { token: auth.accessToken, ownerPin: tenant.ownerPin, headers: { "x-location-id": primary.id } }), 201);
      assert.equal(supplierReturn.totalAmount, 38);
      assert.equal(supplierReturn.refundAmount, 38);
      assert.equal(supplierReturn.supplierCreditAmount, 0);
      assert.equal(supplierReturn.items[0].quantityBaseQty, 2);
      const purchaseReturnJournal = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, sourceType: "purchase_return", sourceId: supplierReturn.id }, orderBy: { entryType: "asc" } });
      assert.deepEqual(purchaseReturnJournal.map((row) => [row.entryType, row.direction, row.amountPaise]), [
        ["bank_refund_in", "debit", 3800n],
        ["inventory_purchase_return", "credit", 3800n],
      ], "supplier refund must balance the inventory reduction against bank value received");
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 10);
      const afterSupplierReturnLots = await ctx.db.inventoryLot.findMany({ where: { productId: product.id }, orderBy: { expiresOn: "asc" } });
      assert.deepEqual(afterSupplierReturnLots.map((lot) => lot.availableBaseQty), [3, 4], "supplier return must remove stock from its received batch first");
      const replayedSupplierReturn = assertSuccess(await ctx.post("/api/purchase-returns", supplierReturnPayload, { token: auth.accessToken, ownerPin: tenant.ownerPin, headers: { "x-location-id": primary.id } }), 200);
      assert.equal(replayedSupplierReturn.id, supplierReturn.id);
      assert.equal(replayedSupplierReturn.idempotentReplay, true);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 10, "retry must not remove stock twice");
      const duplicateSupplierReturn = assertFailure(await ctx.post("/api/purchase-returns", {
        purchaseReceiptId: completed.receipt.id, refundMode: "supplier_credit", reason: "Over-return attempt",
        items: [{ purchaseReceiptItemId: completed.receipt.items[0].id, quantityBaseQty: 5 }],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin, headers: { "x-location-id": primary.id } }), 409);
      assert.equal(duplicateSupplierReturn.code, "PURCHASE_RETURN_EXCEEDS_RECEIPT");
      const cancelledSupplierReturn = assertSuccess(await ctx.post(`/api/purchase-returns/${supplierReturn.id}/cancel`, {
        reason: "Wrong supplier shipment selected",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin, headers: { "x-location-id": primary.id } }));
      assert.equal(cancelledSupplierReturn.status, "cancelled");
      const cancelledReturnJournal = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, sourceType: "purchase_return_cancel", sourceId: supplierReturn.id }, orderBy: { entryType: "asc" } });
      assert.deepEqual(cancelledReturnJournal.map((row) => [row.entryType, row.amountPaise]), [
        ["bank_refund_in", -3800n],
        ["inventory_purchase_return", -3800n],
      ], "purchase-return cancellation must append exact negated legs");
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 12, "void must restore branch and global stock");
      const afterSupplierReturnVoidLots = await ctx.db.inventoryLot.findMany({ where: { productId: product.id }, orderBy: { expiresOn: "asc" } });
      assert.deepEqual(afterSupplierReturnVoidLots.map((lot) => lot.availableBaseQty), [3, 6], "void must restore the exact supplier-return batch allocation");
      const replayedVoid = assertSuccess(await ctx.post(`/api/purchase-returns/${supplierReturn.id}/cancel`, {
        reason: "Wrong supplier shipment selected",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin, headers: { "x-location-id": primary.id } }));
      assert.equal(replayedVoid.idempotentReplay, true);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 12, "void retry must not restore stock twice");

      const purchaseControl = assertSuccess(await ctx.get("/api/accounting/control?from=2020-01-01T00%3A00%3A00.000Z&to=2030-01-01T00%3A00%3A00.000Z", { token: auth.accessToken }));
      assert.equal(purchaseControl.status, "balanced");
      assert.equal(purchaseControl.coverage.unmappedRows, 0);
      assert.equal(purchaseControl.trialBalance.difference.paise, 0);

      const cannotCancel = assertFailure(await ctx.post(`/api/purchase-orders/${order.id}/cancel`, { reason: "Too late" }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(cannotCancel.code, "PURCHASE_ORDER_NOT_CANCELLABLE");
    });

    test("keeps paid and pending expense lifecycle postings balanced without hiding reversals", async () => {
      const { tenant, auth } = await ownerContext();
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];
      const headers = { "x-location-id": primary.id };

      const paid = assertSuccess(await ctx.post("/api/expenses", {
        idempotencyKey: "retail-expense-electricity-001",
        title: "Store electricity",
        amount: 100,
        category: "utilities",
        paymentMode: "cash",
        status: "paid",
      }, { token: auth.accessToken, headers }), 201);
      const pending = assertSuccess(await ctx.post("/api/expenses", {
        idempotencyKey: "retail-expense-maintenance-001",
        title: "Monthly maintenance",
        amount: 50,
        category: "maintenance",
        paymentMode: "bank",
        status: "pending",
      }, { token: auth.accessToken, headers }), 201);

      const updated = assertSuccess(await ctx.patch(`/api/expenses/${paid.id}`, {
        amount: 120,
        paymentMode: "bank",
      }, { token: auth.accessToken, headers }));
      assert.equal(updated.amount, 120);
      assert.equal(updated.paymentMode, "bank");
      assertSuccess(await ctx.delete(`/api/expenses/${pending.id}`, { token: auth.accessToken, headers }));
      assertSuccess(await ctx.post(`/api/expenses/${pending.id}/restore`, {}, { token: auth.accessToken, headers }));

      const rows = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, sourceType: { in: ["expense", "expense_update", "expense_delete", "expense_restore"] } } });
      assert.equal(rows.length, 12, "two creates, one four-leg replacement, one delete reversal and one restore must all remain append-only");
      assert.equal(rows.filter((row) => row.sourceType === "expense_update").length, 4);
      assert.equal(rows.filter((row) => row.sourceType === "expense_delete").every((row) => row.amountPaise < 0n), true);
      assert.equal(rows.filter((row) => row.sourceType === "expense_restore").every((row) => row.amountPaise > 0n), true);
      const expenseAudits = await ctx.db.auditLog.findMany({
        where: { shopId: tenant.shop.id, entityType: "Expense", entityId: { in: [paid.id, pending.id] } },
      });
      assert.equal(expenseAudits.filter((audit) => audit.action === "EXPENSE_CREATED").length, 2);
      assert.equal(expenseAudits.filter((audit) => audit.action === "EXPENSE_UPDATED").length, 1);
      assert.equal(expenseAudits.filter((audit) => audit.action === "EXPENSE_DELETED").length, 1);
      assert.equal(expenseAudits.filter((audit) => audit.action === "EXPENSE_RESTORED").length, 1);
      assert.equal(expenseAudits.every((audit) => audit.userId === tenant.owner.id), true);

      const expenseControl = assertSuccess(await ctx.get("/api/accounting/control?from=2020-01-01T00%3A00%3A00.000Z&to=2030-01-01T00%3A00%3A00.000Z", { token: auth.accessToken }));
      assert.equal(expenseControl.status, "balanced");
      assert.equal(expenseControl.coverage.sourceGroups, 5);
      assert.equal(expenseControl.coverage.balancedGroups, 5);
      assert.equal(expenseControl.trialBalance.difference.paise, 0);
      assert.equal(expenseControl.trialBalance.accounts.find((account) => account.code === "6000").debitBalance.paise, 17000);
      assert.equal(expenseControl.trialBalance.accounts.find((account) => account.code === "2300").creditBalance.paise, 5000);
      assert.equal(expenseControl.trialBalance.accounts.find((account) => account.code === "1020").creditBalance.paise, 12000);
    });

    test("keeps a deleted expense and its ledger reversed when the required restore audit cannot be stored", async () => {
      const { tenant, auth } = await ownerContext();
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];
      const headers = { "x-location-id": primary.id };
      const expense = assertSuccess(await ctx.post("/api/expenses", {
        idempotencyKey: "retail-expense-restore-audit-rollback",
        title: "Audit rollback expense",
        amount: 75,
        category: "maintenance",
        paymentMode: "cash",
        status: "paid",
      }, { token: auth.accessToken, headers }), 201);
      assertSuccess(await ctx.delete(`/api/expenses/${expense.id}`, { token: auth.accessToken, headers }));

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_expense_restore_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'EXPENSE_RESTORED'
        BEGIN
          SELECT RAISE(ABORT, 'forced expense restore audit failure');
        END
      `);
      let failedRestore;
      try {
        failedRestore = await ctx.post(`/api/expenses/${expense.id}/restore`, {}, { token: auth.accessToken, headers });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_expense_restore_audit_failure");
      }
      assertFailure(failedRestore, 503);
      assert.ok((await ctx.db.expense.findUniqueOrThrow({ where: { id: expense.id } })).deletedAt);
      assert.equal(await ctx.db.financialLedger.count({
        where: { shopId: tenant.shop.id, sourceType: "expense_restore" },
      }), 0);
      assert.equal(await ctx.db.auditLog.count({
        where: { shopId: tenant.shop.id, action: "EXPENSE_RESTORED", entityId: expense.id },
      }), 0);
    });

    test("product permanent delete and recycle-bin empty roll back when their required audits cannot be stored", async () => {
      const { tenant, auth } = await ownerContext();
      const permanent = await createProduct(ctx.db, tenant.shop.id, { name: "Permanent audit product" });
      assertSuccess(await ctx.delete(
        `/api/products/${permanent.id}`,
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ));

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_product_permanent_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'PRODUCT_PERMANENTLY_DELETED'
        BEGIN
          SELECT RAISE(ABORT, 'forced permanent product audit failure');
        END
      `);
      let failedPermanent;
      try {
        failedPermanent = await ctx.delete(
          `/api/products/${permanent.id}/permanent`,
          { token: auth.accessToken, ownerPin: tenant.ownerPin },
        );
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_product_permanent_audit_failure");
      }
      assertFailure(failedPermanent, 503);
      assert.ok(await ctx.db.product.findUnique({ where: { id: permanent.id } }), "failed audit must preserve the product");

      assertSuccess(await ctx.delete(
        `/api/products/${permanent.id}/permanent`,
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ));
      assert.equal(await ctx.db.product.findUnique({ where: { id: permanent.id } }), null);
      assert.equal(await ctx.db.auditLog.count({
        where: { shopId: tenant.shop.id, action: "PRODUCT_PERMANENTLY_DELETED", entityId: permanent.id },
      }), 1);

      const first = await createProduct(ctx.db, tenant.shop.id, { name: "Recycle audit product A" });
      const second = await createProduct(ctx.db, tenant.shop.id, { name: "Recycle audit product B" });
      assertSuccess(await ctx.delete(`/api/products/${first.id}`, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assertSuccess(await ctx.delete(`/api/products/${second.id}`, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_product_empty_recycle_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'PRODUCT_RECYCLE_BIN_EMPTIED'
        BEGIN
          SELECT RAISE(ABORT, 'forced empty product recycle audit failure');
        END
      `);
      let failedEmpty;
      try {
        failedEmpty = await ctx.delete(
          "/api/products/recycle-bin/empty",
          { token: auth.accessToken, ownerPin: tenant.ownerPin },
        );
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_product_empty_recycle_audit_failure");
      }
      assertFailure(failedEmpty, 503);
      assert.ok(await ctx.db.product.findUnique({ where: { id: first.id } }));
      assert.ok(await ctx.db.product.findUnique({ where: { id: second.id } }));
      assert.equal(await ctx.db.auditLog.count({
        where: { shopId: tenant.shop.id, action: "PRODUCT_RECYCLE_BIN_EMPTIED" },
      }), 0);
    });

    test("runs a blind stock count through review and guarded variance posting", async () => {
      const { tenant, auth } = await ownerContext();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Counted Rice", stockBaseQty: 10, baseUnit: "kg", rateUnit: "kg" });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];
      const headers = { "x-location-id": primary.id };

      const count = assertSuccess(await ctx.post("/api/inventory/counts", { name: "Month-end count", blindCount: true, productIds: [product.id] }, { token: auth.accessToken, headers }), 201);
      assert.equal(count.status, "counting");
      assert.equal(count.lines[0].expectedBaseQty, null);
      assert.equal(count.summary.remainingLines, 1);

      const counted = assertSuccess(await ctx.request("PATCH", `/api/inventory/counts/${count.id}/lines`, { token: auth.accessToken, headers, body: { lines: [{ productId: product.id, countedBaseQty: 8, reason: "Two kilograms damaged" }] } }));
      assert.equal(counted.summary.remainingLines, 0);
      assert.equal(counted.lines[0].varianceBaseQty, null);

      const review = assertSuccess(await ctx.post(`/api/inventory/counts/${count.id}/submit`, {}, { token: auth.accessToken, headers }));
      assert.equal(review.status, "review");
      assert.equal(review.lines[0].expectedBaseQty, 10);
      assert.equal(review.lines[0].varianceBaseQty, -2);

      const applied = assertSuccess(await ctx.post(`/api/inventory/counts/${count.id}/apply`, { note: "Approved physical count" }, { token: auth.accessToken, headers, ownerPin: tenant.ownerPin }));
      assert.equal(applied.status, "applied");
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 8);
      const varianceLedger = await ctx.db.stockLedger.findFirst({ where: { sourceType: "stock_count", sourceId: count.id, productId: product.id } });
      assert.equal(varianceLedger.changeBaseQty, -2);

      const stale = assertSuccess(await ctx.post("/api/inventory/counts", { name: "Stale count proof", blindCount: false, productIds: [product.id] }, { token: auth.accessToken, headers }), 201);
      assertSuccess(await ctx.request("PATCH", `/api/inventory/counts/${stale.id}/lines`, { token: auth.accessToken, headers, body: { lines: [{ productId: product.id, countedBaseQty: 8 }] } }));
      assertSuccess(await ctx.post(`/api/inventory/counts/${stale.id}/submit`, {}, { token: auth.accessToken, headers }));
      await ctx.db.stockLedger.create({ data: { shopId: tenant.shop.id, locationId: primary.id, productId: product.id, productName: product.name, action: "sale", changeBaseQty: -1, oldStockBaseQty: 8, newStockBaseQty: 7 } });
      const blocked = assertFailure(await ctx.post(`/api/inventory/counts/${stale.id}/apply`, { note: "Should be rejected" }, { token: auth.accessToken, headers, ownerPin: tenant.ownerPin }), 409);
      assert.equal(blocked.code, "STOCK_COUNT_STALE");
    });

    test("earns loyalty points once and exactly reverses bill points on cancellation", async () => {
      const { tenant, auth } = await ownerContext();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Loyal Buyer" });
      const product = await createProduct(ctx.db, tenant.shop.id, { defaultPricePerRateUnit: 20, stockBaseQty: 20 });
      assertSuccess(await ctx.request("PUT", "/api/loyalty/program", { token: auth.accessToken, ownerPin: tenant.ownerPin, body: { active: true, pointsPerRupee: 2, redemptionPaisePerPoint: 25, minimumRedeemPoints: 10, ownerPin: tenant.ownerPin } }));

      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, { customerId: customer.id, customerName: customer.name, quantity: 2 }), { token: auth.accessToken }), 201);
      const account = assertSuccess(await ctx.get(`/api/loyalty/accounts/${customer.id}`, { token: auth.accessToken }));
      assert.equal(account.account.pointsBalance, 80);
      assert.equal(account.account.transactions.filter((row) => row.type === "earn").length, 1);

      const redemptionPayload = {
        ...billPayload(product, {
          quantity: 1,
          ratePerRateUnit: 20,
          customerId: customer.id,
          customerName: customer.name,
          actualAmount: 10,
          buyerPaidAmount: 10,
          payments: [{ mode: "cash", amount: 10 }],
        }),
        loyaltyPointsToRedeem: 40,
        sensitiveActions: ["loyalty_redemption"],
        reason: "Customer requested loyalty redemption",
        ownerPin: tenant.ownerPin,
      };
      const redemptionBill = assertSuccess(await ctx.post("/api/bills/confirm", redemptionPayload, { token: auth.accessToken }), 201);
      assert.equal(redemptionBill.loyaltyPointsRedeemed, 40);
      assert.equal(redemptionBill.loyaltyDiscount, 10);
      assert.equal(redemptionBill.discount, 10);
      assert.equal(redemptionBill.grandTotal, 10);
      const afterRedemption = assertSuccess(await ctx.get(`/api/loyalty/accounts/${customer.id}`, { token: auth.accessToken }));
      assert.equal(afterRedemption.account.pointsBalance, 60);
      assert.equal(afterRedemption.account.transactions.some((row) => row.type === "redeem" && row.billId === redemptionBill.id), true);

      assertSuccess(await ctx.post(`/api/bills/${redemptionBill.id}/cancel`, { reason: "Redemption bill cancelled" }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      const redemptionRestored = assertSuccess(await ctx.get(`/api/loyalty/accounts/${customer.id}`, { token: auth.accessToken }));
      assert.equal(redemptionRestored.account.pointsBalance, 80);
      assert.equal(redemptionRestored.account.transactions.some((row) => row.type === "redeem_reversal" && row.billId === redemptionBill.id), true);

      assertSuccess(await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Customer changed mind" }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      const reversed = assertSuccess(await ctx.get(`/api/loyalty/accounts/${customer.id}`, { token: auth.accessToken }));
      assert.equal(reversed.account.pointsBalance, 0);
      assert.equal(reversed.account.transactions.some((row) => row.type === "earn_reversal" && row.points === -80), true);
      assert.equal(reversed.account.lifetimeEarned, 0, "cancelled bills must no longer count toward loyalty tier lifetime");
    });

    test("reconciles signed reminder receipts in timestamp order without status regression", async () => {
      const { env } = await import("../../src/config/env.js");
      const { reconcileReminderDeliveryEvents } = await import("../../src/modules/reminders/whatsapp.webhook.js");
      const { tenant } = await ownerContext();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Receipt Customer" });
      const providerMessageId = "wamid-receipt-integration-proof";
      const reminder = await ctx.db.reminderLog.create({
        data: {
          shopId: tenant.shop.id,
          customerId: customer.id,
          message: "Private reminder body",
          status: "accepted",
          provider: "meta",
          providerMessageId,
          acceptedAt: new Date("2026-01-01T09:59:00.000Z"),
          lastStatusAt: new Date("2026-01-01T09:59:00.000Z"),
        },
      });

      const callbackPayload = { entry: [{ changes: [{ value: { statuses: [{ id: providerMessageId, status: "sent", timestamp: "1767261600" }] } }] }] };
      const callbackBytes = Buffer.from(JSON.stringify(callbackPayload));
      const secret = "integration-meta-webhook-secret-at-least-32-characters";
      const signature = `sha256=${crypto.createHmac("sha256", secret).update(callbackBytes).digest("hex")}`;
      const originalWebhookEnv = {
        WHATSAPP_PROVIDER: env.WHATSAPP_PROVIDER,
        WHATSAPP_WEBHOOK_PUBLIC_URL: env.WHATSAPP_WEBHOOK_PUBLIC_URL,
        WHATSAPP_WEBHOOK_SECRET: env.WHATSAPP_WEBHOOK_SECRET,
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      };
      try {
        Object.assign(env, {
          WHATSAPP_PROVIDER: "meta",
          WHATSAPP_WEBHOOK_PUBLIC_URL: "https://pos.example/api/reminders/webhooks",
          WHATSAPP_WEBHOOK_SECRET: secret,
          WHATSAPP_WEBHOOK_VERIFY_TOKEN: "integration-verify-token",
        });
        const rejected = await ctx.request("POST", "/api/reminders/webhooks/meta", { body: callbackPayload, headers: { "x-hub-signature-256": `${signature}tampered` }, autoDevice: false });
        assertFailure(rejected, 401);
        const accepted = assertSuccess(await ctx.request("POST", "/api/reminders/webhooks/meta", { body: callbackPayload, headers: { "x-hub-signature-256": signature }, autoDevice: false }));
        assert.deepEqual({ events: accepted.events, matched: accepted.matched, advanced: accepted.advanced }, { events: 1, matched: 1, advanced: 1 });
      } finally {
        Object.assign(env, originalWebhookEnv);
      }

      await ctx.db.reminderDeliveryEvent.createMany({
        data: [
          { provider: "meta", providerMessageId, status: "read", eventAt: new Date("2026-01-01T10:02:00.000Z") },
          { provider: "meta", providerMessageId, status: "delivered", eventAt: new Date("2026-01-01T10:01:00.000Z") },
        ],
      });

      const first = await reconcileReminderDeliveryEvents("meta", providerMessageId, reminder.id);
      assert.deepEqual(first, { matched: 2, advanced: 2 });
      const updated = await ctx.db.reminderLog.findUnique({ where: { id: reminder.id } });
      assert.equal(updated.status, "read");
      assert.equal(updated.sentAt.toISOString(), "2026-01-01T10:00:00.000Z");
      assert.equal(updated.deliveredAt.toISOString(), "2026-01-01T10:01:00.000Z");
      assert.equal(updated.readAt.toISOString(), "2026-01-01T10:02:00.000Z");

      const duplicate = await reconcileReminderDeliveryEvents("meta", providerMessageId, reminder.id);
      assert.deepEqual(duplicate, { matched: 0, advanced: 0 });
      assert.equal(await ctx.db.auditLog.count({ where: { entityId: reminder.id, action: { in: ["REMINDER_SENT", "REMINDER_DELIVERED", "REMINDER_READ"] } } }), 3);
      assert.equal(await ctx.db.reminderDeliveryEvent.count({ where: { providerMessageId, processedAt: null } }), 0);
    });

    test("reports GST readiness, exports an HSN invoice register, and blocks fake legal submission", async () => {
      const { tenant, auth } = await ownerContext();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "GST Buyer" });
      await ctx.db.customer.update({ where: { id: customer.id }, data: { stateCode: "29", gstNumber: "29ABCDE1234F1Z5" } });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Taxed Goods", hsn: "1905", gstRate: 5, defaultPricePerRateUnit: 105 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, { billType: "gst_invoice", customerId: customer.id, customerName: customer.name, quantity: 1, ratePerRateUnit: 105, gstRate: 5 }), { token: auth.accessToken }), 201);

      const readiness = assertSuccess(await ctx.get("/api/compliance/readiness", { token: auth.accessToken }));
      assert.equal(readiness.checks.find((row) => row.key === "gstin").ready, true);
      assert.equal(readiness.checks.find((row) => row.key === "hsn").ready, true);
      assert.equal(readiness.checks.find((row) => row.key === "eway").ready, true);
      assert.equal(readiness.provider.legalSubmission, false);

      const retailPayment = assertSuccess(await ctx.get("/api/payment-provider/retail/readiness", { token: auth.accessToken }));
      assert.equal(retailPayment.configured, false);
      assert.equal(retailPayment.confirmationRequired, false);
      const unconfiguredPayment = assertFailure(await ctx.post("/api/payment-provider/retail/intents", { amountPaise: 10500 }, { token: auth.accessToken }), 503);
      assert.equal(unconfiguredPayment.code, "RETAIL_PAYMENT_PROVIDER_NOT_CONFIGURED");

      const csv = await ctx.get("/api/compliance/gst-register?range=yearly&format=csv", { token: auth.accessToken });
      assert.equal(csv.status, 200);
      assert.match(csv.text, /Invoice Number/);
      assert.match(csv.text, /1905/);
      assert.match(csv.text, new RegExp(bill.billNo));

      const register = assertSuccess(await ctx.get("/api/compliance/gst-register?range=yearly&format=json", { token: auth.accessToken }));
      const invoiceLine = register.rows.find((row) => row.invoiceNumber === bill.billNo);
      assert.equal(invoiceLine.supplyType, "interstate");
      assert.equal(invoiceLine.placeOfSupply, "29");
      assert.equal(invoiceLine.igst, 5);
      assert.equal(invoiceLine.cgst, 0);
      assert.equal(invoiceLine.sgst, 0);

      const missingHsnProduct = await createProduct(ctx.db, tenant.shop.id, { name: "Unclassified Snack", category: "snacks", hsn: null, gstRate: 0 });
      const hsnBefore = assertSuccess(await ctx.get("/api/compliance/hsn-summary", { token: auth.accessToken }));
      assert.equal(hsnBefore.categories.find((row) => row.category === "snacks").missingHsn, 1);
      const assigned = assertSuccess(await ctx.request("PUT", "/api/compliance/hsn-category", {
        token: auth.accessToken,
        ownerPin: tenant.ownerPin,
        body: { category: "snacks", hsn: "2106", gstRate: 12 },
      }));
      assert.equal(assigned.updatedProducts, 1);
      const classified = await ctx.db.product.findUnique({ where: { id: missingHsnProduct.id } });
      assert.equal(classified.hsn, "2106");
      assert.equal(classified.gstRate, 12);

      const gstr1 = await ctx.get("/api/compliance/gstr1-working?range=yearly&format=csv", { token: auth.accessToken });
      assert.equal(gstr1.status, 200);
      assert.match(gstr1.text, /B2B/);
      assert.match(gstr1.text, /HSN/);

      const ewayDraft = assertSuccess(await ctx.post(`/api/compliance/e-way-bills/${bill.id}/draft`, {
        transportMode: "road",
        transporterName: "Reliable Roadways",
        vehicleNumber: "MH12AB1234",
        vehicleType: "regular",
        distanceKm: 85,
        transportDocumentNumber: "LR-1001",
        transportDocumentDate: "2026-07-13",
        deliveryAddress: "12 Market Road, Pune, Maharashtra",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(ewayDraft.documentType, "e_way_bill");
      assert.equal(ewayDraft.status, "sandbox_only");
      assert.match(ewayDraft.externalReference, /^DRAFT-/);
      const storedTransport = JSON.parse(ewayDraft.payloadJson).transport;
      assert.equal(storedTransport.vehicleNumber, "MH12AB1234");
      assert.equal(storedTransport.distanceKm, 85);

      const disabledEway = assertFailure(await ctx.post(`/api/compliance/e-way-bills/${bill.id}/submit`, {
        transportMode: "road", transporterName: "Reliable Roadways", vehicleNumber: "MH12AB1234", distanceKm: 85, deliveryAddress: "12 Market Road, Pune, Maharashtra",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 503);
      assert.equal(disabledEway.code, "GST_LEGAL_PROVIDER_NOT_READY");

      const disabled = assertFailure(await ctx.post(`/api/compliance/e-invoices/${bill.id}/sandbox`, {}, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 503);
      assert.equal(disabled.code, "GST_PROVIDER_NOT_CONFIGURED");
    });

    test("creates authoritative GST credit notes from immutable original sale lines", async () => {
      const { tenant, auth } = await ownerContext();
      const customer = await createCustomer(ctx.db, tenant.shop.id, {
        name: "Registered Buyer",
        gstNumber: "29AAPFU0939F1ZR",
        stateCode: "29",
        address: "Bengaluru, Karnataka",
      });
      const product = await createProduct(ctx.db, tenant.shop.id, {
        name: "Taxed Biscuits",
        stockBaseQty: 20,
        defaultPricePerRateUnit: 118,
        costPerRateUnit: 60,
        gstRate: 18,
        hsn: "1905",
      });
      const sale = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        billType: "gst_invoice",
        gstMode: "inclusive",
        customerId: customer.id,
        customerName: customer.name,
        quantity: 2,
        ratePerRateUnit: 118,
        gstRate: 18,
        hsn: "1905",
        lineDiscount: 36,
      }), { token: auth.accessToken }), 201);
      assert.equal(sale.grandTotal, 200);
      assert.equal(sale.items[0].lineDiscount, 36);
      assert.equal(sale.items[0].hsn, "1905");

      await ctx.db.product.update({ where: { id: product.id }, data: { hsn: "9999", gstRate: 5, defaultPricePerRateUnit: 999 } });
      const creditNote = assertSuccess(await ctx.post("/api/bills/returns", {
        refundMode: "cash",
        returnOfBillId: sale.id,
        reason: "One pack returned",
        gstMode: "none",
        items: [{
          originalBillItemId: sale.items[0].id,
          productId: product.id,
          name: "Manipulated client label",
          quantity: 1,
          enteredUnit: "piece",
          ratePerRateUnit: 999,
          lineDiscount: 0,
          gstRate: 0,
          hsn: "9999",
          damaged: false,
        }],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);

      assert.match(creditNote.billNo, /^RET-\d{4}-000001$/);
      assert.equal(creditNote.grandTotal, -100, "refund must use the original line's net value");
      assert.equal(creditNote.gst, -15.25, "return must reverse the original inclusive GST mode and rate");
      assert.equal(creditNote.buyerGstin, "29AAPFU0939F1ZR");
      assert.equal(creditNote.items[0].originalBillItemId, sale.items[0].id);
      assert.equal(creditNote.items[0].ratePerRateUnit, 118);
      assert.equal(creditNote.items[0].lineDiscount, -18);
      assert.equal(creditNote.items[0].gstRate, 18);
      assert.equal(creditNote.items[0].hsn, "1905", "later product edits must not rewrite a credit note's HSN");

      const returnLedger = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, billId: creditNote.id }, orderBy: { entryType: "asc" } });
      assert.deepEqual(returnLedger.map((row) => [row.entryType, row.amountPaise]), [["cash_in", -10000n], ["gst_output", -1525n], ["gst_sales_reclassification", -1525n], ["sale", -10000n]], "the append-only financial ledger must reverse tender, net revenue and aggregate output GST without rewriting the original sale");

      const working = assertSuccess(await ctx.get("/api/compliance/gstr1-working?range=monthly", { token: auth.accessToken }));
      assert.equal(working.cdnr.length, 1);
      assert.equal(working.cdnr[0].noteNumber, creditNote.billNo);
      assert.equal(working.cdnr[0].noteValue, 100);
      assert.equal(working.cdnr[0].buyerGstin, "29AAPFU0939F1ZR");
      assert.equal(working.b2b.length, 1, "the credit note must not be double-counted as a B2B invoice");
      const gstReport = assertSuccess(await ctx.get("/api/reports/gst?range=monthly", { token: auth.accessToken }));
      assert.equal(gstReport.cgst, 0);
      assert.equal(gstReport.sgst, 0);
      assert.equal(gstReport.igst, gstReport.gstCollected, "interstate invoice and return tax must remain IGST after netting");
    });

    test("issues and atomically redeems gift value across branches with cancellation recovery", async () => {
      const { tenant, auth } = await ownerContext();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Gift Customer" });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Gift Purchase", stockBaseQty: 10, defaultPricePerRateUnit: 100 });

      const issued = assertSuccess(await ctx.post("/api/gift-cards", {
        amount: 250,
        customerId: customer.id,
        expiresOn: isoDaysFromNow(365),
        note: "Festival store credit",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.match(issued.code, /^KOS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      assert.equal(issued.balance, 250);
      assert.equal(issued.transactions[0].type, "issue");

      const lookedUp = assertSuccess(await ctx.post("/api/gift-cards/lookup", { code: issued.code }, { token: auth.accessToken }));
      assert.equal(lookedUp.balance, 250);
      assert.equal(lookedUp.code, undefined, "lookup must never disclose the bearer code");

      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        customerId: customer.id,
        customerName: customer.name,
        quantity: 1,
        ratePerRateUnit: 100,
        payments: [{ mode: "gift_card", amount: 75, giftCardCode: issued.code }, { mode: "cash", amount: 25 }],
        actualAmount: 100,
        buyerPaidAmount: 100,
      }), { token: auth.accessToken }), 201);
      assert.equal(bill.giftCardAmount, 75);
      assert.equal(bill.payments.some((payment) => payment.mode === "gift_card" && payment.provider === "gift_card_ledger"), true);
      assert.equal((await ctx.db.giftCard.findUnique({ where: { id: issued.id } })).balancePaise, 17500n);
      const giftSaleLedger = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, billId: bill.id }, orderBy: { entryType: "asc" } });
      assert.deepEqual(giftSaleLedger.map((row) => [row.entryType, row.amountPaise]), [["cash_in", 2500n], ["gift_card_redeemed", 7500n], ["sale", 10000n]], "gift redemption must debit stored-value liability instead of disappearing from accounting");
      const firstControl = assertSuccess(await ctx.get("/api/accounting/control?from=2020-01-01T00%3A00%3A00.000Z&to=2030-01-01T00%3A00%3A00.000Z", { token: auth.accessToken }));
      assert.equal(firstControl.status, "balanced");
      assert.equal(firstControl.scope, "shop");
      assert.equal(firstControl.coverage.unmappedRows, 0);
      assert.equal(firstControl.trialBalance.difference.paise, 0);
      assert.ok(firstControl.limitations.some((item) => item.includes("does not claim statutory books are complete")));

      const waivedSale = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 1,
        ratePerRateUnit: 100,
        payments: [{ mode: "cash", amount: 95 }],
        actualAmount: 100,
        buyerPaidAmount: 95,
        waivedAmount: 5,
      }), { token: auth.accessToken }), 201);
      const waivedLedger = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, billId: waivedSale.id }, orderBy: { entryType: "asc" } });
      assert.deepEqual(waivedLedger.map((row) => [row.entryType, row.amountPaise]), [["cash_in", 9500n], ["sale", 10000n], ["waiver_expense", 500n]], "waived money must be an explicit debit leg");
      const controlWithWaiver = assertSuccess(await ctx.get("/api/accounting/control?from=2020-01-01T00%3A00%3A00.000Z&to=2030-01-01T00%3A00%3A00.000Z", { token: auth.accessToken }));
      assert.equal(controlWithWaiver.status, "balanced");
      assert.equal(controlWithWaiver.coverage.balancedGroups, 2);
      assert.equal(controlWithWaiver.trialBalance.difference.paise, 0);

      const overspend = assertFailure(await ctx.post("/api/bills/confirm", billPayload(product, {
        payments: [{ mode: "gift_card", amount: 200, giftCardCode: issued.code }],
        quantity: 2,
        ratePerRateUnit: 100,
        actualAmount: 200,
        buyerPaidAmount: 200,
      }), { token: auth.accessToken }), 409);
      assert.equal(overspend.code, "GIFT_CARD_INSUFFICIENT_BALANCE");
      assert.equal((await ctx.db.giftCard.findUnique({ where: { id: issued.id } })).balancePaise, 17500n, "failed checkout must not consume value");

      const cashSale = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        customerId: customer.id,
        customerName: customer.name,
        quantity: 1,
        ratePerRateUnit: 100,
        payments: [{ mode: "cash", amount: 100 }],
        actualAmount: 100,
        buyerPaidAmount: 100,
      }), { token: auth.accessToken }), 201);
      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Returns Branch", code: "RET01", city: "Pune" }, { token: auth.accessToken }), 201);
      const returnCredit = assertSuccess(await ctx.post("/api/bills/returns", {
        refundMode: "gift_card",
        customerId: customer.id,
        customerName: customer.name,
        returnOfBillId: cashSale.id,
        reason: "Customer changed their mind",
        items: [{ productId: product.id, name: product.name, quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0, damaged: false }],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin, headers: { "x-location-id": branch.id } }), 201);
      assert.equal(returnCredit.refundMode, "gift_card");
      assert.equal(returnCredit.giftCardAmount, -100);
      assert.match(returnCredit.issuedGiftCard.code, /^KOS-/);
      assert.equal(returnCredit.issuedGiftCard.balance, 100);
      assert.equal(returnCredit.locationId, branch.id, "a cross-channel return must restock the accepting branch");
      const giftReturnLedger = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, billId: returnCredit.id }, orderBy: { entryType: "asc" } });
      assert.deepEqual(giftReturnLedger.map((row) => [row.entryType, row.amountPaise]), [["gift_card_issued", 10000n], ["sale", -10000n]], "store-credit returns must expose the new gift-value liability without fake cash movement");

      const repeatReturn = assertFailure(await ctx.post("/api/bills/returns", {
        refundMode: "cash",
        returnOfBillId: cashSale.id,
        reason: "Duplicate return attempt",
        items: [{ productId: product.id, name: product.name, quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0, damaged: false }],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin, headers: { "x-location-id": branch.id } }), 409);
      assert.equal(repeatReturn.code, "RETURN_EXCEEDS_ORIGINAL_SALE");

      const cancelReturnedSale = assertFailure(await ctx.post(`/api/bills/${cashSale.id}/cancel`, { reason: "Invalid cancellation after return" }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(cancelReturnedSale.code, "BILL_HAS_ACTIVE_RETURNS");

      const crossBranchRedemption = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        customerId: customer.id,
        customerName: customer.name,
        quantity: 1,
        ratePerRateUnit: 100,
        payments: [{ mode: "gift_card", amount: 100, giftCardCode: returnCredit.issuedGiftCard.code }],
        actualAmount: 100,
        buyerPaidAmount: 100,
      }), { token: auth.accessToken, headers: { "x-location-id": branch.id } }), 201);
      assert.equal(crossBranchRedemption.locationId, branch.id);
      assert.equal((await ctx.db.giftCard.findUnique({ where: { id: returnCredit.issuedGiftCard.id } })).balancePaise, 0n);

      assertSuccess(await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Gift purchase cancelled" }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal((await ctx.db.giftCard.findUnique({ where: { id: issued.id } })).balancePaise, 25000n);
      const ledger = await ctx.db.giftCardTransaction.findMany({ where: { giftCardId: issued.id, billId: bill.id } });
      assert.equal(ledger.reduce((sum, row) => sum + row.amountPaise, 0n), 0n);
    });
  });
}
