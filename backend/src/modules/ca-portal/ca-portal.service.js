import crypto from "node:crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { formatDateInTimeZone, dateRangeForDateOnly } from "../../utils/dates.js";
import { toPaiseBigInt } from "../../utils/money.js";
import { serializableTransaction } from "../../lib/transactions.js";
import { buildTallyExport } from "../integrations/integrations.service.js";
import { getGstr1WorkingPapers, getGstr3bWorkingPapers } from "../compliance/compliance.service.js";
import { getUdharSummary } from "../udhar/udhar.service.js";
import { requireFeatureAccess } from "../feature-gates/featureGate.service.js";

const OPEN_FINDINGS = ["OPEN", "EVIDENCE_REQUESTED", "UNDER_REVIEW", "CONFIRMED_ISSUE"];
const hashCode = code => crypto.createHash("sha256").update(code).digest("hex");
const deny = () => new AppError("Access denied to this shop", 403, "SHOP_ACCESS_DENIED");
async function actor(userId, client = db) {
  const user = await client.user.findFirst({ where: { id: userId, disabledAt: null, role: "owner" } });
  if (!user) throw deny();
  return user;
}
async function authorizedShop(shopId, userId) {
  const user = await actor(userId);
  if (user.shopId !== shopId) {
    const access = await db.accountantAccess.findFirst({ where: { shopId, accountantUserId: userId, acceptedAt: { not: null }, revokedAt: null } });
    if (!access) throw deny();
  }
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw deny();
  return shop;
}
// Never infer cross-shop identity from an unverified/reused email or phone.
async function portfolio(userId) {
  const user = await actor(userId);
  const grants = await db.accountantAccess.findMany({
    where: { accountantUserId: userId, acceptedAt: { not: null }, revokedAt: null },
    select: { shopId: true }, take: 101,
  });
  if (grants.length > 100) throw new AppError("Open one client at a time for portfolios over 100 grants", 422, "CA_PORTFOLIO_LIMIT");
  const shops = await db.shop.findMany({ where: { id: { in: [...new Set([user.shopId, ...grants.map(g => g.shopId)])] } }, orderBy: { name: "asc" } });
  return { user, shops };
}
function periodFor(shop, query) {
  const zone = shop.accountingTimeZone;
  const today = formatDateInTimeZone(new Date(), zone);
  if (query.month && (query.from || query.to)) throw new AppError("Use either month or from/to dates", 400, "INVALID_CA_PERIOD");
  const monthEnd = query.month ? new Date(Date.UTC(Number(query.month.slice(0, 4)), Number(query.month.slice(5)), 0)).toISOString().slice(0, 10) : null;
  const to = query.to || monthEnd || today;
  const from = query.from || `${query.month || to.slice(0, 7)}-01`;
  const start = dateRangeForDateOnly(from, zone).start;
  const end = dateRangeForDateOnly(to, zone).end;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (days < 0 || days > 365) throw new AppError("Choose an ordered range of up to 366 days", 400, "INVALID_CA_PERIOD");
  return { from, to, start, end };
}
const minor = (row, field) => row[`${field}Paise`] == null ? toPaiseBigInt(row[field] ?? 0) : BigInt(row[`${field}Paise`]);
function safeNumber(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new AppError("Accounting total exceeds the exact display range", 422, "CA_MONEY_OVERFLOW");
  return Number(value);
}
function sum(rows, field) { return rows.reduce((total, row) => total + minor(row, field), 0n); }
function money(value) { return safeNumber(value) / 100; }
function shopIdentity(shop) {
  return { id: shop.id, name: shop.name, ownerName: shop.ownerName, city: shop.city, address: shop.address, phone: shop.phone, gstNumber: shop.gstNumber, currencyCode: shop.currencyCode, taxRegime: shop.taxRegime };
}
async function books(shop, query) {
  const period = periodFor(shop, query);
  const [bills, udhar, openFindingsCount, recentClosings] = await Promise.all([
    db.bill.findMany({
      where: { shopId: shop.id, status: "active", deletedAt: null, businessDate: { gte: period.start, lte: period.end } },
      select: { id: true, billType: true, buyerGstin: true, buyerTaxRegistrationNumber: true, currencyCode: true, grandTotal: true, grandTotalPaise: true, gst: true, gstPaise: true, creditAmount: true, creditAmountPaise: true, waivedAmount: true, waivedAmountPaise: true,
        payments: { where: { status: "confirmed" }, select: { mode: true, amount: true, amountPaise: true } } },
      take: 20001,
    }),
    getUdharSummary(shop.id),
    db.auditFinding.count({ where: { shopId: shop.id, status: { in: OPEN_FINDINGS } } }),
    db.dailyClosingSnapshot.findMany({ where: { shopId: shop.id, date: { gte: period.start, lte: period.end } }, orderBy: { date: "desc" }, take: 7 }),
  ]);
  if (bills.length > 20000) throw new AppError("Choose a shorter period (maximum 20,000 bills)", 422, "CA_REPORT_LIMIT");
  if (bills.some(b => b.currencyCode !== shop.currencyCode)) throw new AppError("Resolve mixed-currency source records before combining totals", 422, "CA_CURRENCY_MISMATCH");
  const total = sum(bills, "grandTotal");
  const taxBills = bills.filter(b => b.billType !== "estimate");
  const tax = sum(taxBills, "gst");
  const waived = sum(bills, "waivedAmount");
  const tender = { cash: 0n, upi: 0n, card: 0n, udhar: sum(bills, "creditAmount"), bank: 0n, gift_card: 0n, other: 0n };
  for (const bill of bills) for (const payment of bill.payments) {
    if (payment.mode === "credit") continue; // Legacy credit payments duplicate billed credit.
    const key = ["cash", "upi", "card", "bank", "gift_card"].includes(payment.mode) ? payment.mode : "other";
    tender[key] += minor(payment, "amount");
  }
  const tenderTotal = Object.values(tender).reduce((a, b) => a + b, 0n);
  const latest = recentClosings[0];
  const hasClosingDiscrepancy = recentClosings.some(c => c.cashVariancePaise != null && c.cashVariancePaise !== 0);
  const needsAttention = openFindingsCount > 0 || hasClosingDiscrepancy || udhar.customers.some(c => c.udharBalanceNeedsRepair) || total !== tenderTotal + waived;
  return {
    period: { from: period.from, to: period.to },
    financials: { periodFrom: period.from, periodTo: period.to, mtdTurnover: money(total), mtdTurnoverPaise: safeNumber(total), mtdOutputTax: money(tax), mtdOutputTaxPaise: safeNumber(tax), totalUdhar: udhar.totalOutstanding, totalUdharPaise: safeNumber(toPaiseBigInt(udhar.totalOutstanding)), billCount: bills.length,
      b2bCount: taxBills.filter(b => b.buyerGstin || b.buyerTaxRegistrationNumber).length,
      b2cCount: taxBills.filter(b => !b.buyerGstin && !b.buyerTaxRegistrationNumber).length },
    overview: { billCount: bills.length, totalSales: money(total), totalTax: money(tax), waivedAmount: money(waived),
      tenderSummary: { ...Object.fromEntries(Object.entries(tender).map(([k,v]) => [k, money(v)])), total: money(tenderTotal), unallocated: money(total - tenderTotal - waived) } },
    audit: { openFindingsCount, hasClosingDiscrepancy, latestClosingDifference: latest?.cashVariancePaise == null ? null : latest.cashVariancePaise / 100, status: needsAttention ? "attention_needed" : "not_reviewed" },
    recentClosings: recentClosings.map(c => ({ date: c.date, locationId: c.storeId, counted: c.countedCashPaise == null ? null : c.countedCashPaise / 100, expected: (c.drawerExpectedCashPaise ?? c.expectedCashPaise) / 100, difference: c.cashVariancePaise == null ? null : c.cashVariancePaise / 100 })),
  };
}
export async function getCaOverview(userId, query = {}) {
  const { user, shops } = await portfolio(userId);
  const clients = [];
  // Bound database pressure; do not fan out an entire portfolio in parallel.
  for (const shop of shops) {
    const data = await books(shop, query);
    clients.push({ ...shopIdentity(shop), userRole: shop.id === user.shopId ? "owner" : "accountant", financials: data.financials, audit: data.audit });
  }
  const totalsByCurrency = [];
  for (const currencyCode of new Set(clients.map(c => c.currencyCode))) {
    const rows = clients.filter(c => c.currencyCode === currencyCode).map(c => c.financials);
    const turnover = rows.reduce((n,r) => n + BigInt(r.mtdTurnoverPaise), 0n);
    const tax = rows.reduce((n,r) => n + BigInt(r.mtdOutputTaxPaise), 0n);
    const debt = rows.reduce((n,r) => n + BigInt(r.totalUdharPaise), 0n);
    totalsByCurrency.push({ currencyCode, combinedMtdTurnover: money(turnover), combinedMtdTurnoverPaise: safeNumber(turnover), combinedOutputTax: money(tax), combinedOutputTaxPaise: safeNumber(tax), combinedUdharBook: money(debt), combinedUdharBookPaise: safeNumber(debt) });
  }
  return { accountant: { userId: user.id, name: user.name, mobile: user.mobile, email: user.email },
    aggregates: { totalClientShops: clients.length, attentionShopsCount: clients.filter(c => c.audit.status === "attention_needed").length, totalOpenAuditFindings: clients.reduce((n,c) => n + c.audit.openFindingsCount, 0), totalsByCurrency },
    clients: query.status && query.status !== "all" ? clients.filter(c => c.audit.status === query.status) : clients };
}
export async function getClientShopDetails(shopId, userId, query = {}) {
  const shop = await authorizedShop(shopId, userId);
  await requireFeatureAccess(shop.id, "gst_reports");
  if (shop.countryCode !== "IN" || shop.currencyCode !== "INR" || shop.taxRegime !== "GST") throw new AppError("GST working papers are only available for Indian GST books", 409, "CA_GST_MARKET_UNSUPPORTED");
  const data = await books(shop, query);
  // Do not turn a registration-scope or data-integrity error into an empty report.
  const [gstr1, gstr3b, auditFindings] = await Promise.all([
    getGstr1WorkingPapers(shop.id, data.period), getGstr3bWorkingPapers(shop.id, data.period),
    db.auditFinding.findMany({ where: { shopId, status: { in: OPEN_FINDINGS } }, select: { id: true, title: true, riskLevel: true, primaryCategory: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return { shop: shopIdentity(shop), ...data, gstr1, gstr3b, auditFindings };
}
export async function getClientTallyExport(shopId, userId, query = {}) {
  const shop = await authorizedShop(shopId, userId);
  await requireFeatureAccess(shop.id, "tally_export");
  const { from, to } = periodFor(shop, query);
  return buildTallyExport(shopId, { from, to, include: ["sales", "purchases", "returns", "receipts", "expenses"], inventory: query.inventory === true });
}
async function audit(tx, shopId, userId, action, id) {
  // Required history is in the same transaction as every grant mutation.
  await tx.auditLog.create({ data: { shopId, userId, action, module: "auth", entityType: "AccountantAccess", entityId: id, metadataJson: JSON.stringify({ actorUserId: userId }), result: "success" } });
}
export async function generateShopCaInviteCode(shopId, userId, expiresInHours = 72) {
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 72) throw new AppError("Invite expiry must be 1–72 hours", 400);
  const code = `CA-${crypto.randomBytes(24).toString("hex").toUpperCase()}`;
  const expiresAt = new Date(Date.now() + expiresInHours * 3600000);
  const grant = await serializableTransaction(async tx => {
    const owner = await actor(userId, tx);
    if (owner.shopId !== shopId) throw deny();
    const row = await tx.accountantAccess.create({ data: { shopId, tokenHash: hashCode(code), inviteExpiresAt: expiresAt, createdByUserId: userId } });
    await audit(tx, shopId, userId, "CA_INVITE_CREATED", row.id);
    return row;
  });
  return { id: grant.id, code, expiresAt: expiresAt.toISOString() };
}
export async function linkClientShop(userId, linkCode, note = "") {
  const code = String(linkCode).trim().toUpperCase();
  if (!/^CA-[A-F0-9]{48}$/.test(code) || note.length > 200) throw new AppError("Invalid CA invite", 400);
  return serializableTransaction(async tx => {
    await actor(userId, tx);
    const row = await tx.accountantAccess.findUnique({ where: { tokenHash: hashCode(code) } });
    if (!row || row.revokedAt || (row.accountantUserId && row.accountantUserId !== userId) || (!row.acceptedAt && row.inviteExpiresAt <= new Date())) throw new AppError("Invalid or expired CA invite", 404, "INVALID_CA_LINK_CODE");
    const alreadyLinked = Boolean(row.acceptedAt);
    if (!alreadyLinked) {
      await tx.accountantAccess.update({ where: { id: row.id }, data: { accountantUserId: userId, acceptedAt: new Date(), note } });
      await audit(tx, row.shopId, userId, "CA_CLIENT_LINKED", row.id);
    }
    const shop = await tx.shop.findUnique({ where: { id: row.shopId }, select: { id: true, name: true, city: true, gstNumber: true } });
    return { success: true, alreadyLinked, shop };
  });
}
export async function listShopAccess(shopId, userId) {
  const user = await actor(userId);
  if (user.shopId !== shopId) throw deny();
  return db.accountantAccess.findMany({ where: { shopId }, select: { id: true, accountantUserId: true, inviteExpiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true, note: true }, orderBy: { createdAt: "desc" }, take: 100 });
}
export async function revokeShopAccess(shopId, userId, id) {
  return serializableTransaction(async tx => {
    const user = await actor(userId, tx);
    if (user.shopId !== shopId) throw deny();
    const row = await tx.accountantAccess.findFirst({ where: { id, shopId } });
    if (!row) throw new AppError("Access record not found", 404);
    if (!row.revokedAt) {
      await tx.accountantAccess.update({ where: { id }, data: { revokedAt: new Date() } });
      await audit(tx, shopId, userId, "CA_ACCESS_REVOKED", id);
    }
    return { id, revoked: true };
  });
}
