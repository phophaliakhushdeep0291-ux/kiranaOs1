import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, assertSuccess, resetDatabase } from "./setup.js";
import { createTenant, createProduct, login, billPayload } from "./factories.js";
import { BUSINESS_TYPES, settingsForBusinessType } from "../../src/verticals/registry.js";
import { availableAgentTools } from "../../src/modules/ai/agent/agent.service.js";

const ctx = await createIntegrationContext();
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
if (ctx.skip) test("shop-type flows unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  // Files run in separate processes but share this invocation's test database.
  // Factory phone sequences restart per process, so remove prior-file tenants.
  before(() => resetDatabase(ctx.db));
  for (const trade of BUSINESS_TYPES) {
    test(`${trade}: bootstrap, counter sale and dedicated workflow persist`, async () => {
      const tenant = await createTenant(ctx.db, { shopName: `Shop audit ${trade}`, planCode: "pro" });
      await ctx.db.shop.update({ where: { id: tenant.shop.id }, data: { settingsJson: JSON.stringify(settingsForBusinessType(trade)) } });
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const options = { token: auth.accessToken, ownerPin: tenant.ownerPin };
      const get = async (path) => assertSuccess(await ctx.get(path, options));
      const post = async (path, body = {}, status = 200) => assertSuccess(await ctx.post(path, body, options), status);
      const product = await createProduct(ctx.db, tenant.shop.id, { name: `QA ${trade} item`, stockBaseQty: 20 });
      const bootstrap = await get("/api/shops/bootstrap");
      assert.equal(bootstrap.shop.businessType, trade);
      const bill = await post("/api/bills/confirm", billPayload(product), 201);
      assert.ok(bill.id);
      assert.equal((await ctx.db.bill.findUnique({ where: { id: bill.id } })).shopId, tenant.shop.id);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 18);

      if (trade === "clothing") {
        const rental = await post("/api/rentals", {
          customerName: "QA Renter", customerPhone: "9999999991", customerAddress: "QA counter",
          fromDate: day(), toDate: day(2), items: [{ productId: product.id, name: product.name, qty: 1, amount: 100 }],
          rentAmount: 100, depositAmount: 200, advancePaid: 100,
        }, 201);
        assert.equal((await post(`/api/rentals/${rental.id}/pickup`)).status, "picked_up");
        assert.equal((await post(`/api/rentals/${rental.id}/return`, { damageCharge: 10 })).status, "returned");
        assert.equal((await get(`/api/rentals/${rental.id}`)).damageCharge, 10);
        assert.equal((await get("/api/rentals/summary")).pendingCollection, 10, "returned items do not erase unpaid fees");
      }
      if (trade === "footwear") {
        await ctx.db.product.update({ where: { id: product.id }, data: { variantAxesJson: JSON.stringify([{ name: "Size", values: ["7", "8", "9"] }]) } });
        assertSuccess(await ctx.request("PUT", `/api/size-runs/${product.id}/profile`, { ...options, body: { sizeSystem: "uk", gender: "mens" } }));
        const run = await get(`/api/size-runs/${product.id}`);
        assert.equal(run.sizeSystem, "uk");
        assert.ok(await get("/api/size-runs/convert?system=uk&value=8&gender=mens"));
      }
      if (trade === "auto_parts") {
        const fitment = await post("/api/fitment", { productId: product.id, make: "QA Make", model: "QA Model", yearFrom: 2020, yearTo: 2026 }, 201);
        assert.ok(fitment.id);
        const matches = await get("/api/fitment/search?make=QA%20Make&model=QA%20Model&year=2024");
        assert.match(JSON.stringify(matches), new RegExp(product.id));
        const reference = await post("/api/fitment/references", { productId: product.id, partNumber: "QA-OEM-01", kind: "oem" }, 201);
        assert.equal(reference.partNumber, "QA-OEM-01");
      }
      if (trade === "electronics") {
        const units = await post("/api/product-units", { productId: product.id, warrantyMonths: 12, units: [{ serialNumber: "QA-SERIAL-01" }] }, 201);
        const unit = units[0];
        assert.equal((await post(`/api/product-units/${unit.id}/sell`, { billId: bill.id, sellingPrice: 20, customerName: "QA Buyer" })).status, "sold");
        assert.equal((await get("/api/product-units/lookup/QA-SERIAL-01")).warrantyMonths, 12);
        assert.equal((await post(`/api/product-units/${unit.id}/return`, { condition: "open_box" })).status, "returned");
        assert.equal((await post(`/api/product-units/${unit.id}/service`, { reason: "QA screen check" })).status, "rma");
        assert.equal((await post(`/api/product-units/${unit.id}/service-return`, { condition: "refurbished" })).condition, "refurbished");
        assert.equal((await get("/api/product-units/summary")).inStock, 1, "a returned service unit is physically back on the shelf");
      }
      if (trade === "pharmacy") {
        const rx = await post("/api/prescriptions", {
          doctorName: "QA Doctor", patientName: "QA Patient", scheduleType: "otc", prescribedOn: day(),
          items: [{ productId: product.id, name: product.name, qty: 1 }], refillsAllowed: 1,
        }, 201);
        await post(`/api/prescriptions/${rx.id}/dispense`, { billId: bill.id });
        assert.equal((await get(`/api/prescriptions/${rx.id}`)).status, "dispensed");
      }
      if (trade === "stationery") {
        const list = await post("/api/book-lists", { schoolName: "QA School", className: "6", academicYear: "2026-27", items: [{ productId: product.id, name: product.name, qty: 2 }] }, 201);
        assert.equal((await get(`/api/book-lists/${list.id}`)).items[0].qty, 2);
        const copied = await post(`/api/book-lists/${list.id}/copy`, { academicYear: "2027-28" }, 201);
        assert.notEqual(copied.id, list.id);
        assert.equal(copied.items.length, 1);
      }
      if (trade === "furniture") {
        const order = await post("/api/furniture-orders", { customerName: "QA Buyer", items: [{ productId: product.id, name: product.name, qty: 1, rate: 100 }], deliveryCharge: 20, promisedOn: day(2) }, 201);
        assert.equal(order.grandTotal, 120);
        await post(`/api/furniture-orders/${order.id}/status`, { status: "confirmed" });
        assert.equal((await post(`/api/furniture-orders/${order.id}/payments`, { amount: 40, mode: "cash" }, 201)).balanceDue, 80);
        await post(`/api/furniture-orders/${order.id}/status`, { status: "ready" });
        await post(`/api/furniture-orders/${order.id}/status`, { status: "delivered", billId: bill.id });
        assert.equal((await post(`/api/furniture-orders/${order.id}/status`, { status: "installed" })).status, "installed");
      }
      if (trade === "cosmetics") {
        const tester = await post("/api/testers", { productId: product.id, variant: "QA Red", moveStock: true }, 201);
        assert.ok(tester.stockLedgerId);
        assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 17);
        assert.equal((await post(`/api/testers/${tester.id}/close`, { status: "discarded" })).status, "discarded");
      }
      if (trade === "restaurant") {
        const table = await post("/api/restaurant/tables", { name: "QA Table", seats: 2, selfOrderEnabled: false }, 201);
        const body = { tableId: table.id, tableName: table.name, billId: `qa-sitting-${table.id}`, lines: [{ key: product.id, name: product.name, qty: 1 }], idempotencyKey: `qa-kot-${table.id}` };
        const ticket = await post("/api/restaurant/kot", body, 201);
        assert.ok(ticket.id);
        for (const status of ["preparing", "ready", "served"]) {
          assertSuccess(await ctx.patch(`/api/restaurant/kot/${ticket.id}/status`, { status }, options));
        }
        assert.equal((await ctx.db.kitchenTicket.findUnique({ where: { id: ticket.id } })).status, "served");
      }
      if (trade === "manufacturing") {
        await ctx.db.product.update({ where: { id: product.id }, data: { batchTrackingEnabled: true } });
        const material = await createProduct(ctx.db, tenant.shop.id, { name: "QA raw material", stockBaseQty: 100 });
        const bom = await post("/api/manufacturing/boms", { name: "QA recipe", finishedProductId: product.id, outputQuantityBaseQty: 10, items: [{ materialProductId: material.id, quantityBaseQty: 12 }] }, 201);
        const run = await post("/api/manufacturing/runs", { bomId: bom.id, runNumber: "QA-RUN-01", plannedOutputBaseQty: 10 }, 201);
        await post(`/api/manufacturing/runs/${run.id}/complete`, { actualOutputBaseQty: 10, finishedBatchNumber: "QA-BATCH-01", manufacturedOn: day(), expiresOn: day(365), qcStatus: "passed", consumptions: [{ productId: material.id, actualBaseQty: 12 }], outputs: [{ quantityBaseQty: 10 }] });
        assert.equal((await ctx.db.product.findUnique({ where: { id: material.id } })).stockBaseQty, 88);
        assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 28);
        assert.ok(await get("/api/manufacturing/trace?batchNumber=QA-BATCH-01"));
      }
      // All trades keep core customer and reporting routes reachable.
      assert.ok(await get("/api/customers"));
      const toolContext = { shopId: tenant.shop.id, userId: tenant.owner.id, role: "owner", businessType: trade };
      const tools = await availableAgentTools(toolContext);
      const capabilities = await get("/api/ai/agent/capabilities");
      assert.deepEqual(capabilities.tools.map((tool) => tool.name), tools.map((tool) => tool.name));
      const workflowTool = tools.find((tool) => tool.name === `${trade}_workflow_summary`);
      if (!["kirana", "restaurant", "other"].includes(trade)) {
        assert.ok(workflowTool, `${trade} needs its own register summary`);
        assert.ok(await workflowTool.handler({}, toolContext));
      }
      assert.ok(tools.filter((tool) => tool.name.endsWith("_workflow_summary")).every((tool) => tool.name.startsWith(`${trade}_`)));
    });
  }
}
