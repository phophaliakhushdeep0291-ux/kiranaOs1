import { formatDateInTimeZone } from "../../utils/dates.js";
import { addMoney, round2, subtractMoney, toPaise } from "../../utils/money.js";
import { baseQtyToRateQty } from "../../utils/units.js";

// ─────────────────────────────────────────────────────────────
// TALLY VOUCHER XML
//
// A voucher TallyPrime will actually accept has to satisfy three things at once:
//
//   1. Every ledger a voucher references must already exist in the company, so
//      the masters are emitted ahead of the vouchers in the same envelope. A
//      voucher naming an unknown ledger does not import "mostly" — Tally
//      rejects that voucher and keeps going, so the failure is quiet and the
//      books end up short by however many customers were new that month.
//
//   2. The ledger entries of a voucher must sum to zero. Rather than rebuild
//      the sale from subtotal/discount/offer/loyalty/gift-card/round-off — five
//      chances to be a paisa out — the sales line is taken as the *residual*
//      (grandTotal − gst). That is correct for both gstMode values and it makes
//      an unbalanced voucher structurally impossible.
//
//   3. Tax must be split by jurisdiction. A single "Sales" line, which is what
//      this export used to emit, is not something a GST return can be filed
//      from, so the whole export was doing work the accountant had to redo.
//
// This module is deliberately free of database and environment imports so the
// voucher shape can be tested directly on plain objects.
// ─────────────────────────────────────────────────────────────

const LEDGER_SALES = "Sales";
const LEDGER_DISCOUNT = "Discount Allowed";
// Every Tally company ships with a "Cash" ledger already under Cash-in-Hand, so
// emitting a master for it is a duplicate-master error rather than a courtesy.
const LEDGER_CASH = "Cash";

const TAX_LEDGERS = Object.freeze({
  cgst: { name: "Output CGST", dutyHead: "Central Tax" },
  sgst: { name: "Output SGST", dutyHead: "State Tax" },
  igst: { name: "Output IGST", dutyHead: "Integrated Tax" },
});

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

function ledgerMaster(name, parent, extra = "") {
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${xmlEscape(name)}" ACTION="Create"><NAME>${xmlEscape(name)}</NAME><PARENT>${xmlEscape(parent)}</PARENT>${extra}</LEDGER></TALLYMESSAGE>`;
}

function partyLedgerMaster(name, gstin) {
  const registration = gstin
    ? `<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><PARTYGSTIN>${xmlEscape(gstin)}</PARTYGSTIN>`
    : "<GSTREGISTRATIONTYPE>Unregistered</GSTREGISTRATIONTYPE>";
  return ledgerMaster(name, "Sundry Debtors", registration);
}

function unitMaster(unit) {
  // Weight and volume sales are routinely fractional (250 g of anything), and a
  // unit created with Tally's default 0 decimal places silently rounds them.
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><UNIT NAME="${xmlEscape(unit)}" ACTION="Create"><NAME>${xmlEscape(unit)}</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES>3</DECIMALPLACES></UNIT></TALLYMESSAGE>`;
}

function stockItemMaster({ name, unit, hsn }) {
  const hsnPart = hsn ? `<HSNCODE>${xmlEscape(hsn)}</HSNCODE>` : "";
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKITEM NAME="${xmlEscape(name)}" ACTION="Create"><NAME>${xmlEscape(name)}</NAME><BASEUNITS>${xmlEscape(unit)}</BASEUNITS>${hsnPart}</STOCKITEM></TALLYMESSAGE>`;
}

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
  const value = round2(netLineValue(item, gstMode) * sign);
  const signedQty = round2(qty * sign);
  const quantityText = unit ? `${signedQty} ${unit}` : String(signedQty);
  const rate = isZero(qty) ? "" : `<RATE>${Math.abs(round2(netLineValue(item, gstMode) / qty)).toFixed(2)}${unit ? `/${xmlEscape(unit)}` : ""}</RATE>`;
  return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${xmlEscape(name)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>${value < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>${rate}<ACTUALQTY>${xmlEscape(quantityText)}</ACTUALQTY><BILLEDQTY>${xmlEscape(quantityText)}</BILLEDQTY><AMOUNT>${value.toFixed(2)}</AMOUNT><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${LEDGER_SALES}</LEDGERNAME><ISDEEMEDPOSITIVE>${value < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${value.toFixed(2)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
}

function partyLedgerName(bill) {
  const name = String(bill.customerName || "").trim();
  return name && name !== "Walk-in" ? name : LEDGER_CASH;
}

/**
 * Build one voucher, and report the ledgers/items it referenced so the caller
 * can emit exactly the masters this batch needs and no others.
 */
function buildVoucher(bill, { timeZone, sellerStateCode, inventory }) {
  const isReturn = bill.billType === "sales_return";
  // A return reverses every leg of the original sale, so the whole voucher is
  // the sale with its signs flipped rather than a separately-reasoned document.
  const sign = isReturn ? -1 : 1;
  const voucherType = isReturn ? "Credit Note" : "Sales";
  const party = partyLedgerName(bill);
  const total = round2(Number(bill.grandTotal) || 0);
  const tax = splitGst(bill, sellerStateCode);
  const taxTotal = addMoney(tax.cgst, tax.sgst, tax.igst);
  const netSales = subtractMoney(total, taxTotal);

  const useInventory = inventory && Array.isArray(bill.items) && bill.items.length > 0;
  const gstMode = String(bill.gstMode || "inclusive");

  let inventoryXml = "";
  let salesXml = "";
  if (useInventory) {
    inventoryXml = bill.items.map((item) => inventoryEntry(item, sign, gstMode)).join("");
    // Sales is credited through each line's accounting allocation, so anything
    // the lines do not account for — a bill-level discount, an offer, loyalty,
    // round-off, a paisa of inclusive-tax rounding — has to land somewhere or
    // the voucher will not balance. That difference genuinely is a discount.
    const linesTotal = bill.items.reduce((sum, item) => addMoney(sum, netLineValue(item, gstMode)), 0);
    salesXml = ledgerEntry(LEDGER_DISCOUNT, round2((netSales - linesTotal) * sign));
  } else {
    salesXml = ledgerEntry(LEDGER_SALES, round2(netSales * sign));
  }

  const entries = [
    ledgerEntry(party, round2(-total * sign)),
    ledgerEntry(TAX_LEDGERS.cgst.name, round2(tax.cgst * sign)),
    ledgerEntry(TAX_LEDGERS.sgst.name, round2(tax.sgst * sign)),
    ledgerEntry(TAX_LEDGERS.igst.name, round2(tax.igst * sign)),
    salesXml,
  ].join("");

  const view = useInventory ? "Invoice Voucher View" : "Accounting Voucher View";
  const date = tallyDate(bill.businessDate || bill.createdAt, timeZone);
  const gstinPart = bill.buyerGstin ? `<PARTYGSTIN>${xmlEscape(bill.buyerGstin)}</PARTYGSTIN>` : "";
  const placeOfSupply = bill.buyerStateCode ? `<PLACEOFSUPPLY>${xmlEscape(bill.buyerStateCode)}</PLACEOFSUPPLY>` : "";

  const voucher =
    `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${voucherType}" ACTION="Create" OBJVIEW="${view}">` +
    `<DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE>` +
    `<VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${xmlEscape(bill.billNo)}</VOUCHERNUMBER>` +
    `<REFERENCE>${xmlEscape(bill.billNo)}</REFERENCE>` +
    `<PARTYLEDGERNAME>${xmlEscape(party)}</PARTYLEDGERNAME>` +
    `<PARTYNAME>${xmlEscape(party)}</PARTYNAME>` +
    gstinPart +
    placeOfSupply +
    `<PERSISTEDVIEW>${view}</PERSISTEDVIEW>` +
    `<NARRATION>KiranaOS ${xmlEscape(bill.billType)} ${xmlEscape(bill.billNo)}</NARRATION>` +
    inventoryXml +
    entries +
    `</VOUCHER></TALLYMESSAGE>`;

  return {
    voucher,
    party: party === LEDGER_CASH ? null : { name: party, gstin: bill.buyerGstin || null },
    usesTax: { cgst: !isZero(tax.cgst), sgst: !isZero(tax.sgst), igst: !isZero(tax.igst) },
    usesDiscount: useInventory && salesXml !== "",
    usesSales: !useInventory && salesXml !== "",
    items: useInventory
      ? bill.items.map((item) => {
          const { unit } = billedQuantity(item);
          return { name: String(item.name || "").trim() || "Unnamed item", unit, hsn: item.hsn || null };
        })
      : [],
  };
}

/**
 * Build the complete import envelope for a set of bills.
 *
 * Masters lead, vouchers follow: Tally reads each TALLYMESSAGE by the element
 * inside it, so one file can carry both, and ordering them this way means a
 * ledger is always defined before the voucher that names it.
 */
export function buildTallyEnvelope({ companyName, sellerStateCode = "", bills = [], timeZone, inventory = false }) {
  const built = bills.map((bill) => buildVoucher(bill, { timeZone, sellerStateCode, inventory }));

  const parties = new Map();
  const stockItems = new Map();
  const units = new Set();
  let needsSales = false;
  let needsDiscount = false;
  const needsTax = { cgst: false, sgst: false, igst: false };

  for (const entry of built) {
    if (entry.party && !parties.has(entry.party.name)) parties.set(entry.party.name, entry.party.gstin);
    // A party's GSTIN may only appear on their GST invoices, not their cash
    // ones, so the first sighting anywhere wins over an earlier blank.
    else if (entry.party?.gstin && !parties.get(entry.party.name)) parties.set(entry.party.name, entry.party.gstin);
    if (entry.usesSales) needsSales = true;
    if (entry.usesDiscount) needsDiscount = true;
    for (const key of Object.keys(needsTax)) if (entry.usesTax[key]) needsTax[key] = true;
    for (const item of entry.items) {
      if (item.unit) units.add(item.unit);
      if (!stockItems.has(item.name)) stockItems.set(item.name, item);
      else if (item.hsn && !stockItems.get(item.name).hsn) stockItems.set(item.name, item);
    }
  }

  // Inventory vouchers credit Sales through their accounting allocations, so
  // the ledger is needed whether or not a plain Sales line was emitted.
  if (inventory && stockItems.size > 0) needsSales = true;

  const masters = [
    ...(needsSales ? [ledgerMaster(LEDGER_SALES, "Sales Accounts")] : []),
    ...(needsDiscount ? [ledgerMaster(LEDGER_DISCOUNT, "Indirect Expenses")] : []),
    ...Object.entries(TAX_LEDGERS)
      .filter(([key]) => needsTax[key])
      .map(([, ledger]) => ledgerMaster(ledger.name, "Duties & Taxes", `<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${ledger.dutyHead}</GSTDUTYHEAD><AFFECTSSTOCK>No</AFFECTSSTOCK>`)),
    ...[...units].map((unit) => unitMaster(unit)),
    ...[...stockItems.values()].map((item) => stockItemMaster({ name: item.name, unit: item.unit || "piece", hsn: item.hsn })),
    ...[...parties.entries()].map(([name, gstin]) => partyLedgerMaster(name, gstin)),
  ].join("");

  const vouchers = built.map((entry) => entry.voucher).join("");

  return {
    xml:
      '<?xml version="1.0" encoding="UTF-8"?>' +
      "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>" +
      `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>` +
      `<REQUESTDATA>${masters}${vouchers}</REQUESTDATA>` +
      "</IMPORTDATA></BODY></ENVELOPE>",
    count: built.length,
    masterCount: parties.size + stockItems.size + units.size + Object.values(needsTax).filter(Boolean).length + (needsSales ? 1 : 0) + (needsDiscount ? 1 : 0),
  };
}
