import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure, TEST_DATABASE_URL } from "./setup.js";
import { createTenant, createStaff, login, createProduct, billPayload } from "./factories.js";
import * as ca from "../../src/modules/ca-portal/ca-portal.service.js";
import { confirmBill, createSaleReturn } from "../../src/modules/bills/bills.service.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("CA portal unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));
  async function account() {
    const tenant = await createTenant(ctx.db);
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { ...tenant, token: auth.accessToken };
  }
  const opts = a => ({ token: a.token });
  async function invite(a) { return assertSuccess(await ctx.post("/api/ca/generate-code", {}, { ...opts(a), ownerPin: a.ownerPin })); }
  async function link(a, code) { return assertSuccess(await ctx.post("/api/ca/link", { linkCode: code, note: "Client books" }, opts(a)), 201); }
  test("explicit revocable owner grants allow client reads; matching email/mobile grants nothing", async () => {
    const owner = await account(), accountant = await account(), stranger = await account();
    await ctx.db.user.updateMany({ where: { id: { in: [owner.owner.id, accountant.owner.id] } }, data: { email: "shared@example.test" } });
    await createStaff(ctx.db, owner.shop.id, { mobile: accountant.ownerMobile, role: "viewer" });
    assertFailure(await ctx.get("/api/ca/overview"), 401);
    assertFailure(await ctx.get(`/api/ca/clients/${owner.shop.id}`, opts(accountant)), 403);
    assertFailure(await ctx.get(`/api/ca/clients/${owner.shop.id}/tally`, opts(accountant)), 403);
    const before = assertSuccess(await ctx.get("/api/ca/overview", opts(accountant)));
    assert.deepEqual(before.clients.map(c => c.id), [accountant.shop.id]);
    assert.equal(before.clients[0].audit.status, "not_reviewed");
    const missingPin = await ctx.post("/api/ca/generate-code", {}, opts(owner));
    assert.ok([400, 403].includes(missingPin.status), JSON.stringify(missingPin));
    const code = await invite(owner);
    const row = await ctx.db.accountantAccess.findUniqueOrThrow({ where: { id: code.id } });
    assert.equal(row.tokenHash, crypto.createHash("sha256").update(code.code).digest("hex"));
    assert.equal(JSON.stringify(row).includes(code.code), false);
    assert.equal(JSON.stringify(await ctx.db.shop.findUnique({ where: { id: owner.shop.id } })).includes(code.code), false);
    const users = await ctx.db.user.count();
    assert.equal((await link(accountant, code.code)).alreadyLinked, false);
    assert.equal((await link(accountant, code.code)).alreadyLinked, true);
    assert.equal(await ctx.db.user.count(), users, "No cloned client login/password");
    assertFailure(await ctx.post("/api/ca/link", { linkCode: code.code }, opts(stranger)), 404);
    const details = assertSuccess(await ctx.get(`/api/ca/clients/${owner.shop.id}`, opts(accountant)));
    assert.equal(details.shop.id, owner.shop.id);
    assert.equal(details.audit.status, "not_reviewed");
    const xml = await ctx.get(`/api/ca/clients/${owner.shop.id}/tally?format=xml&inventory=false`, opts(accountant));
    assert.equal(xml.status, 200, xml.text);
    assert.match(xml.text, /<ENVELOPE>/);
    const access = assertSuccess(await ctx.get("/api/ca/access", opts(owner)));
    assert.equal(access[0].accountantUserId, accountant.owner.id);
    assert.equal("tokenHash" in access[0], false);
    assertFailure(await ctx.delete(`/api/ca/access/${code.id}`, { ...opts(stranger), ownerPin: stranger.ownerPin }), 404);
    assertSuccess(await ctx.delete(`/api/ca/access/${code.id}`, { ...opts(owner), ownerPin: owner.ownerPin }));
    assertSuccess(await ctx.delete(`/api/ca/access/${code.id}`, { ...opts(owner), ownerPin: owner.ownerPin }));
    assertFailure(await ctx.get(`/api/ca/clients/${owner.shop.id}`, opts(accountant)), 403);
    assertFailure(await ctx.get(`/api/ca/clients/${owner.shop.id}/tally`, opts(accountant)), 403);
    assertFailure(await ctx.post("/api/ca/link", { linkCode: code.code }, opts(accountant)), 404);
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: code.id, action: { in: ["CA_INVITE_CREATED", "CA_CLIENT_LINKED", "CA_ACCESS_REVOKED"] } } }), 3);
  });
  test("staff, expired invites and invalid periods are refused", async () => {
    const a = await account(), b = await account();
    const staff = await createStaff(ctx.db, a.shop.id);
    const auth = await login(ctx, staff.staffMobile, staff.staffPassword);
    assertFailure(await ctx.get("/api/ca/overview", { token: auth.accessToken }), 403);
    assertFailure(await ctx.post("/api/ca/generate-code", {}, { token: auth.accessToken, ownerPin: a.ownerPin }), 403);
    const code = await invite(a);
    await ctx.db.accountantAccess.update({ where: { id: code.id }, data: { inviteExpiresAt: new Date(0) } });
    assertFailure(await ctx.post("/api/ca/link", { linkCode: code.code }, opts(b)), 404);
    for (const q of ["from=2026-02-30", "from=2026-02-02&to=2026-02-01", "from=2024-01-01&to=2026-01-01", "month=2026-01&to=2026-01-31"]) assertFailure(await ctx.get(`/api/ca/overview?${q}`, opts(a)), 400);
  });
  test("required audit failures roll back creation, acceptance and revocation", async () => {
    const a = await account(), b = await account();
    const code = await invite(a);
    const fail = async action => {
      await ctx.db.$executeRawUnsafe(`CREATE TRIGGER ca_fail_audit BEFORE INSERT ON AuditLog BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
      try { await assert.rejects(action); } finally { await ctx.db.$executeRawUnsafe("DROP TRIGGER ca_fail_audit"); }
    };
    await fail(() => ca.generateShopCaInviteCode(a.shop.id, a.owner.id));
    assert.equal(await ctx.db.accountantAccess.count(), 1);
    await fail(() => ca.linkClientShop(b.owner.id, code.code));
    assert.equal((await ctx.db.accountantAccess.findUnique({ where: { id: code.id } })).acceptedAt, null);
    await link(b, code.code);
    await fail(() => ca.revokeShopAccess(a.shop.id, a.owner.id, code.id));
    assert.equal((await ctx.db.accountantAccess.findUnique({ where: { id: code.id } })).revokedAt, null);
  });
  test("real signed sales/returns agree with API totals; failed payments do not inflate tender", async () => {
    const a = await account();
    const product = await createProduct(ctx.db, a.shop.id, { defaultPricePerRateUnit: 105, gstRate: 5 });
    const actor = { userId: a.owner.id, ownerPinVerified: true };
    const input = billPayload(product, { gstRate: 5 });
    const sale = await confirmBill(a.shop.id, input, actor);
    const refund = await createSaleReturn(a.shop.id, { returnOfBillId: sale.id, refundMode: "cash", reason: "Return", items: [{ ...input.items[0], quantity: 1, originalBillItemId: sale.items[0].id }] }, actor);
    await ctx.db.payment.create({ data: { billId: sale.id, shopId: a.shop.id, mode: "card", amount: 999, amountPaise: 99900n, status: "failed" } });
    const result = assertSuccess(await ctx.get(`/api/ca/clients/${a.shop.id}`, opts(a)));
    assert.equal(result.overview.totalSales, sale.grandTotal + refund.grandTotal);
    assert.equal(result.overview.totalTax, sale.gst + refund.gst);
    assert.equal(result.overview.tenderSummary.cash, 105);
    assert.equal(result.overview.tenderSummary.card, 0);
    assert.equal(result.overview.tenderSummary.unallocated, 0);
    assert.equal(result.audit.status, "not_reviewed");
    await ctx.db.dailyClosingSnapshot.create({ data: { shopId: a.shop.id, date: new Date(), expectedCashPaise: 10500, countedCashPaise: 10000, cashVariancePaise: -500 } });
    const difference = assertSuccess(await ctx.get(`/api/ca/clients/${a.shop.id}`, opts(a)));
    assert.equal(difference.audit.status, "attention_needed");
    assert.equal(difference.recentClosings[0].difference, -5);
  });
  test("currencies remain separate, timezone boundaries apply and mixed source currency fails closed", async () => {
    const a = await account(), b = await account();
    await ctx.db.shop.update({ where: { id: b.shop.id }, data: { currencyCode: "AED", countryCode: "AE", taxRegime: "VAT", accountingTimeZone: "Asia/Dubai" } });
    await link(a, (await invite(b)).code);
    const data = { billNo: "boundary", businessDate: new Date("2026-10-01T20:30:00Z"), grandTotal: 1.01, grandTotalPaise: 101n };
    await ctx.db.bill.create({ data: { ...data, shopId: b.shop.id, currencyCode: "AED", countryCode: "AE", taxRegime: "VAT", accountingTimeZone: "Asia/Dubai" } });
    const dayOne = await ca.getCaOverview(a.owner.id, { from: "2026-10-01", to: "2026-10-01" });
    assert.equal(dayOne.clients.find(c => c.id === b.shop.id).financials.billCount, 0);
    const nextDay = await ca.getCaOverview(a.owner.id, { from: "2026-10-02", to: "2026-10-02" });
    assert.equal(nextDay.clients.find(c => c.id === b.shop.id).financials.mtdTurnoverPaise, 101);
    assert.equal(nextDay.aggregates.totalsByCurrency.length, 2);
    assert.equal(nextDay.aggregates.totalsByCurrency.find(c => c.currencyCode === "AED").combinedMtdTurnoverPaise, 101);
    assert.equal(nextDay.aggregates.totalsByCurrency.find(c => c.currencyCode === "INR").combinedMtdTurnoverPaise, 0);
    assertFailure(await ctx.get(`/api/ca/clients/${b.shop.id}`, opts(a)), 409);
    await ctx.db.bill.create({ data: { ...data, shopId: b.shop.id, billNo: "wrong-market", currencyCode: "INR" } });
    await assert.rejects(() => ca.getCaOverview(a.owner.id, { month: "2026-10" }), { code: "CA_CURRENCY_MISMATCH" });
  });
  test("waivers, estimates and legacy credit are counted once; inactive bills are excluded", async () => {
    const a = await account();
    await ctx.db.bill.create({ data: { shopId: a.shop.id, billNo: "estimate", billType: "estimate", grandTotal: 10, grandTotalPaise: 1000n, gst: 5, gstPaise: 500n, waivedAmount: 2, waivedAmountPaise: 200n,
      payments: { create: { shopId: a.shop.id, mode: "cash", amount: 8, amountPaise: 800n } } } });
    await ctx.db.bill.create({ data: { shopId: a.shop.id, billNo: "legacy-credit", grandTotal: 60, creditAmount: 60,
      payments: { create: { shopId: a.shop.id, mode: "credit", amount: 60 } } } });
    await ctx.db.bill.createMany({ data: [
      { shopId: a.shop.id, billNo: "deleted", grandTotal: 90, deletedAt: new Date() },
      { shopId: a.shop.id, billNo: "cancelled", grandTotal: 80, status: "cancelled" },
    ] });
    const data = assertSuccess(await ctx.get(`/api/ca/clients/${a.shop.id}`, opts(a)));
    assert.equal(data.overview.totalSales, 70);
    assert.equal(data.overview.totalTax, 0);
    assert.equal(data.overview.waivedAmount, 2);
    assert.equal(data.overview.tenderSummary.udhar, 60);
    assert.equal(data.overview.tenderSummary.total, 68);
    assert.equal(data.overview.tenderSummary.unallocated, 0);
    assert.equal(data.financials.billCount, 2);
    await ctx.db.bill.updateMany({ where: { shopId: a.shop.id, billNo: "legacy-credit" }, data: { grandTotalPaise: 9007199254740992n } });
    await assert.rejects(() => ca.getCaOverview(a.owner.id), { code: "CA_MONEY_OVERFLOW" });
  });
  test("target subscription cannot be bypassed using the accountant's plan", async () => {
    const a = await account(), b = await account();
    await link(a, (await invite(b)).code);
    await ctx.db.subscription.update({ where: { shopId: b.shop.id }, data: { status: "expired", currentPeriodEnd: new Date(0), graceEndsAt: new Date(0), trialEndsAt: null } });
    for (const suffix of ["", "/tally"]) {
      const response = await ctx.get(`/api/ca/clients/${b.shop.id}${suffix}`, opts(a));
      assertFailure(response, 402);
      assert.equal(response.body.code, "SUBSCRIPTION_INACTIVE");
    }
  });
  test("concurrent accountants cannot both claim one PostgreSQL invite", { skip: !/^postgres/.test(TEST_DATABASE_URL) }, async () => {
    const a = await account(), b = await account(), c = await account();
    const code = await invite(a);
    const results = await Promise.allSettled([ca.linkClientShop(b.owner.id, code.code), ca.linkClientShop(c.owner.id, code.code)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected" && r.reason.code === "INVALID_CA_LINK_CODE").length, 1);
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: code.id, action: "CA_CLIENT_LINKED" } }), 1);
  });
}
