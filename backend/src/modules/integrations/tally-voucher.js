import crypto from "node:crypto";
import { formatDateInTimeZone } from "../../utils/dates.js";
import { addMoney, round2, subtractMoney, toPaise } from "../../utils/money.js";
import { baseQtyToRateQty } from "../../utils/units.js";

// ─────────────────────────────────────────────────────────────
// TALLY VOUCHER XML
//
// This builds a complete set of books for TallyPrime — sales, credit notes,
// purchases, debit notes, receipts and payments — from the documents the POS
// already records. Three rules govern every voucher here:
//
//   1. Every ledger a voucher references must exist, so masters are emitted
//      ahead of the vouchers in the same envelope. A voucher naming an unknown
//      ledger does not import "mostly" — Tally rejects that one voucher and
//      carries on, so the failure is quiet and the books end up short.
//
//   2. Ledger entries must sum to zero. Every builder therefore takes one side
//      as a *residual* rather than recomputing it, which makes an unbalanced
//      voucher structurally impossible no matter what discounts, round-off or
//      part-payments did to the source document.
//
//   3. Money that cannot be classified goes somewhere visible. An unrecognised
//      tender mode lands in Suspense, never silently in Cash, because a wrong
//      cash book is far harder to spot than an obviously unallocated balance.
//
// This module has no database or environment imports so the voucher shape can
// be tested directly on plain objects.
// ─────────────────────────────────────────────────────────────

const LEDGER_SALES = "Sales";
const LEDGER_PURCHASE = "Purchase";
const LEDGER_DISCOUNT = "Discount Allowed";
// Every Tally company ships with a "Cash" ledger already under Cash-in-Hand, so
// emitting a master for it is a duplicate-master error rather than a courtesy.
const LEDGER_CASH = "Cash";

const TAX_LEDGERS = Object.freeze({
  cgst: { name: "Output CGST", dutyHead: "Central Tax" },
  sgst: { name: "Output SGST", dutyHead: "State Tax" },
  igst: { name: "Output IGST", dutyHead: "Integrated Tax" },
});

// Tax paid to a supplier is a receivable from the government, not a liability to
// it, so it cannot share a ledger with tax collected on sales — netting the two
// into one balance is what makes a return impossible to reconcile.
const INPUT_TAX_LEDGERS = Object.freeze({
  cgst: { name: "Input CGST", dutyHead: "Central Tax" },
  sgst: { name: "Input SGST", dutyHead: "State Tax" },
  igst: { name: "Input IGST", dutyHead: "Integrated Tax" },
});

// The POS records tender as cash | upi | bank. Anything else is a mode added
// after this map was written, and it must not be quietly folded into cash.
const TENDER_LEDGERS = Object.freeze({
  cash: { name: LEDGER_CASH, parent: null },
  upi: { name: "UPI Collections", parent: "Bank Accounts" },
  bank: { name: "Bank", parent: "Bank Accounts" },
  card: { name: "Card Settlement", parent: "Bank Accounts" },
});
const LEDGER_SUSPENSE = "Unclassified Tender";

export function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function tallyDate(date, timeZone) {
  return formatDateInTimeZone(date, timeZone).replaceAll("-", "");
}

function isZero(value) {
  return toPaise(round2(value)) === 0;
}

function tenderLedger(mode) {
  const known = TENDER_LEDGERS[String(mode || "").trim().toLowerCase()];
  if (known) return { name: known.name, master: known.parent ? { kind: "ledger", name: known.name, parent: known.parent } : null };
  return { name: LEDGER_SUSPENSE, master: { kind: "ledger", name: LEDGER_SUSPENSE, parent: "Suspense A/c" } };
}

/* ── Masters ──────────────────────────────────────────────────────────────── */

function partyMaster(name, gstin) {
  return { kind: "ledger", name, parent: "Sundry Debtors", gstin: gstin || null };
}

function supplierMaster(name, gstin = null) {
  return { kind: "ledger", name, parent: "Sundry Creditors", gstin: gstin || null };
}

function renderLedgerMaster(master) {
  const registration = master.parent === "Sundry Debtors" || master.parent === "Sundry Creditors"
    ? master.gstin
      ? `<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><PARTYGSTIN>${xmlEscape(master.gstin)}</PARTYGSTIN>`
      : "<GSTREGISTRATIONTYPE>Unregistered</GSTREGISTRATIONTYPE>"
    : "";
  const extra = master.extra || "";
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${xmlEscape(master.name)}" ACTION="Create"><NAME>${xmlEscape(master.name)}</NAME><PARENT>${xmlEscape(master.parent)}</PARENT>${extra}${registration}</LEDGER></TALLYMESSAGE>`;
}

function renderUnitMaster(master) {
  // Weight and volume sales are routinely fractional (250 g of anything), and a
  // unit created with Tally's default 0 decimal places silently rounds them.
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><UNIT NAME="${xmlEscape(master.name)}" ACTION="Create"><NAME>${xmlEscape(master.name)}</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES>3</DECIMALPLACES></UNIT></TALLYMESSAGE>`;
}

function renderStockItemMaster(master) {
  const hsnPart = master.hsn ? `<HSNCODE>${xmlEscape(master.hsn)}</HSNCODE>` : "";
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKITEM NAME="${xmlEscape(master.name)}" ACTION="Create"><NAME>${xmlEscape(master.name)}</NAME><BASEUNITS>${xmlEscape(master.unit || "piece")}</BASEUNITS>${hsnPart}</STOCKITEM></TALLYMESSAGE>`;
}

/* ── Voucher primitives ───────────────────────────────────────────────────── */

/**
 * Tally encodes a debit as a negative AMOUNT and a credit as a positive one,
 * and ISDEEMEDPOSITIVE has to agree with that sign. Disagree and the voucher
 * still imports — posted the wrong way round — so callers pass one
 * credit-positive number and this keeps the two representations in step.
 */
function ledgerEntry(name, creditAmount) {
  const value = round2(creditAmount);
  if (isZero(value)) return "";
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEscape(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${value < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${value.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
}

/**
 * A voucher's identity in the system that produced it.
 *
 * Tally uses REMOTEID to recognise an object that came from outside, so the
 * same document imported twice is the same voucher rather than a second one.
 * It is derived, never random: re-exporting last month must produce the exact
 * same identifiers, or "send again" quietly doubles the month's turnover.
 * The shop id is in the hash so two shops importing into one Tally company
 * cannot collide.
 */
export function remoteVoucherId(shopId, documentType, documentId) {
  const digest = crypto.createHash("sha256").update(`kiranaos:tally:${shopId}:${documentType}:${documentId}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

/**
 * PARTYLEDGERNAME must name a ledger the voucher actually posts to, or Tally
 * rejects it. PARTYNAME is only a label — which is what lets a cash sale record
 * *who* bought without inventing a debtor ledger for someone who owes nothing.
 */
function voucherXml({ type, view = "Accounting Voucher View", date, number, reference, party, partyName, gstin, placeOfSupply, narration, body, remoteId }) {
  return (
    `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER${remoteId ? ` REMOTEID="${xmlEscape(remoteId)}"` : ""} VCHTYPE="${type}" ACTION="Create" OBJVIEW="${view}">` +
    `<DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE>` +
    `<VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${xmlEscape(number)}</VOUCHERNUMBER>` +
    (reference ? `<REFERENCE>${xmlEscape(reference)}</REFERENCE>` : "") +
    (party ? `<PARTYLEDGERNAME>${xmlEscape(party)}</PARTYLEDGERNAME><PARTYNAME>${xmlEscape(partyName || party)}</PARTYNAME>` : "") +
    (gstin ? `<PARTYGSTIN>${xmlEscape(gstin)}</PARTYGSTIN>` : "") +
    (placeOfSupply ? `<PLACEOFSUPPLY>${xmlEscape(placeOfSupply)}</PLACEOFSUPPLY>` : "") +
    `<PERSISTEDVIEW>${view}</PERSISTEDVIEW>` +
    `<NARRATION>${xmlEscape(narration)}</NARRATION>` +
    body +
    `</VOUCHER></TALLYMESSAGE>`
  );
}

/* ── GST ──────────────────────────────────────────────────────────────────── */

/**
 * Split a bill's tax into central/state or integrated tax.
 *
 * This mirrors getGstReport in reports.service.js exactly — same interstate
 * test, same halving, same "remainder lands on SGST" — because a shop whose
 * Tally books disagree with the GST screen it filed from has no way to tell
 * which of the two is lying. If one changes, change the other.
 *
 * The bill's own stamped sellerStateCode wins over the shop's current GSTIN:
 * a shop that registered (or re-registered) mid-year must not have its older
 * vouchers retroactively reclassified.
 */
export function splitGst(bill, fallbackSellerStateCode = "") {
  const gst = round2(Number(bill.gst) || 0);
  if (isZero(gst)) return { cgst: 0, sgst: 0, igst: 0, interState: false };

  const sellerStateCode = String(bill.sellerStateCode || fallbackSellerStateCode || "");
  const buyerStateCode = String(bill.buyerStateCode || "");
  const interState = Boolean(sellerStateCode && /^\d{2}$/.test(buyerStateCode) && buyerStateCode !== sellerStateCode);

  if (interState) return { cgst: 0, sgst: 0, igst: gst, interState: true };
  const central = round2(gst / 2);
  return { cgst: central, sgst: subtractMoney(gst, central), igst: 0, interState: false };
}

/**
 * Split a purchase's input tax into central/state or integrated.
 *
 * The mirror of splitGst, with the states the other way round: on a purchase the
 * counterparty is the seller, so the supplier's state is compared against the
 * shop's. The supplier's state comes from the first two digits of their GSTIN —
 * which is also why a purchase from a supplier with no GSTIN on file is treated
 * as local: an unregistered supplier charges no GST to claim anyway, and
 * guessing "inter-state" would send the credit to the wrong government.
 */
export function splitInputGst(amount, supplierGstin, shopStateCode = "") {
  const tax = round2(Number(amount) || 0);
  if (isZero(tax)) return { cgst: 0, sgst: 0, igst: 0, interState: false };

  const supplierStateCode = String(supplierGstin || "").slice(0, 2);
  const interState = Boolean(shopStateCode && /^\d{2}$/.test(supplierStateCode) && supplierStateCode !== String(shopStateCode));

  if (interState) return { cgst: 0, sgst: 0, igst: tax, interState: true };
  const central = round2(tax / 2);
  return { cgst: central, sgst: subtractMoney(tax, central), igst: 0, interState: false };
}

/* ── Inventory ────────────────────────────────────────────────────────────── */

/**
 * The quantity to bill in Tally, expressed in the item's rate unit so that
 * rate × quantity reproduces the line amount. Selling 500 g at ₹50/kg has to
 * reach Tally as 0.5 kg at ₹50, not 500 at ₹50.
 *
 * baseQtyToRateQty rejects units it does not recognise, and one odd historical
 * unit on one line must not take a year's export down with it, so an
 * unconvertible line falls back to the quantity as the cashier entered it.
 */
function billedQuantity(item) {
  try {
    const qty = baseQtyToRateQty(Number(item.quantityInBaseUnit) || 0, item.rateUnit, item.baseUnit);
    if (Number.isFinite(qty)) return { qty, unit: String(item.rateUnit || "").trim() };
  } catch {
    /* fall through to the entered quantity */
  }
  return { qty: Number(item.quantity) || 0, unit: String(item.enteredUnit || item.rateUnit || "").trim() };
}

/**
 * A line's value net of tax. Inclusive bills — the default for Indian retail —
 * carry the tax inside lineTotal, and posting that gross figure to a Sales
 * ledger would overstate turnover by the whole GST amount.
 */
function netLineValue(item, gstMode) {
  const gross = Number(item.lineTotal) || 0;
  const rate = Number(item.gstRate) || 0;
  if (gstMode !== "inclusive" || rate <= 0) return round2(gross);
  return round2(gross / (1 + rate / 100));
}

function inventoryEntry(item, sign, gstMode) {
  const name = String(item.name || "").trim() || "Unnamed item";
  const { qty, unit } = billedQuantity(item);
  const net = netLineValue(item, gstMode);
  const value = round2(net * sign);
  const signedQty = round2(qty * sign);
  const quantityText = unit ? `${signedQty} ${unit}` : String(signedQty);
  const rate = isZero(qty) ? "" : `<RATE>${Math.abs(round2(net / qty)).toFixed(2)}${unit ? `/${xmlEscape(unit)}` : ""}</RATE>`;
  const deemed = value < 0 ? "Yes" : "No";
  return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${xmlEscape(name)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>${deemed}</ISDEEMEDPOSITIVE>${rate}<ACTUALQTY>${xmlEscape(quantityText)}</ACTUALQTY><BILLEDQTY>${xmlEscape(quantityText)}</BILLEDQTY><AMOUNT>${value.toFixed(2)}</AMOUNT><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${LEDGER_SALES}</LEDGERNAME><ISDEEMEDPOSITIVE>${deemed}</ISDEEMEDPOSITIVE><AMOUNT>${value.toFixed(2)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
}

/* ── Sales and credit notes ───────────────────────────────────────────────── */

function partyLedgerName(bill) {
  const name = String(bill.customerName || "").trim();
  return name && name !== "Walk-in" ? name : LEDGER_CASH;
}

/**
 * How the money actually came in.
 *
 * A ₹500 bill part-paid ₹200 cash with ₹300 on udhar must debit Cash ₹200 and
 * the customer ₹300 — debiting the customer the whole ₹500, as a single party
 * line does, overstates what they owe and the shop chases a debt that is not
 * there. Whatever the tender rows do not account for is treated as cash, which
 * is what an offline bill with no payment rows at all actually was.
 */
function tenderSplit(bill, total) {
  const credit = round2(Number(bill.creditAmount) || 0);
  const byLedger = new Map();
  const masters = [];

  for (const payment of Array.isArray(bill.payments) ? bill.payments : []) {
    if (payment.status && payment.status !== "confirmed") continue;
    if (String(payment.mode || "") === "credit") continue;
    const amount = round2(Number(payment.amount) || 0);
    if (isZero(amount)) continue;
    const { name, master } = tenderLedger(payment.mode);
    if (master) masters.push(master);
    byLedger.set(name, addMoney(byLedger.get(name) || 0, amount));
  }

  const tendered = [...byLedger.values()].reduce((sum, value) => addMoney(sum, value), 0);
  const residual = subtractMoney(total, addMoney(credit, tendered));
  if (!isZero(residual)) byLedger.set(LEDGER_CASH, addMoney(byLedger.get(LEDGER_CASH) || 0, residual));

  return { byLedger, credit, masters };
}

function buildSaleVoucher(bill, { timeZone, sellerStateCode, inventory, shopId }) {
  const isReturn = bill.billType === "sales_return";
  // A return reverses every leg of the original sale, so the whole voucher is
  // the sale with its signs flipped rather than a separately-reasoned document.
  const sign = isReturn ? -1 : 1;
  const total = round2(Number(bill.grandTotal) || 0);
  const tax = splitGst(bill, sellerStateCode);
  const taxTotal = addMoney(tax.cgst, tax.sgst, tax.igst);
  const netSales = subtractMoney(total, taxTotal);
  const gstMode = String(bill.gstMode || "inclusive");
  const customer = partyLedgerName(bill);

  const masters = [];
  const { byLedger, credit, masters: tenderMasters } = tenderSplit(bill, total);
  masters.push(...tenderMasters);
  if (credit > 0 && customer !== LEDGER_CASH) masters.push(partyMaster(customer, bill.buyerGstin));

  const debits = [...byLedger.entries()].map(([name, amount]) => ledgerEntry(name, round2(-amount * sign)));
  if (!isZero(credit)) debits.push(ledgerEntry(customer, round2(-credit * sign)));

  const useInventory = inventory && Array.isArray(bill.items) && bill.items.length > 0;
  let inventoryXml = "";
  let salesXml = "";
  if (useInventory) {
    inventoryXml = bill.items.map((item) => inventoryEntry(item, sign, gstMode)).join("");
    // Sales is credited through each line's accounting allocation, so anything
    // the lines do not account for — a bill-level discount, an offer, loyalty,
    // round-off, a paisa of inclusive-tax rounding — has to land somewhere or
    // the voucher will not balance. That difference genuinely is a discount.
    const linesTotal = bill.items.reduce((sum, item) => addMoney(sum, netLineValue(item, gstMode)), 0);
    const residual = round2((netSales - linesTotal) * sign);
    salesXml = ledgerEntry(LEDGER_DISCOUNT, residual);
    masters.push({ kind: "ledger", name: LEDGER_SALES, parent: "Sales Accounts" });
    if (!isZero(residual)) masters.push({ kind: "ledger", name: LEDGER_DISCOUNT, parent: "Indirect Expenses" });
    for (const item of bill.items) {
      const { unit } = billedQuantity(item);
      if (unit) masters.push({ kind: "unit", name: unit });
      masters.push({ kind: "stockitem", name: String(item.name || "").trim() || "Unnamed item", unit, hsn: item.hsn || null });
    }
  } else {
    salesXml = ledgerEntry(LEDGER_SALES, round2(netSales * sign));
    if (!isZero(netSales)) masters.push({ kind: "ledger", name: LEDGER_SALES, parent: "Sales Accounts" });
  }

  for (const [key, ledger] of Object.entries(TAX_LEDGERS)) {
    if (!isZero(tax[key])) masters.push({ kind: "ledger", name: ledger.name, parent: "Duties & Taxes", extra: `<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${ledger.dutyHead}</GSTDUTYHEAD><AFFECTSSTOCK>No</AFFECTSSTOCK>` });
  }

  const body =
    inventoryXml +
    debits.join("") +
    ledgerEntry(TAX_LEDGERS.cgst.name, round2(tax.cgst * sign)) +
    ledgerEntry(TAX_LEDGERS.sgst.name, round2(tax.sgst * sign)) +
    ledgerEntry(TAX_LEDGERS.igst.name, round2(tax.igst * sign)) +
    salesXml;

  // The named party must be one the voucher actually posts to, so a credit sale
  // names the customer and a paid sale names the tender it landed in.
  const namedParty = !isZero(credit) ? customer : [...byLedger.keys()][0] || LEDGER_CASH;
  const documentType = isReturn ? "sales_return" : "sale";
  const remoteId = remoteVoucherId(shopId, documentType, bill.id);

  return {
    voucher: voucherXml({
      type: isReturn ? "Credit Note" : "Sales",
      view: useInventory ? "Invoice Voucher View" : "Accounting Voucher View",
      date: tallyDate(bill.businessDate || bill.createdAt, timeZone),
      number: bill.billNo,
      reference: bill.billNo,
      party: namedParty,
      partyName: customer,
      gstin: bill.buyerGstin,
      placeOfSupply: bill.buyerStateCode,
      narration: `KiranaOS ${bill.billType} ${bill.billNo}`,
      body,
      remoteId,
    }),
    masters,
    document: { type: documentType, id: bill.id, voucherNumber: bill.billNo, remoteId },
  };
}

/* ── Purchases and debit notes ────────────────────────────────────────────── */

/**
 * A supplier bill, with the input tax credit it carries.
 *
 * The tax is what the supplier's invoice states, not something derived here —
 * a purchase's rate mix is the supplier's business and guessing it would put an
 * unsupportable number in a statutory return. Goods value is the residual
 * (invoice total − tax), so it can never disagree with the invoice.
 *
 * Jurisdiction runs the opposite way from a sale: the counterparty is the
 * seller, so it is the *supplier's* state that is compared against the shop's.
 */
function buildPurchaseVoucher(receipt, { timeZone, shopId, sellerStateCode }) {
  const total = round2(Number(receipt.supplierInvoiceAmount ?? receipt.totalAmount) || 0);
  const paid = round2(Number(receipt.paidAmount) || 0);
  const supplierGstin = receipt.supplier?.gstin || null;
  const supplier = String(receipt.supplier?.name || "").trim() || "Sundry Supplier";
  const masters = [supplierMaster(supplier, supplierGstin), { kind: "ledger", name: LEDGER_PURCHASE, parent: "Purchase Accounts" }];

  const tax = splitInputGst(receipt.supplierInvoiceTax, supplierGstin, sellerStateCode);
  const taxTotal = addMoney(tax.cgst, tax.sgst, tax.igst);
  const goodsValue = subtractMoney(total, taxTotal);
  for (const [key, ledger] of Object.entries(INPUT_TAX_LEDGERS)) {
    if (!isZero(tax[key])) masters.push({ kind: "ledger", name: ledger.name, parent: "Duties & Taxes", extra: `<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${ledger.dutyHead}</GSTDUTYHEAD><AFFECTSSTOCK>No</AFFECTSSTOCK>` });
  }
  const taxXml =
    ledgerEntry(INPUT_TAX_LEDGERS.cgst.name, -tax.cgst) +
    ledgerEntry(INPUT_TAX_LEDGERS.sgst.name, -tax.sgst) +
    ledgerEntry(INPUT_TAX_LEDGERS.igst.name, -tax.igst);

  // Payable is the residual so a receipt whose paid/due columns disagree with
  // the invoice total still yields a balanced voucher.
  const payable = subtractMoney(total, paid);
  let tenderXml = "";
  if (!isZero(paid)) {
    const { name, master } = tenderLedger(receipt.paymentMode);
    if (master) masters.push(master);
    tenderXml = ledgerEntry(name, paid);
  }

  const remoteId = remoteVoucherId(shopId, "purchase", receipt.id);
  const number = receipt.supplierInvoiceNumber || receipt.receiptNumber;

  return {
    voucher: voucherXml({
      type: "Purchase",
      date: tallyDate(receipt.createdAt, timeZone),
      number,
      reference: receipt.receiptNumber,
      party: supplier,
      gstin: supplierGstin,
      narration: `KiranaOS purchase ${receipt.receiptNumber}`,
      body: ledgerEntry(LEDGER_PURCHASE, -goodsValue) + taxXml + ledgerEntry(supplier, payable) + tenderXml,
      remoteId,
    }),
    masters,
    document: { type: "purchase", id: receipt.id, voucherNumber: number, remoteId },
  };
}

/**
 * Goods going back to the supplier, and the input tax credit going back with
 * them. Every leg is the purchase's, reversed: goods credit Purchase, the tax
 * credits the same Input ledgers the purchase debited, and the supplier is
 * debited the tax-inclusive value less anything refunded in money.
 *
 * Without the tax leg the ledgers still balanced, which is what made this worth
 * fixing deliberately — the shop simply went on claiming credit on tax it had
 * been given back, and nothing in the books looked wrong.
 */
function buildDebitNoteVoucher(ret, { timeZone, shopId, sellerStateCode }) {
  const total = round2(Number(ret.totalAmount) || 0);
  const refund = round2(Number(ret.refundAmount) || 0);
  const supplierGstin = ret.supplier?.gstin || null;
  const supplier = String(ret.supplier?.name || "").trim() || "Sundry Supplier";
  const masters = [supplierMaster(supplier, supplierGstin), { kind: "ledger", name: LEDGER_PURCHASE, parent: "Purchase Accounts" }];

  // Same jurisdiction rule as the purchase, so a return can only ever reverse
  // into the ledgers that purchase debited.
  const tax = splitInputGst(ret.taxAmount, supplierGstin, sellerStateCode);
  const taxTotal = addMoney(tax.cgst, tax.sgst, tax.igst);
  for (const [key, ledger] of Object.entries(INPUT_TAX_LEDGERS)) {
    if (!isZero(tax[key])) masters.push({ kind: "ledger", name: ledger.name, parent: "Duties & Taxes", extra: `<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${ledger.dutyHead}</GSTDUTYHEAD><AFFECTSSTOCK>No</AFFECTSSTOCK>` });
  }
  const taxXml =
    ledgerEntry(INPUT_TAX_LEDGERS.cgst.name, tax.cgst) +
    ledgerEntry(INPUT_TAX_LEDGERS.sgst.name, tax.sgst) +
    ledgerEntry(INPUT_TAX_LEDGERS.igst.name, tax.igst);

  let refundXml = "";
  if (!isZero(refund)) {
    const { name, master } = tenderLedger(ret.refundMode === "supplier_credit" ? "" : ret.refundMode);
    if (master) masters.push(master);
    refundXml = ledgerEntry(name, -refund);
  }
  // Whatever was not refunded in money reduces the payable instead — and the
  // payable moved by the tax-inclusive value when the purchase was posted, so
  // it has to come back the same way.
  const creditToPayable = subtractMoney(addMoney(total, taxTotal), refund);

  const remoteId = remoteVoucherId(shopId, "purchase_return", ret.id);

  return {
    voucher: voucherXml({
      type: "Debit Note",
      date: tallyDate(ret.createdAt, timeZone),
      number: ret.returnNumber,
      reference: ret.supplierReference || ret.returnNumber,
      party: supplier,
      gstin: supplierGstin,
      narration: `KiranaOS purchase return ${ret.returnNumber}`,
      body: ledgerEntry(LEDGER_PURCHASE, total) + taxXml + ledgerEntry(supplier, -creditToPayable) + refundXml,
      remoteId,
    }),
    masters,
    document: { type: "purchase_return", id: ret.id, voucherNumber: ret.returnNumber, remoteId },
  };
}

/* ── Receipts and payments ────────────────────────────────────────────────── */

/** A customer paying down their udhar: money in, their balance down. */
function buildReceiptVoucher(entry, { timeZone, shopId }) {
  const amount = round2(Number(entry.amount) || 0);
  const customer = String(entry.customerName || "").trim() || "Sundry Debtor";
  const { name, master } = tenderLedger(entry.mode);
  const masters = [partyMaster(customer, null)];
  if (master) masters.push(master);
  const remoteId = remoteVoucherId(shopId, "receipt", entry.id);
  const number = `RCPT-${String(entry.id || "").slice(-8).toUpperCase()}`;

  return {
    voucher: voucherXml({
      type: "Receipt",
      date: tallyDate(entry.businessDate || entry.createdAt, timeZone),
      number,
      reference: entry.billNo || null,
      party: customer,
      narration: entry.note ? `KiranaOS udhar receipt — ${entry.note}` : `KiranaOS udhar receipt ${entry.billNo || ""}`.trim(),
      body: ledgerEntry(name, -amount) + ledgerEntry(customer, amount),
      remoteId,
    }),
    masters,
    document: { type: "receipt", id: entry.id, voucherNumber: number, remoteId },
  };
}

// Expense categories are free text on the POS side; each becomes its own ledger
// so the shop's Tally P&L is broken down the way the shopkeeper already thinks.
function expenseLedgerName(category) {
  const raw = String(category || "").trim();
  if (!raw || raw.toLowerCase() === "general") return "General Expenses";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildPaymentVoucher(expense, { timeZone, shopId }) {
  const amount = round2(Number(expense.amount) || 0);
  const ledger = expenseLedgerName(expense.category);
  const { name, master } = tenderLedger(expense.paymentMode);
  const masters = [{ kind: "ledger", name: ledger, parent: "Indirect Expenses" }];
  if (master) masters.push(master);
  const remoteId = remoteVoucherId(shopId, "expense", expense.id);
  const number = `EXP-${String(expense.id || "").slice(-8).toUpperCase()}`;

  return {
    voucher: voucherXml({
      type: "Payment",
      date: tallyDate(expense.spentAt || expense.createdAt, timeZone),
      number,
      party: name,
      narration: `KiranaOS expense — ${expense.title || ledger}${expense.vendor ? ` (${expense.vendor})` : ""}`,
      body: ledgerEntry(ledger, -amount) + ledgerEntry(name, amount),
      remoteId,
    }),
    masters,
    document: { type: "expense", id: expense.id, voucherNumber: number, remoteId },
  };
}

function stockJournalEntry(row, sign) {
  const name = String(row.productName || row.productId || "Unnamed item").trim();
  const unit = String(row.baseUnit || "piece").trim();
  const qty = round2((Number(row.actualBaseQty ?? row.quantityBaseQty) || 0) * sign);
  const amount = round2((Number(row.stockValue) || 0) * sign);
  return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${xmlEscape(name)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>${sign < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE><ACTUALQTY>${xmlEscape(`${qty} ${unit}`)}</ACTUALQTY><BILLEDQTY>${xmlEscape(`${qty} ${unit}`)}</BILLEDQTY><AMOUNT>${amount.toFixed(2)}</AMOUNT></ALLINVENTORYENTRIES.LIST>`;
}

/** One completed factory run becomes one Tally Stock Journal. */
function buildProductionVoucher(run, { timeZone, shopId }) {
  const consumptions = Array.isArray(run.consumptions) ? run.consumptions : [];
  const outputs = Array.isArray(run.outputs) ? run.outputs : [];
  const rows = [...consumptions, ...outputs];
  const masters = [];
  for (const row of rows) {
    const unit = String(row.baseUnit || "piece").trim();
    if (unit) masters.push({ kind: "unit", name: unit });
    masters.push({ kind: "stockitem", name: String(row.productName || row.productId || "Unnamed item"), unit, hsn: row.hsn || null });
  }
  const remoteId = remoteVoucherId(shopId, "production", run.id);
  return {
    voucher: voucherXml({
      type: "Stock Journal",
      view: "Consumption Voucher View",
      date: tallyDate(run.completedAt || run.manufacturedOn || run.createdAt, timeZone),
      number: run.runNumber,
      reference: run.finishedBatchNumber || run.runNumber,
      narration: `KiranaOS production ${run.runNumber}${run.finishedBatchNumber ? ` — batch ${run.finishedBatchNumber}` : ""}`,
      body: consumptions.map((row) => stockJournalEntry(row, -1)).join("") + outputs.map((row) => stockJournalEntry(row, 1)).join(""),
      remoteId,
    }),
    masters,
    document: { type: "production", id: run.id, voucherNumber: run.runNumber, remoteId },
  };
}

/* ── Envelope ─────────────────────────────────────────────────────────────── */

function collectMasters(all) {
  const merged = new Map();
  for (const master of all) {
    if (!master?.name) continue;
    const key = `${master.kind}:${master.name}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, master);
      continue;
    }
    // A party's GSTIN may only appear on their GST invoices and an HSN only on
    // some lines, so the first sighting anywhere beats an earlier blank.
    if (master.gstin && !existing.gstin) existing.gstin = master.gstin;
    if (master.hsn && !existing.hsn) existing.hsn = master.hsn;
    if (master.unit && !existing.unit) existing.unit = master.unit;
  }

  // Units before the stock items that measure in them, ledgers before vouchers.
  const order = { unit: 0, stockitem: 1, ledger: 2 };
  return [...merged.values()].sort((a, b) => order[a.kind] - order[b.kind]);
}

function renderMaster(master) {
  if (master.kind === "unit") return renderUnitMaster(master);
  if (master.kind === "stockitem") return renderStockItemMaster(master);
  return renderLedgerMaster(master);
}

/**
 * Build the complete import envelope for a set of documents.
 *
 * Masters lead, vouchers follow: Tally reads each TALLYMESSAGE by the element
 * inside it, so one file can carry both, and ordering them this way means a
 * ledger is always defined before the voucher that names it.
 */
export function buildTallyEnvelope({
  companyName,
  shopId = "",
  sellerStateCode = "",
  bills = [],
  purchases = [],
  purchaseReturns = [],
  receipts = [],
  expenses = [],
  productionRuns = [],
  timeZone,
  inventory = false,
}) {
  const context = { timeZone, sellerStateCode, inventory, shopId };
  const built = [
    ...bills.map((bill) => buildSaleVoucher(bill, context)),
    ...purchases.map((receipt) => buildPurchaseVoucher(receipt, context)),
    ...purchaseReturns.map((ret) => buildDebitNoteVoucher(ret, context)),
    ...receipts.map((entry) => buildReceiptVoucher(entry, context)),
    ...expenses.map((expense) => buildPaymentVoucher(expense, context)),
    ...productionRuns.map((run) => buildProductionVoucher(run, context)),
  ];

  const masters = collectMasters(built.flatMap((entry) => entry.masters))
    // Tally already has Cash; re-creating it is a duplicate-master error.
    .filter((master) => !(master.kind === "ledger" && master.name === LEDGER_CASH));

  return {
    xml:
      '<?xml version="1.0" encoding="UTF-8"?>' +
      "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>" +
      `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>` +
      `<REQUESTDATA>${masters.map(renderMaster).join("")}${built.map((entry) => entry.voucher).join("")}</REQUESTDATA>` +
      "</IMPORTDATA></BODY></ENVELOPE>",
    count: built.length,
    masterCount: masters.length,
    // What is in this envelope, so a caller that pushes it to Tally can record
    // exactly which documents were sent rather than re-deriving the range.
    documents: built.map((entry) => entry.document),
    counts: {
      sales: bills.length,
      purchases: purchases.length,
      purchaseReturns: purchaseReturns.length,
      receipts: receipts.length,
      expenses: expenses.length,
      production: productionRuns.length,
    },
  };
}
