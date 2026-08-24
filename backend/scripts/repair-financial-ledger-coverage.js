import db from "../src/db.js";
import { buildAccountingControl } from "../src/modules/finance/accounting-control.service.js";
import { postBillCreatedLedger, postSaleReturnLedger } from "../src/modules/finance/financial-ledger.service.js";

const apply = process.argv.includes("--apply");

function captureClient() {
  const rows = [];
  return { rows, financialLedger: { create: async ({ data }) => { rows.push(data); return data; } } };
}

function abs(value) {
  return Math.abs(Number(value ?? 0));
}

async function expectedRowsForBill(bill) {
  const capture = captureClient();
  if (String(bill.billType).toLowerCase() === "sales_return") {
    const payment = bill.payments.find((row) => abs(row.amount) > 0);
    const refundMode = bill.refundMode || payment?.mode;
    if (!refundMode) throw Object.assign(new Error("Return has no refund-mode evidence"), { code: "MISSING_REFUND_MODE_EVIDENCE" });
    await postSaleReturnLedger(capture, {
      shopId: bill.shopId,
      bill,
      refundMode,
      refundAmount: abs(bill.grandTotal),
      customerId: bill.customerId,
      businessDate: bill.businessDate ?? bill.createdAt,
    });
  } else {
    await postBillCreatedLedger(capture, {
      shopId: bill.shopId,
      bill,
      tenderPayments: bill.payments,
      creditAmount: Number(bill.creditAmount ?? 0),
      waivedAmount: Number(bill.waivedAmount ?? 0),
      customerId: bill.customerId,
      businessDate: bill.businessDate ?? bill.createdAt,
    });
  }
  return capture.rows;
}

const bills = await db.bill.findMany({ include: { items: true, payments: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const existing = await db.financialLedger.findMany();
const existingKeys = new Set(existing.map((row) => `${row.shopId}:${row.idempotencyKey}`));
const repairs = [];
const quarantined = [];

for (const bill of bills) {
  try {
    const expected = await expectedRowsForBill(bill);
    const missing = expected.filter((row) => !existingKeys.has(`${row.shopId}:${row.idempotencyKey}`));
    if (missing.length === 0) continue;
    repairs.push({ billId: bill.id, billNo: bill.billNo, shopId: bill.shopId, billType: bill.billType, rows: missing });
  } catch (error) {
    quarantined.push({ billId: bill.id, billNo: bill.billNo, shopId: bill.shopId, billType: bill.billType, code: error?.code ?? "UNSAFE_BACKFILL", reason: error?.message ?? String(error) });
    // A known tender mismatch must stay quarantined, but it must not prevent the
    // independent, self-balancing COGS/inventory evidence from being restored.
    if (error?.code === "BILL_ACCOUNTING_EVIDENCE_MISMATCH") {
      const capture = captureClient();
      const accountedTotal = bill.payments.reduce((sum, row) => sum + abs(row.amount), 0) + abs(bill.creditAmount) + abs(bill.waivedAmount);
      await postBillCreatedLedger(capture, { shopId: bill.shopId, bill: { ...bill, grandTotal: accountedTotal }, tenderPayments: bill.payments, creditAmount: Number(bill.creditAmount ?? 0), waivedAmount: Number(bill.waivedAmount ?? 0), customerId: bill.customerId, businessDate: bill.businessDate ?? bill.createdAt });
      const missingCostRows = capture.rows.filter((row) => ["cost_of_goods_sold", "inventory_sale"].includes(row.entryType) && !existingKeys.has(`${row.shopId}:${row.idempotencyKey}`));
      if (missingCostRows.length) repairs.push({ billId: bill.id, billNo: bill.billNo, shopId: bill.shopId, billType: bill.billType, rows: missingCostRows });
    }
  }
}

// Every sale-bearing lifecycle event (create, cancel, restore, delete,
// undelete, return) must move inventory cost with revenue. This catches
// historical reversals independently from tender evidence.
const billById = new Map(bills.map((bill) => [bill.id, bill]));
const plannedKeys = new Set(repairs.flatMap((repair) => repair.rows.map((row) => `${row.shopId}:${row.idempotencyKey}`)));
for (const sale of existing.filter((row) => row.entryType === "sale" && row.billId && /:sale$/.test(row.idempotencyKey))) {
  const bill = billById.get(sale.billId);
  if (String(bill?.billType).toLowerCase() === "estimate") continue;
  const costPaise = BigInt(Math.round(Math.abs((bill?.items ?? []).reduce((sum, item) => sum + Number(item.lineCost ?? 0), 0)) * 100));
  if (costPaise === 0n) continue;
  const signedCost = BigInt(sale.amountPaise) < 0n ? -costPaise : costPaise;
  const base = sale.idempotencyKey.slice(0, -":sale".length);
  const candidates = [
    { entryType: "cost_of_goods_sold", direction: "debit", idempotencyKey: `${base}:cost_of_goods_sold` },
    { entryType: "inventory_sale", direction: "credit", idempotencyKey: `${base}:inventory_sale` },
  ].filter((row) => !existingKeys.has(`${sale.shopId}:${row.idempotencyKey}`) && !plannedKeys.has(`${sale.shopId}:${row.idempotencyKey}`))
    .map((row) => ({ shopId: sale.shopId, customerId: sale.customerId, supplierId: null, billId: sale.billId, paymentId: null, purchaseBillId: null, sourceType: sale.sourceType, sourceId: sale.sourceId, ...row, amountPaise: signedCost, paymentMode: null, businessDate: sale.businessDate, evidenceJson: JSON.stringify({ version: 1, capturedAt: new Date().toISOString(), historicalBackfill: true, sourceType: sale.sourceType, sourceId: sale.sourceId, billId: sale.billId, entryType: row.entryType, direction: row.direction, amountPaise: String(signedCost), paymentMode: null }) }));
  if (candidates.length) {
    repairs.push({ billId: bill.id, billNo: bill.billNo, shopId: bill.shopId, billType: `${bill.billType}:${sale.sourceType}`, rows: candidates });
    for (const row of candidates) plannedKeys.add(`${row.shopId}:${row.idempotencyKey}`);
  }
}

// Estimates are quotations. Older builds posted some as sales; remove their
// net accounting effect with an append-only correction instead of deleting
// history. Cancelled estimates that already net to zero need no correction.
for (const bill of bills.filter((row) => String(row.billType).toLowerCase() === "estimate")) {
  const rows = existing.filter((row) => row.billId === bill.id && row.sourceType !== "legacy_estimate_reversal");
  const grouped = Map.groupBy(rows, (row) => `${row.entryType}\u0000${row.paymentMode ?? ""}`);
  const correctionRows = [];
  for (const group of grouped.values()) {
    const template = group[0];
    const netPaise = group.reduce((sum, row) => sum + BigInt(row.amountPaise), 0n);
    if (netPaise === 0n) continue;
    const idempotencyKey = `legacy-estimate-reversal:${bill.id}:${template.entryType}:${template.paymentMode ?? "none"}`;
    if (existingKeys.has(`${bill.shopId}:${idempotencyKey}`) || plannedKeys.has(`${bill.shopId}:${idempotencyKey}`)) continue;
    const amountPaise = -netPaise;
    correctionRows.push({ shopId: bill.shopId, customerId: bill.customerId, supplierId: null, billId: bill.id, paymentId: null, purchaseBillId: null, sourceType: "legacy_estimate_reversal", sourceId: bill.id, entryType: template.entryType, direction: template.direction, amountPaise, paymentMode: template.paymentMode, businessDate: new Date(), idempotencyKey, evidenceJson: JSON.stringify({ version: 1, capturedAt: new Date().toISOString(), historicalCorrection: true, reason: "Estimate is a quotation, not an accounting event", sourceType: "legacy_estimate_reversal", sourceId: bill.id, billId: bill.id, entryType: template.entryType, direction: template.direction, amountPaise: String(amountPaise), paymentMode: template.paymentMode }) });
  }
  if (correctionRows.length) repairs.push({ billId: bill.id, billNo: bill.billNo, shopId: bill.shopId, billType: "estimate:legacy_reversal", rows: correctionRows });
}

if (apply) {
  for (const repair of repairs) {
    await db.$transaction(async (tx) => {
      for (const row of repair.rows) await tx.financialLedger.create({ data: row });
      const groupRows = await tx.financialLedger.findMany({ where: { shopId: repair.shopId, sourceId: repair.billId } });
      const control = buildAccountingControl(groupRows);
      if (control.status !== "balanced") {
        const error = new Error(`Repair for ${repair.billNo} did not produce a balanced source group`);
        error.code = "BACKFILL_GROUP_NOT_BALANCED";
        throw error;
      }
    });
  }
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  billsScanned: bills.length,
  billsRepaired: apply ? repairs.length : 0,
  repairCandidates: repairs.length,
  rowsAdded: apply ? repairs.reduce((sum, item) => sum + item.rows.length, 0) : 0,
  rowsProposed: repairs.reduce((sum, item) => sum + item.rows.length, 0),
  quarantined,
  repairs: repairs.map((item) => ({ ...item, rows: item.rows.map((row) => ({ idempotencyKey: row.idempotencyKey, entryType: row.entryType, amountPaise: String(row.amountPaise) })) })),
}, null, 2));

await db.$disconnect();
