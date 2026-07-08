import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess } from "./setup.js";
import { activateDeviceViaApi, billPayload, createCustomer, createProduct, createStaff, createTenant, login, productPayload, unique } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("sync integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const device = await activateDeviceViaApi(ctx, ownerAuth.accessToken, { deviceId: "sync-device" });
    const deviceHeaders = { "x-device-id": device.deviceId };
    return { tenant, ownerAuth, device, deviceHeaders };
  }

  describe("sync integration", () => {
    test("sync push CREATE_PRODUCT works", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const response = await ctx.post("/api/sync/push", {
        events: [{ eventId: "create-product-1", type: "CREATE_PRODUCT", payload: { product: productPayload({ name: "Sync Product" }) } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 1);
      assert.ok(data.results[0].serverId);
    });

    test("CREATE_PRODUCT retried under a new event id converges to one product", async () => {
      // The same offline product re-pushed under a different event id (retry after a lost
      // ack). Event-level idempotency does NOT catch this (different event ids), so the
      // create itself must converge on the durable client identity: one server product,
      // both local ids mapped onto it, and no duplicate / name-conflict failure.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = productPayload({ name: "Parle-G Biscuit" });
      const response = await ctx.post("/api/sync/push", {
        events: [
          { eventId: "create-product-conv-1", type: "CREATE_PRODUCT", payload: { localProductId: "local_prod_x", product } },
          { eventId: "create-product-conv-2", type: "CREATE_PRODUCT", payload: { localProductId: "local_prod_x", product } },
        ],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.failed, 0, "neither product create should fail");
      assert.equal(data.summary.conflicts, 0, "retried product create must converge, not conflict");
      const serverIdA = data.idMappings.products?.local_prod_x;
      assert.ok(serverIdA, "local product id maps to a server product");

      const count = await ctx.db.product.count({ where: { shopId: tenant.shop.id, name: "Parle-G Biscuit", deletedAt: null } });
      assert.equal(count, 1, "exactly one product should exist after the retried create");
    });

    test("sync push CREATE_CUSTOMER works", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const response = await ctx.post("/api/sync/push", {
        events: [{ eventId: "create-customer-1", type: "CREATE_CUSTOMER", payload: { customer: { name: "Sync Customer", mobile: "6999999991", type: "regular" } } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 1);
      assert.ok(data.results[0].serverId);
    });

    test("CREATE_CUSTOMER converges on existing mobile instead of duplicating or failing", async () => {
      // Same customer (same mobile) created twice with different event ids and different
      // local ids — e.g. a retry after a lost ack, or the same customer added on a second
      // device. Event-level idempotency does NOT catch this (different event ids), so the
      // create itself must converge: one server customer, both local ids mapped onto it,
      // and no permanently-failed sync event.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const mobile = "6999900042";
      const response = await ctx.post("/api/sync/push", {
        events: [
          { eventId: "create-customer-conv-1", type: "CREATE_CUSTOMER", payload: { localCustomerId: "local_cust_a", customer: { name: "Ramesh", mobile, type: "regular" } } },
          { eventId: "create-customer-conv-2", type: "CREATE_CUSTOMER", payload: { localCustomerId: "local_cust_b", customer: { name: "Ramesh", mobile, type: "regular" } } },
        ],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.failed, 0, "neither customer create should fail");
      assert.equal(data.summary.conflicts, 0, "duplicate-mobile create must converge, not conflict");
      const serverIdA = data.idMappings.customers?.local_cust_a;
      const serverIdB = data.idMappings.customers?.local_cust_b;
      assert.ok(serverIdA, "first local customer id maps to a server customer");
      assert.equal(serverIdB, serverIdA, "second local customer id converges to the same server customer");

      const count = await ctx.db.customer.count({ where: { shopId: tenant.shop.id, mobile, deletedAt: null } });
      assert.equal(count, 1, "exactly one active customer should exist for the mobile");
    });

    test("bill creation posts append-only FinancialLedger entries exactly once across retries", async () => {
      // Part 4 consistency: a partial cash + udhar bill must post sale + cash_in + udhar_debit.
      // Re-pushing the same bill under a new event id (retry after lost ack) must NOT double-post:
      // the ledger is the dashboard's source of truth, so a retry that double-counted would
      // corrupt every money KPI. The unique idempotency key guarantees exactly-once.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
      const localBillId = "local-bill-ledger-1";
      const billBody = {
        ...billPayload(product, {
          quantity: 1,
          ratePerRateUnit: 100,
          customerId: customer.id,
          customerName: customer.name,
          buyerPaidAmount: 40,
          payments: [{ mode: "cash", amount: 40 }],
        }),
        localBillId,
        clientBillId: localBillId,
        idempotencyKey: "create-bill:test:ledger:1",
        creditAmount: 60,
      };
      const event = {
        type: "CREATE_BILL",
        payload: { localBillId, clientBillId: localBillId, idempotencyKey: "create-bill:test:ledger:1", bill: billBody },
      };

      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "create-bill-ledger-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      // Retry under a brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "create-bill-ledger-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const ledger = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id } });
      const ofType = (entryType) => ledger.filter((row) => row.entryType === entryType);
      assert.equal(ledger.length, 3, "sale + cash_in + udhar_debit, posted once despite the retry");
      assert.equal(ofType("sale").length, 1);
      assert.equal(Number(ofType("sale")[0].amountPaise), 10000, "sale = ₹100");
      assert.equal(ofType("cash_in").length, 1);
      assert.equal(Number(ofType("cash_in")[0].amountPaise), 4000, "cash_in = ₹40");
      assert.equal(ofType("upi_in").length, 0, "no UPI tender on this bill");
      assert.equal(ofType("udhar_debit").length, 1);
      assert.equal(Number(ofType("udhar_debit")[0].amountPaise), 6000, "udhar_debit = ₹60");
    });

    test("ADJUST_STOCK (damage) replayed under a new event id applies stock only once", async () => {
      // A damage adjustment that committed but lost its ack gets re-pushed under a new event id.
      // Event-level idempotency cannot catch this (different event ids), and damage is relative —
      // re-applying would decrement stock twice and corrupt inventory. The durable StockLedger
      // idempotencyKey guarantees exactly-once: stock moves once, one ledger row.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
      const payload = {
        productId: product.id,
        adjustmentType: "damage",
        quantity: 3,
        enteredUnit: product.baseUnit,
        idempotencyKey: "adjust-stock:test:dmg:1",
        clientMovementId: "adjust-stock:test:dmg:1",
        ownerPin: tenant.ownerPin,
      };
      const event = { type: "ADJUST_STOCK", ownerPin: tenant.ownerPin, payload };

      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "dmg-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      // Retry under a brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "dmg-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const fresh = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(fresh.stockBaseQty, 7, "damage of 3 applied exactly once (10 → 7), not twice");
      const damageRows = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id, action: "damage" },
      });
      assert.equal(damageRows.length, 1, "exactly one damage ledger row despite the retry");
    });

    test("STOCK_PURCHASE replayed under a new event id applies stock + cost + history once", async () => {
      // A purchase that committed but lost its ack gets re-pushed under a new event id. A double
      // apply would over-increment stock, recompute weighted-average cost off the inflated base,
      // and write a second PurchaseHistory row (doubling the supplier's outstanding due). The
      // durable StockLedger idempotencyKey guarantees exactly-once across all three.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, costPerRateUnit: 10 });
      const payload = {
        productId: product.id,
        quantity: 10,
        enteredUnit: product.baseUnit,
        billAmount: 200, // 10 units @ ₹20 → weightedAvgCost(10,10,10,20) = 15
        supplierName: "Acme Distributors",
        idempotencyKey: "stock-purchase:test:1",
        clientMovementId: "stock-purchase:test:1",
      };
      const event = { type: "STOCK_PURCHASE", payload };

      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "purch-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      // Retry under a brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "purch-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const fresh = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(fresh.stockBaseQty, 20, "purchase of 10 applied once (10 → 20), not twice");
      assert.equal(fresh.costPerRateUnit, 15, "weighted-average cost computed once (15), not off an inflated base");
      const purchaseRows = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id, action: "purchase" },
      });
      assert.equal(purchaseRows.length, 1, "exactly one purchase ledger row despite the retry");
      const history = await ctx.db.purchaseHistory.findMany({ where: { shopId: tenant.shop.id, productId: product.id } });
      assert.equal(history.length, 1, "exactly one PurchaseHistory row (supplier due not doubled)");
    });

    test("STOCK_PURCHASE normalizes legacy partial purchase payloads before validation", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, costPerRateUnit: 10 });
      const result = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          type: "STOCK_PURCHASE",
          eventId: "legacy-purchase-normalize-1",
          payload: {
            productId: product.id,
            quantity: 10,
            enteredUnit: product.baseUnit,
            billAmount: 200,
            supplierName: "Legacy Supplier",
            purchasePaymentStatus: "partial",
            purchaseDueDate: "2026-06-18T12:00:00.000Z",
            idempotencyKey: "stock-purchase:legacy-normalize-1",
            clientMovementId: "stock-purchase:legacy-normalize-1",
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      assert.equal(String(result.results[0].status).toLowerCase(), "synced");
      const history = await ctx.db.purchaseHistory.findFirst({ where: { shopId: tenant.shop.id, productId: product.id } });
      assert.equal(history.purchasePaymentStatus, "due");
      assert.equal(history.purchasePaidAmount, 0);
      assert.equal(history.purchaseDueAmount, 200);
      assert.equal(history.purchaseDueDate.toISOString().slice(0, 10), "2026-06-18");
    });

    test("CREATE_LEDGER_ADJUSTMENT replayed under a new event id applies to udhar once", async () => {
      // A manual udhar adjustment that committed but lost its ack gets re-pushed under a new event
      // id. Event-level idempotency cannot catch this (different event ids), and a double apply
      // would move the customer's balance twice. The durable UdharLedger idempotencyKey guarantees
      // exactly-once: one adjustment row, balance moved once.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id); // starts at balance 0
      const payload = {
        customerId: customer.id,
        amount: 200, // debit adjustment: +₹200
        note: "manual correction",
        idempotencyKey: "ledger-adjust:test:1",
        clientLedgerId: "ledger-adjust:test:1",
      };
      const event = { type: "CREATE_LEDGER_ADJUSTMENT", payload };

      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "ladj-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      // Retry under a brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "ladj-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const adjustments = await ctx.db.udharLedger.findMany({
        where: { shopId: tenant.shop.id, customerId: customer.id, mode: "adjustment" },
      });
      assert.equal(adjustments.length, 1, "exactly one adjustment ledger row despite the retry");
      const after = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(after.udharAmount, 200, "adjustment applied exactly once (balance ₹200, not ₹400)");
    });

    test("CREATE_LEDGER_ADJUSTMENT accepts negative repair amounts without schema conflicts", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          type: "CREATE_LEDGER_ADJUSTMENT",
          eventId: "ladj-negative-seed",
          payload: {
            customerId: customer.id,
            amount: 200,
            note: "opening correction",
            idempotencyKey: "ledger-adjust:negative-seed",
            clientLedgerId: "ledger-adjust:negative-seed",
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const result = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          type: "CREATE_LEDGER_ADJUSTMENT",
          eventId: "ladj-negative-1",
          payload: {
            customerId: customer.id,
            amount: -60,
            note: "reduce wrong opening balance",
            idempotencyKey: "ledger-adjust:negative-1",
            clientLedgerId: "ledger-adjust:negative-1",
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      assert.equal(String(result.results[0].status).toLowerCase(), "synced");
      const after = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(after.udharAmount, 140);
      const adjustments = await ctx.db.udharLedger.findMany({
        where: { shopId: tenant.shop.id, customerId: customer.id, mode: "adjustment" },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(adjustments.map((row) => row.type), ["debit", "payment"]);
    });

    test("STOCK_SALE replayed under a new event id decrements stock once", async () => {
      // A manual offline stock-out that committed but lost its ack gets re-pushed under a new event
      // id. STOCK_SALE is relative (decrement), so a double apply would remove stock twice. The
      // durable StockLedger idempotencyKey guarantees exactly-once.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
      const payload = {
        productId: product.id,
        quantity: 3,
        enteredUnit: product.baseUnit,
        idempotencyKey: "stock-sale:test:1",
        clientMovementId: "stock-sale:test:1",
      };
      const event = { type: "STOCK_SALE", payload };

      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "ssale-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      // Retry under a brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "ssale-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const fresh = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(fresh.stockBaseQty, 7, "sale of 3 applied exactly once (10 → 7), not twice");
      const saleRows = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id, action: "sale" },
      });
      assert.equal(saleRows.length, 1, "exactly one sale ledger row despite the retry");
    });

    test("sync push CREATE_BILL works", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 30 });
      const response = await ctx.post("/api/sync/push", {
        events: [{ eventId: "create-bill-1", type: "CREATE_BILL", payload: { bill: billPayload(product, { quantity: 2, ratePerRateUnit: 30 }) } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 1);
      assert.ok(data.results[0].result.billId);
      const refreshedProduct = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshedProduct.stockBaseQty, 8);
    });

    test("offline CREATE_BILL with insufficient stock is recorded (not dropped), stock goes negative for reconcile", async () => {
      // The sale already happened at the counter offline; the server must record it rather
      // than reject + drop it. Stock is allowed to go negative so the shopkeeper sees the exact
      // deficit (per "allow stock shortfall" + "negative stock handling"), and the shortfall is
      // flagged on the sale ledger for reconciliation with the next stock-in.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 2, defaultPricePerRateUnit: 10 });
      const localBillId = "local-bill-shortfall-1";
      const response = await ctx.post("/api/sync/push", {
        events: [{
          eventId: "create-bill-shortfall-1",
          type: "CREATE_BILL",
          payload: {
            localBillId,
            clientBillId: localBillId,
            idempotencyKey: "create-bill:test:shortfall:1",
            bill: {
              ...billPayload(product, { quantity: 5, ratePerRateUnit: 10, payments: [{ mode: "cash", amount: 50 }] }),
              localBillId,
              clientBillId: localBillId,
              idempotencyKey: "create-bill:test:shortfall:1",
            },
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 1, "the completed offline sale is recorded, not rejected");
      assert.equal(data.summary.failed, 0);
      assert.equal(data.summary.conflicts, 0);

      const billId = data.results[0].result.billId;
      assert.ok(await ctx.db.bill.findUnique({ where: { id: billId } }), "bill is recorded");

      const refreshed = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshed.stockBaseQty, -3, "stock reflects the real deficit (2 in stock, 5 sold) for reconciliation");

      const saleLedger = await ctx.db.stockLedger.findFirst({
        where: { shopId: tenant.shop.id, productId: product.id, action: "sale" },
      });
      assert.match(String(saleLedger?.note ?? ""), /shortfall/i, "shortfall flagged on the ledger for reconciliation");
    });

    test("sync push CREATE_BILL accepts separated creditAmount for udhar bill", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 80 });
      const localBillId = "local-bill-udhar-1";
      const response = await ctx.post("/api/sync/push", {
        events: [{
          eventId: "create-udhar-bill-1",
          type: "CREATE_BILL",
          payload: {
            localBillId,
            clientBillId: localBillId,
            idempotencyKey: "create-bill:test:udhar:1",
            bill: {
              ...billPayload(product, {
                quantity: 1,
                ratePerRateUnit: 80,
                customerId: customer.id,
                customerName: customer.name,
                buyerPaidAmount: 0,
                payments: [],
              }),
              localBillId,
              clientBillId: localBillId,
              idempotencyKey: "create-bill:test:udhar:1",
              creditAmount: 80,
              creditPayments: [{ mode: "credit", amount: 80 }],
              paymentStatus: "credit",
            },
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 1);
      assert.equal(data.results[0].status, "synced");
      assert.equal(data.results[0].serverBillId, data.results[0].result.billId);
      assert.equal(data.idMappings.bills[localBillId], data.results[0].result.billId);

      const bill = await ctx.db.bill.findUnique({ where: { id: data.results[0].result.billId }, include: { payments: true } });
      assert.equal(bill.paidAmount, 0);
      assert.equal(bill.creditAmount, 80);
      assert.equal(bill.payments.length, 0);

      const updatedCustomer = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(updatedCustomer.udharAmount, 80);
      const ledger = await ctx.db.udharLedger.findFirst({ where: { shopId: tenant.shop.id, billId: bill.id, type: "debit" } });
      assert.equal(ledger.amount, 80);
    });

    test("two same-amount udhar payments can clear balance and retry idempotently", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, {
        name: "Split Pay Customer",
        type: "udhar",
        udharAmount: 200,
      });
      const eventA = {
        eventId: "udhar-split-pay-1",
        type: "UDHAR_PAYMENT",
        payload: {
          customerId: customer.id,
          localPaymentId: "local-payment-100-a",
          localLedgerEntryId: "local-ledger-100-a",
          idempotencyKey: "record-payment:test:split:a",
          payment: {
            amount: 100,
            mode: "cash",
            localPaymentId: "local-payment-100-a",
            localLedgerEntryId: "local-ledger-100-a",
            idempotencyKey: "record-payment:test:split:a",
          },
        },
      };
      const eventB = {
        eventId: "udhar-split-pay-2",
        type: "UDHAR_PAYMENT",
        payload: {
          customerId: customer.id,
          localPaymentId: "local-payment-100-b",
          localLedgerEntryId: "local-ledger-100-b",
          idempotencyKey: "record-payment:test:split:b",
          payment: {
            amount: 100,
            mode: "cash",
            localPaymentId: "local-payment-100-b",
            localLedgerEntryId: "local-ledger-100-b",
            idempotencyKey: "record-payment:test:split:b",
          },
        },
      };

      let data = assertSuccess(await ctx.post("/api/sync/push", {
        events: [eventA, eventB],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(data.summary.synced, 2);
      assert.equal(data.summary.failed, 0);

      data = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{ ...eventA, eventId: "udhar-split-pay-1-retry" }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(data.summary.synced, 1);
      assert.equal(data.results[0].result.idempotentReplay, true);

      const updatedCustomer = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(updatedCustomer.udharAmount, 0);
      const paymentLedgers = await ctx.db.udharLedger.findMany({
        where: { shopId: tenant.shop.id, customerId: customer.id, type: "payment" },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(paymentLedgers.length, 2);
      assert.deepEqual(paymentLedgers.map((row) => row.amount), [100, 100]);
    });

    test("same batch resolves local product and customer ids before creating bill", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const response = await ctx.post("/api/sync/push", {
        events: [
          {
            eventId: "local-product-map-1",
            type: "CREATE_PRODUCT",
            payload: {
              localProductId: "local-prod-rice",
              product: productPayload({ localId: "local-prod-rice", name: "Offline Rice", stockBaseQty: 10, defaultPricePerRateUnit: 50 }),
            },
          },
          {
            eventId: "local-customer-map-1",
            type: "CREATE_CUSTOMER",
            payload: {
              localCustomerId: "local-cust-raju",
              customer: { localId: "local-cust-raju", name: "Raju Local", mobile: "6999999912", type: "regular" },
            },
          },
          {
            eventId: "local-bill-map-1",
            type: "CREATE_BILL",
            payload: {
              localBillId: "local-bill-rice-1",
              bill: {
                localId: "local-bill-rice-1",
                billType: "normal_sale",
                customerId: "local-cust-raju",
                localCustomerId: "local-cust-raju",
                customerName: "Raju Local",
                items: [
                  { productId: "local-prod-rice", localProductId: "local-prod-rice", name: "Offline Rice", quantity: 2, enteredUnit: "piece", ratePerRateUnit: 50, gstRate: 0 },
                ],
                discount: 0,
                buyerPaidAmount: 100,
                payments: [{ mode: "cash", amount: 100 }],
              },
            },
          },
        ],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 3);
      assert.ok(data.idMappings.products["local-prod-rice"]);
      assert.ok(data.idMappings.customers["local-cust-raju"]);
      assert.ok(data.idMappings.bills["local-bill-rice-1"]);

      const bill = await ctx.db.bill.findUnique({ where: { id: data.idMappings.bills["local-bill-rice-1"] }, include: { items: true } });
      assert.equal(bill.customerId, data.idMappings.customers["local-cust-raju"]);
      assert.equal(bill.items[0].productId, data.idMappings.products["local-prod-rice"]);
    });

    test("duplicate event replay returns duplicate and does not duplicate DB row", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const event = { eventId: "duplicate-product-1", type: "CREATE_PRODUCT", payload: { product: productPayload({ name: "Only Once" }) } };
      assertSuccess(await ctx.post("/api/sync/push", { events: [event] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const second = assertSuccess(await ctx.post("/api/sync/push", { events: [event] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(second.summary.duplicates, 1);
      const count = await ctx.db.product.count({ where: { name: "Only Once" } });
      assert.equal(count, 1);
    });

    test("push batch over 500 is rejected with SYNC_BATCH_TOO_LARGE", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const events = Array.from({ length: 501 }, (_, i) => ({
        eventId: `too-large-${i}`,
        type: "CREATE_CUSTOMER",
        payload: { customer: { name: `Bulk ${i}`, type: "regular" } },
      }));
      const response = await ctx.post("/api/sync/push", { events }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      assert.equal(response.status, 400, JSON.stringify(response.body));
      assert.equal(response.body?.code, "SYNC_BATCH_TOO_LARGE");
    });

    test("push response includes summary/serverTime", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const response = await ctx.post("/api/sync/push", {
        events: [{ eventId: "summary-1", type: "CREATE_CUSTOMER", payload: { customer: { name: "Summary Customer", type: "regular" } } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.ok(response.body.summary);
      assert.ok(response.body.serverTime);
      assert.ok(response.body.data.summary);
      assert.ok(response.body.data.serverTime);
    });

    test("pull supports since/cursor/limit and returns hasMore/nextCursor metadata", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      await createProduct(ctx.db, tenant.shop.id, { name: unique("Pull A") });
      await createProduct(ctx.db, tenant.shop.id, { name: unique("Pull B") });
      const since = encodeURIComponent(new Date(0).toISOString());
      const first = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=1`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(first.sync.limit, 1);
      assert.equal(first.sync.hasMore, true);
      assert.ok(first.sync.nextCursor);

      const second = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=1&cursor=${encodeURIComponent(first.sync.nextCursor)}`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.ok("hasMore" in second.sync);
      assert.ok("nextCursor" in second.sync);
    });

    test("cashier sync pull excludes product cost + supplier/purchase data; owner pull includes cost", async () => {
      // Synced data lives in inspectable IndexedDB, so a cashier device must never receive
      // cost/profit/supplier/purchase-cost data even though the UI hides it.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const staffDevice = await activateDeviceViaApi(ctx, staffAuth.accessToken, { deviceId: "cashier-pull-device" });
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50, costPerRateUnit: 30 });

      const since = encodeURIComponent(new Date(0).toISOString());
      const ownerPull = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=200`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const cashierPull = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=200`, { token: staffAuth.accessToken, headers: { "x-device-id": staffDevice.deviceId } }));

      const ownerProduct = ownerPull.products.find((p) => p.id === product.id);
      assert.equal(ownerProduct?.costPerRateUnit, 30, "owner receives product cost");

      const cashierProduct = cashierPull.products.find((p) => p.id === product.id);
      assert.ok(cashierProduct, "cashier still receives the product for billing");
      assert.equal(cashierProduct.costPerRateUnit, undefined, "cashier must NOT receive product cost");
      assert.equal(cashierProduct.defaultPricePerRateUnit, 50, "cashier still gets the selling price");
      assert.equal(cashierPull.suppliers.length, 0, "cashier receives no supplier records");
      assert.equal(cashierPull.purchaseHistory.length, 0, "cashier receives no purchase-cost history");
    });

    test("pull is shop-scoped", async () => {
      const a = await createTenant(ctx.db);
      const b = await createTenant(ctx.db);
      const authA = await login(ctx, a.ownerMobile, a.ownerPassword);
      const deviceA = await activateDeviceViaApi(ctx, authA.accessToken, { deviceId: "sync-a-device" });
      const productA = await createProduct(ctx.db, a.shop.id, { name: "A Sync Product" });
      const productB = await createProduct(ctx.db, b.shop.id, { name: "B Sync Product" });
      const since = encodeURIComponent(new Date(0).toISOString());
      const data = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=100`, { token: authA.accessToken, headers: { "x-device-id": deviceA.deviceId } }));
      assert.ok(data.products.some((p) => p.id === productA.id));
      assert.equal(data.products.some((p) => p.id === productB.id), false);
    });

    test("ownerPin is stripped from stored OfflineSyncEvent requestJson/resultJson", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const response = await ctx.post("/api/sync/push", {
        events: [{
          eventId: "pin-strip-sync-1",
          type: "CREATE_CUSTOMER",
          ownerPin: "1234",
          payload: { customer: { name: "Pin Safe", type: "regular", ownerPin: "1234" }, ownerPin: "1234" },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      assertSuccess(response);
      const stored = await ctx.db.offlineSyncEvent.findFirst({ where: { eventId: "pin-strip-sync-1" } });
      assert.ok(stored);
      assert.doesNotMatch(stored.requestJson || "", /ownerPin|1234/i);
      assert.doesNotMatch(stored.resultJson || "", /ownerPin|1234/i);
    });

    // ── Bill durable-identity on pull ─────────────────────────────────────────
    // The offline double-count bug: a pulled server bill must carry its real
    // clientBillId/idempotencyKey columns so the client can collapse the pending
    // local row into it. These guard that pullSince returns them directly, with
    // no dependence on any recent-events window.

    async function pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey, eventId }) {
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
      const billBody = {
        ...billPayload(product, {
          quantity: 1, ratePerRateUnit: 100,
          customerId: customer.id, customerName: customer.name,
          buyerPaidAmount: 100, payments: [{ mode: "cash", amount: 100 }],
        }),
        localBillId, clientBillId: localBillId, idempotencyKey,
      };
      return ctx.post("/api/sync/push", {
        events: [{ eventId, type: "CREATE_BILL", payload: { localBillId, clientBillId: localBillId, idempotencyKey, bill: billBody } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
    }

    const sinceEpoch = () => encodeURIComponent(new Date(0).toISOString());

    test("pull returns each bill's real clientBillId/idempotencyKey/sourceDeviceId columns", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-bill-pullid-1";
      const idempotencyKey = "create-bill:test:pullid:1";
      assertSuccess(await pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey, eventId: "pull-id-1" }));

      const pull = assertSuccess(await ctx.get(`/api/sync/pull?since=${sinceEpoch()}&limit=200`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const bill = pull.bills.find((b) => b.clientBillId === localBillId);
      assert.ok(bill, "pulled bill carries its real clientBillId column");
      assert.equal(bill.idempotencyKey, idempotencyKey, "pulled bill carries its idempotencyKey column");
      assert.ok(bill.sourceDeviceId, "pulled bill carries its sourceDeviceId column");
    });

    test("clientBillId survives on pull even with no CREATE_BILL sync events left (column-sourced, window-independent)", async () => {
      // Reproduces the >200-events / pruned-events case: the durable identity must
      // come from the bill row itself, never a recent CREATE_BILL event window.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-bill-nowindow-1";
      assertSuccess(await pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey: "create-bill:test:nowindow:1", eventId: "no-window-1" }));

      // Drop every CREATE_BILL audit event — the old enrichment reconstructed
      // identity from these, so with them gone a window-based impl returns nothing.
      await ctx.db.offlineSyncEvent.deleteMany({ where: { shopId: tenant.shop.id, type: "CREATE_BILL" } });

      const pull = assertSuccess(await ctx.get(`/api/sync/pull?since=${sinceEpoch()}&limit=200`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const bill = pull.bills.find((b) => b.clientBillId === localBillId);
      assert.ok(bill, "clientBillId still returned with zero CREATE_BILL events (it comes from the column)");
    });

    test("re-pushing the same bill under a new event id never creates a second bill; pull returns exactly one", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-bill-rebush-1";
      const idempotencyKey = "create-bill:test:repush:1";
      assertSuccess(await pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey, eventId: "repush-1" }));
      // Lost-ack retry: same bill, brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey, eventId: "repush-1-retry" }));

      const count = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, clientBillId: localBillId } });
      assert.equal(count, 1, "the retried push must converge on a single bill");

      const pull = assertSuccess(await ctx.get(`/api/sync/pull?since=${sinceEpoch()}&limit=200`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const matches = pull.bills.filter((b) => b.clientBillId === localBillId);
      assert.equal(matches.length, 1, "pull returns exactly one bill for the client identity");
    });

    test("cashier pull still carries bill clientBillId (durable identity is not cost data)", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-bill-cashier-1";
      assertSuccess(await pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey: "create-bill:test:cashier:1", eventId: "cashier-id-1" }));

      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const staffDevice = await activateDeviceViaApi(ctx, staffAuth.accessToken, { deviceId: "cashier-identity-device" });

      const cashierPull = assertSuccess(await ctx.get(`/api/sync/pull?since=${sinceEpoch()}&limit=200`, { token: staffAuth.accessToken, headers: { "x-device-id": staffDevice.deviceId } }));
      const bill = cashierPull.bills.find((b) => b.clientBillId === localBillId);
      assert.ok(bill, "cashier still receives the bill's clientBillId so it can de-dupe its own pending row");
      assert.equal(bill.grossProfit, undefined, "cashier still must NOT receive profit");
    });

    // ── Edit-after-finalize (void + recreate) and add-on ──────────────────────
    // The frontend never mutates a finalized bill: "Edit" = cancelBill(old) +
    // confirmBill(new) and "Add items" = confirmBill(new add-on), both over the
    // existing CREATE_BILL / CANCEL_BILL outbox events. These prove the SERVER
    // outcome of exactly that event sequence: one active bill, stock/udhar/totals
    // reflecting only the surviving bill(s), and idempotent under lost-ack retries.

    async function pushSale(ownerAuth, deviceHeaders, { product, customer, qty, rate, paid = 0, credit = 0, localBillId, idempotencyKey, eventId }) {
      const billBody = {
        ...billPayload(product, {
          quantity: qty,
          ratePerRateUnit: rate,
          customerId: customer ? customer.id : undefined,
          customerName: customer ? customer.name : "Walk-in",
          buyerPaidAmount: paid,
          payments: paid > 0 ? [{ mode: "cash", amount: paid }] : [],
        }),
        localBillId,
        clientBillId: localBillId,
        idempotencyKey,
        ...(credit > 0 ? { creditAmount: credit } : {}),
      };
      return ctx.post("/api/sync/push", {
        events: [{ eventId, type: "CREATE_BILL", payload: { localBillId, clientBillId: localBillId, idempotencyKey, bill: billBody } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
    }

    async function pushCancel(ownerAuth, deviceHeaders, { clientBillId, eventId, reason = "Edited — replaced by corrected bill" }) {
      return ctx.post("/api/sync/push", {
        events: [{ eventId, type: "CANCEL_BILL", ownerPin: "1234", payload: { billId: clientBillId, localBillId: clientBillId, reason, ownerPin: "1234" } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
    }

    test("edit-after-finalize (cancel old + create new) leaves exactly one active bill in totals, udhar and inventory", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });

      // Original finalized udhar bill A: 2 @ ₹100 = ₹200 on credit.
      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, customer, qty: 2, rate: 100, credit: 200, localBillId: "edit-A", idempotencyKey: "ck:edit:A", eventId: "evt-edit-A" }));
      // The "edit": the corrected bill B is created first, then the original is voided
      // (exactly the order the frontend outbox emits).
      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, customer, qty: 3, rate: 100, credit: 300, localBillId: "edit-B", idempotencyKey: "ck:edit:B", eventId: "evt-edit-B" }));
      assertSuccess(await pushCancel(ownerAuth, deviceHeaders, { clientBillId: "edit-A", eventId: "evt-edit-A-cancel" }));

      const billA = await ctx.db.bill.findFirst({ where: { shopId: tenant.shop.id, clientBillId: "edit-A" } });
      const billB = await ctx.db.bill.findFirst({ where: { shopId: tenant.shop.id, clientBillId: "edit-B" } });
      assert.equal(billA.status, "cancelled", "the original bill is voided");
      assert.equal(billB.status, "active", "the corrected bill stays active");
      assert.notEqual(billA.clientBillId, billB.clientBillId, "the corrected bill has its own client identity");
      const activeCount = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, status: "active" } });
      assert.equal(activeCount, 1, "exactly one active bill survives the edit");

      // Inventory: A's 2 reversed, B's 3 applied → 10 - 3 = 7 (no stale double-deduction).
      const stocked = await ctx.db.product.findFirst({ where: { id: product.id } });
      assert.equal(stocked.stockBaseQty, 7, "stock reflects only the corrected bill");

      // Udhar: only B's ₹300 remains (A's ₹200 reversed on cancel).
      const ageing = assertSuccess(await ctx.get("/api/reports/udhar-ageing", { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(ageing.totalPendingUdharPaise, 30000, "udhar reflects only the corrected bill");
    });

    test("add items after finalize creates an independent add-on bill that sums with the original", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });

      // Original cash bill A (2 @ ₹100 = ₹200) and an add-on C (1 @ ₹100 = ₹100). No void.
      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, qty: 2, rate: 100, paid: 200, localBillId: "addon-A", idempotencyKey: "ck:addon:A", eventId: "evt-addon-A" }));
      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, qty: 1, rate: 100, paid: 100, localBillId: "addon-C", idempotencyKey: "ck:addon:C", eventId: "evt-addon-C" }));

      const activeCount = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, status: "active" } });
      assert.equal(activeCount, 2, "the original and the add-on both stay active");

      const stocked = await ctx.db.product.findFirst({ where: { id: product.id } });
      assert.equal(stocked.stockBaseQty, 7, "both bills deduct stock (10 - 2 - 1)");

      const summary = assertSuccess(await ctx.get("/api/reports/payment-summary", { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(summary.total, 300, "dashboard total sums the original and the add-on");
    });

    test("re-pushing an offline edit (lost-ack retry) makes no duplicate bill and no stale stock", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });

      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, qty: 2, rate: 100, paid: 200, localBillId: "redo-A", idempotencyKey: "ck:redo:A", eventId: "evt-redo-A" }));
      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, qty: 3, rate: 100, paid: 300, localBillId: "redo-B", idempotencyKey: "ck:redo:B", eventId: "evt-redo-B" }));
      assertSuccess(await pushCancel(ownerAuth, deviceHeaders, { clientBillId: "redo-A", eventId: "evt-redo-A-cancel" }));

      // Lost-ack retry: the whole edit replays under brand-new event ids. Re-cancel of an
      // already-cancelled bill and re-create under the same idempotency key are both no-ops.
      await pushSale(ownerAuth, deviceHeaders, { product, qty: 3, rate: 100, paid: 300, localBillId: "redo-B", idempotencyKey: "ck:redo:B", eventId: "evt-redo-B-retry" });
      await pushCancel(ownerAuth, deviceHeaders, { clientBillId: "redo-A", eventId: "evt-redo-A-cancel-retry" });

      const bCount = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, clientBillId: "redo-B" } });
      assert.equal(bCount, 1, "the corrected bill is not duplicated by the retry");
      const activeCount = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, status: "active" } });
      assert.equal(activeCount, 1, "still exactly one active bill after the retry");
      const stocked = await ctx.db.product.findFirst({ where: { id: product.id } });
      assert.equal(stocked.stockBaseQty, 7, "re-cancel doesn't restore stock twice and re-create doesn't deduct twice");
    });
  });
}
