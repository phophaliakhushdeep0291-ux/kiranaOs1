// One mapping for journal posting and accounting controls. Amounts stay in integer minor units.
export const GENERAL_LEDGER_VERSION = "general-ledger-v1";

export const SYSTEM_ACCOUNTS = [
  ["1000", "Cash in hand", "asset", "debit", "cash"],
  ["1010", "UPI clearing", "asset", "debit", "upi"],
  ["1020", "Bank", "asset", "debit", "bank"],
  ["1030", "Other payment clearing", "asset", "debit", "other_clearing"],
  ["1100", "Customer receivables", "asset", "debit", "receivables"],
  ["1110", "Rental receivables", "asset", "debit", "rental_receivables"],
  ["2400", "Rental advances", "liability", "credit", "rental_advances"],
  ["2410", "Refundable rental deposits", "liability", "credit", "rental_deposits"],
  ["2420", "Furniture order advances", "liability", "credit", "furniture_advances"],
  ["4100", "Rental income", "income", "credit", "rental_income"],
  ["1200", "Inventory at recorded purchase cost", "asset", "debit", "inventory"],
  ["1300", "Supplier advances and credits", "asset", "debit", "supplier_credits"],
  ["2000", "Supplier payables", "liability", "credit", "payables"],
  ["2100", "Gift card liability", "liability", "credit", "gift_cards"],
  ["2200", "GST output payable", "liability", "credit", "gst_output"],
  ["2210", "Input GST recoverable", "asset", "debit", "gst_input"],
  ["2300", "Accrued expense payables", "liability", "credit", "expense_payables"],
  ["2900", "Recycle-bin suspense", "liability", "credit", "recycle_bin_suspense"],
  ["3000", "Owner capital", "equity", "credit", "owner_capital"],
  ["3100", "Owner drawings", "equity", "debit", "owner_drawings"],
  ["4000", "Net sales", "income", "credit", "sales"],
  ["5000", "Cost of goods sold", "expense", "debit", "cost_of_goods_sold"],
  ["6000", "Operating expenses", "expense", "debit", "operating_expenses"],
  ["6200", "Inventory losses", "expense", "debit", "inventory_losses"],
  ["6100", "Waivers and rounding", "expense", "debit", "waivers"],
].map(([code, name, category, normalSide, systemKey]) => ({ code, name, category, normalSide, systemKey }));

const ENTRY_MAPPING = {
  rental_cash: ["1000", "debit"], rental_upi: ["1010", "debit"], rental_bank: ["1020", "debit"], rental_other: ["1030", "debit"],
  rental_advance: ["2400", "credit"], rental_deposit: ["2410", "credit"], rental_receivable: ["1110", "debit"], rental_income: ["4100", "credit"],
  furniture_cash: ["1000", "debit"], furniture_upi: ["1010", "debit"], furniture_bank: ["1020", "debit"], furniture_other: ["1030", "debit"],
  furniture_advance: ["2420", "credit"],
  sale: ["4000", "credit"], cash_in: ["1000", "debit"], upi_in: ["1010", "debit"], bank_in: ["1020", "debit"],
  udhar_debit: ["1100", "debit"], udhar_credit: ["1100", "credit"], udhar_return_credit: ["1100", "credit"],
  gift_card_issued: ["2100", "credit"], gift_card_redeemed: ["2100", "debit"], waiver_expense: ["6100", "debit"],
  recycle_bin_offset: ["2900", "credit"], gst_output: ["2200", "credit"], gst_sales_reclassification: ["4000", "debit"],
  inventory_loss: ["6200", "debit"], inventory_write_off: ["1200", "credit"],
  cost_of_goods_sold: ["5000", "debit"], inventory_sale: ["1200", "credit"],
  inventory_purchase: ["1200", "debit"], inventory_purchase_return: ["1200", "credit"], supplier_payable: ["2000", "credit"],
  supplier_payable_reduction: ["2000", "debit"], supplier_credit_receivable: ["1300", "debit"], cash_out: ["1000", "credit"],
  upi_out: ["1010", "credit"], bank_out: ["1020", "credit"], other_out: ["1030", "credit"], cash_refund_in: ["1000", "debit"],
  upi_refund_in: ["1010", "debit"], bank_refund_in: ["1020", "debit"], operating_expense: ["6000", "debit"], expense_payable: ["2300", "credit"],
};

const opposite = (side) => side === "debit" ? "credit" : "debit";
const tenderCode = (mode) => String(mode).toLowerCase() === "upi" ? "1010" : ["bank", "card"].includes(String(mode).toLowerCase()) ? "1020" : "1000";

export function projectLedgerRow(row) {
  const signed = BigInt(row.amountPaise ?? 0);
  if (row.entryType !== "supplier_payment" && !ENTRY_MAPPING[row.entryType]) {
    throw Object.assign(new Error(`Unmapped financial-ledger entry type: ${row.entryType}`), { code: "GENERAL_LEDGER_UNMAPPED_ENTRY" });
  }
  if (signed === 0n) return [];
  const amountPaise = signed < 0n ? -signed : signed;
  if (row.entryType === "supplier_payment") {
    const lines = [["2000", "debit"], [tenderCode(row.paymentMode), "credit"]];
    return lines.map(([accountCode, side]) => ({ accountCode, side: signed < 0n ? opposite(side) : side, amountPaise, financialLedgerId: row.id }));
  }
  const mapping = ENTRY_MAPPING[row.entryType];
  if (!mapping) throw Object.assign(new Error(`Unmapped financial-ledger entry type: ${row.entryType}`), { code: "GENERAL_LEDGER_UNMAPPED_ENTRY" });
  const [accountCode, side] = mapping;
  return [{ accountCode, side: signed < 0n ? opposite(side) : side, amountPaise, financialLedgerId: row.id }];
}

export function buildJournalProjection(rows) {
  const projected = rows.flatMap(projectLedgerRow);
  const debitPaise = projected.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amountPaise, 0n);
  const creditPaise = projected.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amountPaise, 0n);
  if (debitPaise !== creditPaise) throw Object.assign(new Error(`Journal is not balanced: debit ${debitPaise}, credit ${creditPaise}`), { code: "GENERAL_LEDGER_UNBALANCED_JOURNAL" });
  return { lines: projected, debitPaise, creditPaise };
}

