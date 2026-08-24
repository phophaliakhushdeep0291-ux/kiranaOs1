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
const existing = await db.financialLedger.findMany({ select: { shopId: true, idempotencyKey: true } });
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
  }
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
