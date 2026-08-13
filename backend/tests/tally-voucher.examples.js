import assert from "assert";
import fs from "fs";
import { buildTallyEnvelope, remoteVoucherId, splitGst } from "../src/modules/integrations/tally-voucher.js";
import { tallyExportQuerySchema } from "../src/modules/integrations/integrations.schemas.js";
import { parseTallyImportResponse } from "../src/modules/integrations/integrations.service.js";
import { round2, toPaise } from "../src/utils/money.js";

// TallyPrime export. The export is a one-way door: whatever these vouchers say
// becomes the shop's books, and a wrong one is found by an accountant weeks
// later with no way to tell which side is lying. So the properties guarded here
// are the ones Tally itself will not check for us — that every voucher balances,
// that tax is split the same way the GST screen splits it, and that no voucher
// names a ledger the envelope forgot to create.

const TZ = "Asia/Kolkata";

/* ── Helpers ──────────────────────────────────────────────────────────────── */

// Dependency-free well-formedness scan. Tally rejects the whole file on a
// single malformed tag, so an unescaped customer name is not a cosmetic bug.
function assertWellFormed(xml) {
  const stack = [];
  const tagPattern = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
  let match = tagPattern.exec(xml);
  while (match !== null) {
    const [, closing, name, , selfClosing] = match;
    if (closing) {
      assert.equal(stack.pop(), name, `mismatched closing tag </${name}>`);
    } else if (!selfClosing) {
      stack.push(name);
    }
    match = tagPattern.exec(xml);
  }
  assert.deepEqual(stack, [], `unclosed tags: ${stack.join(", ")}`);

  const body = xml.replace(/<\?xml[^?]*\?>/, "");
  const strayAmpersand = body.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, "").includes("&");
  assert.ok(!strayAmpersand, "every bare & must be escaped or Tally will not parse the file");
}

function vouchersOf(xml) {
  return xml.match(/<VOUCHER\b[\s\S]*?<\/VOUCHER>/g) || [];
}

// A voucher balances when its ledger entries and its inventory accounting
// allocations sum to zero. The AMOUNT on an inventory line is the same money as
// its allocation, so counting it again would double the stock side.
function balanceOf(voucher) {
  const blocks = [
    ...(voucher.match(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g) || []),
    ...(voucher.match(/<ACCOUNTINGALLOCATIONS\.LIST>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST>/g) || []),
  ];
  return blocks.reduce((paise, block) => {
    const amount = /<AMOUNT>(-?[\d.]+)<\/AMOUNT>/.exec(block);
    return paise + (amount ? toPaise(Number(amount[1])) : 0);
  }, 0);
}

function ledgerNamesIn(voucher) {
  return (voucher.match(/<LEDGERNAME>([\s\S]*?)<\/LEDGERNAME>/g) || []).map((tag) =>
    tag.replace(/<\/?LEDGERNAME>/g, ""),
  );
}

function declaredLedgers(xml) {
  return (xml.match(/<LEDGER NAME="([^"]*)"/g) || []).map((tag) => /NAME="([^"]*)"/.exec(tag)[1]);
}

function bill(overrides = {}) {
  return {
    billNo: "KOS-2026-0001",
    billType: "gst_invoice",
    customerName: "Walk-in",
    gstMode: "inclusive",
    subtotal: 105,
    discount: 0,
    gst: 5,
    grandTotal: 105,
    businessDate: new Date("2026-08-11T06:00:00.000Z"),
    createdAt: new Date("2026-08-11T06:00:00.000Z"),
    sellerStateCode: "27",
    buyerStateCode: "27",
    ...overrides,
  };
}

function envelope(bills, options = {}) {
  return buildTallyEnvelope({ companyName: "Test Shop", sellerStateCode: "27", bills, timeZone: TZ, ...options });
}

/* ── Every voucher balances ───────────────────────────────────────────────── */

// The residual sales line exists precisely so that discounts, offers, loyalty,
// gift cards, round-off and let-go cannot knock a voucher off zero. Each of
// these bills breaks the naive subtotal arithmetic in a different way.
const awkward = [
  bill({ billNo: "A-1" }),
  bill({ billNo: "A-2", gstMode: "exclusive", subtotal: 100, gst: 18, grandTotal: 118 }),
  bill({ billNo: "A-3", gstMode: "none", subtotal: 100, gst: 0, grandTotal: 100 }),
  bill({ billNo: "A-4", subtotal: 105, discount: 5, gst: 4.76, grandTotal: 100 }),
  // Round-off: the shop collected a whole rupee for a 99.60 bill.
  bill({ billNo: "A-5", subtotal: 99.6, gst: 4.74, grandTotal: 100 }),
  // An odd paisa of tax that cannot halve evenly.
  bill({ billNo: "A-6", subtotal: 63.03, gst: 3.03, grandTotal: 63.03 }),
  bill({ billNo: "A-7", billType: "sales_return", grandTotal: 105, gst: 5 }),
  bill({ billNo: "A-8", grandTotal: 0, gst: 0, subtotal: 0 }),
];

const awkwardXml = envelope(awkward).xml;
assertWellFormed(awkwardXml);
assert.equal(vouchersOf(awkwardXml).length, awkward.length, "every bill becomes exactly one voucher");
for (const voucher of vouchersOf(awkwardXml)) {
  const number = /<VOUCHERNUMBER>([^<]*)</.exec(voucher)[1];
  assert.equal(balanceOf(voucher), 0, `voucher ${number} does not balance`);
}

/* ── Tax is split the way the GST report splits it ────────────────────────── */

const intra = splitGst({ gst: 18, sellerStateCode: "27", buyerStateCode: "27" });
assert.equal(intra.cgst, 9, "an intra-state sale is half central tax");
assert.equal(intra.sgst, 9, "an intra-state sale is half state tax");
assert.equal(intra.igst, 0, "an intra-state sale carries no integrated tax");

const inter = splitGst({ gst: 18, sellerStateCode: "27", buyerStateCode: "29" });
assert.equal(inter.igst, 18, "an inter-state sale is entirely integrated tax");
assert.equal(inter.cgst + inter.sgst, 0, "an inter-state sale splits nothing centrally");

// Tax that cannot halve evenly must still add back to the filed figure — a paisa
// lost here is a paisa the voucher cannot balance.
const odd = splitGst({ gst: 3.03, sellerStateCode: "27", buyerStateCode: "27" });
assert.equal(round2(odd.cgst + odd.sgst), 3.03, "the halves must reconstitute the tax exactly");

// An unknown buyer state is a local sale, not an inter-state one: a blank field
// is missing data, and guessing "inter-state" would move tax to the wrong
// government.
assert.equal(splitGst({ gst: 18, sellerStateCode: "27", buyerStateCode: "" }).igst, 0, "a blank buyer state stays intra-state");
assert.equal(splitGst({ gst: 18, sellerStateCode: "27", buyerStateCode: "ZZ" }).igst, 0, "a malformed buyer state stays intra-state");

// The bill's own stamped seller state wins: a shop that re-registered must not
// have last year's vouchers reclassified by this year's GSTIN.
assert.equal(splitGst({ gst: 18, sellerStateCode: "29", buyerStateCode: "27" }, "27").igst, 18, "the bill's stamped seller state wins over the shop's current one");

/* ── Turnover is net of tax, in both GST modes ────────────────────────────── */

function ledgerAmount(voucher, ledger) {
  const block = new RegExp(`<ALLLEDGERENTRIES\\.LIST><LEDGERNAME>${ledger}</LEDGERNAME>[\\s\\S]*?</ALLLEDGERENTRIES\\.LIST>`).exec(voucher);
  return block ? Number(/<AMOUNT>(-?[\d.]+)</.exec(block[0])[1]) : 0;
}

const inclusiveVoucher = vouchersOf(envelope([bill({ billNo: "T-1" })]).xml)[0];
assert.equal(ledgerAmount(inclusiveVoucher, "Sales"), 100, "an inclusive bill posts turnover net of the tax inside it");
assert.equal(ledgerAmount(inclusiveVoucher, "Output CGST"), 2.5, "half the inclusive tax is central");

const exclusiveVoucher = vouchersOf(envelope([bill({ billNo: "T-2", gstMode: "exclusive", subtotal: 100, gst: 18, grandTotal: 118 })]).xml)[0];
assert.equal(ledgerAmount(exclusiveVoucher, "Sales"), 100, "an exclusive bill posts its subtotal as turnover");
assert.equal(ledgerAmount(exclusiveVoucher, "Cash"), -118, "the party is debited the full collected amount");

/* ── A return is the sale with every sign flipped ─────────────────────────── */

const returnVoucher = vouchersOf(envelope([bill({ billNo: "R-1", billType: "sales_return" })]).xml)[0];
assert.ok(returnVoucher.includes('VCHTYPE="Credit Note"'), "a sales return is a credit note");
assert.equal(ledgerAmount(returnVoucher, "Cash"), 105, "the party is credited on a return");
assert.equal(ledgerAmount(returnVoucher, "Sales"), -100, "turnover is reversed on a return");
assert.equal(ledgerAmount(returnVoucher, "Output CGST"), -2.5, "tax is reversed on a return, not collected again");
assert.ok(returnVoucher.includes("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>"), "the reversed legs are marked as debits");

/* ── Tender: who was actually debited ─────────────────────────────────────── */

// The bug this guards: debiting the customer the whole bill when they only put
// part of it on udhar. The shop then chases a debt that does not exist.
const partPaid = vouchersOf(envelope([bill({
  billNo: "P-1", grandTotal: 500, subtotal: 500, gst: 0, customerName: "Iqbal",
  creditAmount: 300, paidAmount: 200, payments: [{ mode: "cash", amount: 200, status: "confirmed" }],
})]).xml)[0];
assert.equal(ledgerAmount(partPaid, "Cash"), -200, "only the cash actually tendered hits the cash book");
assert.equal(ledgerAmount(partPaid, "Iqbal"), -300, "only the unpaid part becomes a receivable");
assert.equal(balanceOf(partPaid), 0, "a part-paid bill balances");

// A named customer who paid in full owes nothing, so no debtor ledger is
// invented for them — but the voucher still records who bought.
const cashNamed = envelope([bill({ billNo: "P-2", customerName: "Sharma & Sons" })]);
assert.equal(ledgerAmount(vouchersOf(cashNamed.xml)[0], "Cash"), -105, "a fully paid sale debits cash");
assert.ok(!declaredLedgers(cashNamed.xml).includes("Sharma &amp; Sons"), "a customer who owes nothing gets no debtor ledger");
assert.ok(cashNamed.xml.includes("<PARTYNAME>Sharma &amp; Sons</PARTYNAME>"), "the buyer is still named on the voucher");

// Split tender across instruments.
const splitTender = vouchersOf(envelope([bill({
  billNo: "P-3", grandTotal: 500, subtotal: 500, gst: 0,
  payments: [{ mode: "cash", amount: 200, status: "confirmed" }, { mode: "upi", amount: 300, status: "confirmed" }],
})]).xml)[0];
assert.equal(ledgerAmount(splitTender, "Cash"), -200, "the cash leg goes to cash");
assert.equal(ledgerAmount(splitTender, "UPI Collections"), -300, "the UPI leg goes to a bank ledger");

// An unconfirmed payment is not money in the till yet; the residual keeps the
// voucher balanced rather than silently dropping ₹300.
const pending = vouchersOf(envelope([bill({
  billNo: "P-4", grandTotal: 500, subtotal: 500, gst: 0,
  payments: [{ mode: "upi", amount: 300, status: "pending" }],
})]).xml)[0];
assert.equal(ledgerAmount(pending, "UPI Collections"), 0, "an unconfirmed payment is not posted");
assert.equal(balanceOf(pending), 0, "an unconfirmed payment still leaves a balanced voucher");

// A tender mode nobody has taught this exporter about must be visible, not
// quietly folded into cash where a wrong cash book hides forever.
const unknownTender = envelope([bill({
  billNo: "P-5", grandTotal: 100, subtotal: 100, gst: 0,
  payments: [{ mode: "crypto", amount: 100, status: "confirmed" }],
})]);
assert.equal(ledgerAmount(vouchersOf(unknownTender.xml)[0], "Unclassified Tender"), -100, "an unknown tender mode lands in suspense");
assert.ok(declaredLedgers(unknownTender.xml).includes("Unclassified Tender"), "the suspense ledger is declared");

/* ── Masters: every ledger a voucher names must be declared ───────────────── */

const mixed = envelope([
  bill({ billNo: "M-1", customerName: "Sharma & Sons", buyerGstin: "27AAECS1234F1Z5", creditAmount: 105 }),
  bill({ billNo: "M-2", customerName: "Sharma & Sons", creditAmount: 105 }),
  bill({ billNo: "M-3", customerName: "Walk-in" }),
  bill({ billNo: "M-4", customerName: "Rao Traders", buyerStateCode: "29", gst: 18, subtotal: 118, grandTotal: 118, creditAmount: 118 }),
]);
assertWellFormed(mixed.xml);

const declared = new Set([...declaredLedgers(mixed.xml), "Cash"]);
for (const voucher of vouchersOf(mixed.xml)) {
  for (const ledger of ledgerNamesIn(voucher)) {
    assert.ok(declared.has(ledger), `voucher names an undeclared ledger: ${ledger}`);
  }
}

// Tally ships a Cash ledger in every company; re-creating it is a duplicate
// master error, which is exactly the kind of failure that makes a shopkeeper
// abandon the import.
assert.ok(!declaredLedgers(mixed.xml).includes("Cash"), "Tally's built-in Cash ledger must not be re-created");

// One master per party however many bills they appear on.
assert.equal(declaredLedgers(mixed.xml).filter((name) => name === "Sharma &amp; Sons").length, 1, "a repeat customer gets one ledger, not one per bill");
assert.ok(mixed.xml.includes("<PARTYGSTIN>27AAECS1234F1Z5</PARTYGSTIN>"), "a known GSTIN reaches the party master");
assert.ok(mixed.xml.includes("<GSTREGISTRATIONTYPE>Unregistered</GSTREGISTRATIONTYPE>"), "a party with no GSTIN is declared unregistered rather than left blank");

// Tax ledgers are declared only when a voucher actually uses them: a shop that
// never sells inter-state should not find an Output IGST ledger in its books.
assert.ok(declaredLedgers(mixed.xml).includes("Output IGST"), "the inter-state bill declares integrated tax");
const localOnly = envelope([bill({ billNo: "L-1" })]);
assert.ok(!declaredLedgers(localOnly.xml).includes("Output IGST"), "a purely local batch declares no integrated tax ledger");
assert.ok(declaredLedgers(localOnly.xml).includes("Output CGST"), "a local batch declares central tax");

// Masters have to precede the vouchers that reference them.
assert.ok(mixed.xml.indexOf("<LEDGER ") < mixed.xml.indexOf("<VOUCHER "), "masters must be imported before the vouchers naming them");

/* ── Escaping ─────────────────────────────────────────────────────────────── */

const hostile = envelope([bill({ billNo: 'B<1>&"', customerName: `Ram & Co <script> "O'Brien"` })]);
assertWellFormed(hostile.xml);
assert.ok(!hostile.xml.includes("<script>"), "a customer name must not become markup");
assert.equal(balanceOf(vouchersOf(hostile.xml)[0]), 0, "escaping must not disturb the amounts");

/* ── The accounting date is the business date ─────────────────────────────── */

// A bill written offline on the 31st and synced on the 2nd belongs to the month
// it was sold in. Using createdAt would move revenue across a filing boundary.
const lateSync = envelope([
  bill({ billNo: "D-1", businessDate: new Date("2026-07-31T06:00:00.000Z"), createdAt: new Date("2026-08-02T09:00:00.000Z") }),
]);
assert.ok(lateSync.xml.includes("<DATE>20260731</DATE>"), "the voucher carries the business date, not the sync time");
assert.ok(!lateSync.xml.includes("20260802"), "the sync time must not appear as an accounting date");

// Shop time, not UTC: a 9pm IST sale is still that day's business, and reading
// it in UTC would push the last two and a half hours of every day into tomorrow.
const lateEvening = envelope([bill({ billNo: "D-2", businessDate: new Date("2026-07-31T18:30:00.000Z") })]);
assert.ok(lateEvening.xml.includes("<DATE>20260801</DATE>"), "midnight is the shop's midnight");

/* ── Inventory mode ───────────────────────────────────────────────────────── */

function item(overrides = {}) {
  return {
    name: "Atta",
    quantity: 500,
    enteredUnit: "g",
    baseUnit: "g",
    quantityInBaseUnit: 500,
    rateUnit: "kg",
    ratePerRateUnit: 50,
    gstRate: 5,
    hsn: "1101",
    lineTotal: 26.25,
    ...overrides,
  };
}

const withStock = envelope(
  [
    bill({ billNo: "I-1", subtotal: 26.25, gst: 1.25, grandTotal: 26.25, items: [item()] }),
    // A bill-level discount the lines know nothing about: the difference has to
    // land on a real ledger or the voucher will not balance.
    bill({ billNo: "I-2", subtotal: 26.25, discount: 6.25, gst: 0.95, grandTotal: 20, items: [item()] }),
  ],
  { inventory: true },
);
assertWellFormed(withStock.xml);
for (const voucher of vouchersOf(withStock.xml)) {
  const number = /<VOUCHERNUMBER>([^<]*)</.exec(voucher)[1];
  assert.equal(balanceOf(voucher), 0, `inventory voucher ${number} does not balance`);
}

// 500 g sold at ₹50/kg has to reach Tally as 0.5 kg at ₹50 — billing 500 kg
// would empty the shop's stock in Tally on a single sale.
assert.ok(withStock.xml.includes("<BILLEDQTY>0.5 kg</BILLEDQTY>"), "quantity is billed in the rate unit");
assert.ok(withStock.xml.includes("<RATE>50.00/kg</RATE>"), "the rate is per rate unit");
assert.ok(withStock.xml.includes("<HSNCODE>1101</HSNCODE>"), "HSN reaches the stock item master");
assert.ok(withStock.xml.includes("<DECIMALPLACES>3</DECIMALPLACES>"), "fractional weight units must not round to whole numbers");
assert.ok(withStock.xml.includes("Discount Allowed"), "a bill-level discount lands on a discount ledger");
// Inventory sells at 25.00 net of the 5% inside 26.25, not the gross figure.
assert.ok(withStock.xml.includes("<AMOUNT>25.00</AMOUNT>"), "an inclusive line posts net of its own tax");

// Off by default: an accounts-only Tally company rejects vouchers naming stock
// items it has never heard of.
assert.ok(!envelope([bill({ billNo: "N-1", items: [item()] })]).xml.includes("ALLINVENTORYENTRIES"), "inventory entries are opt-in");
assert.ok(vouchersOf(envelope([bill({ billNo: "N-2" })]).xml)[0].includes("Accounting Voucher View"), "an accounts-only voucher uses the accounting view");
assert.ok(vouchersOf(withStock.xml)[0].includes("Invoice Voucher View"), "an inventory voucher uses the invoice view");

// An unrecognised historical unit must cost its own line's precision, not the
// whole year's export.
const oddUnit = envelope([bill({ billNo: "U-1", items: [item({ rateUnit: "bushel", baseUnit: "bushel", enteredUnit: "bushel", quantity: 2 })] })], { inventory: true });
assertWellFormed(oddUnit.xml);
assert.equal(balanceOf(vouchersOf(oddUnit.xml)[0]), 0, "an unconvertible unit still yields a balanced voucher");

/* ── Purchases ────────────────────────────────────────────────────────────── */

const purchase = envelope([], {
  purchases: [
    { receiptNumber: "GRN-1", supplierInvoiceNumber: "SUP/2026/44", supplierInvoiceAmount: 4000, totalAmount: 3950, paidAmount: 1000, paymentMode: "bank", supplier: { name: "Agarwal Wholesale" }, createdAt: new Date("2026-08-11T06:00:00.000Z") },
    { receiptNumber: "GRN-2", totalAmount: 2000, paidAmount: 0, supplier: null, createdAt: new Date("2026-08-11T06:00:00.000Z") },
  ],
});
assertWellFormed(purchase.xml);
for (const voucher of vouchersOf(purchase.xml)) assert.equal(balanceOf(voucher), 0, "a purchase voucher balances");

const firstPurchase = vouchersOf(purchase.xml)[0];
assert.ok(firstPurchase.includes('VCHTYPE="Purchase"'), "a goods receipt is a purchase voucher");
// The supplier's own invoice is the accounting document, not our internal GRN.
assert.ok(firstPurchase.includes("<VOUCHERNUMBER>SUP/2026/44</VOUCHERNUMBER>"), "the supplier invoice number is the voucher number");
assert.ok(firstPurchase.includes("<REFERENCE>GRN-1</REFERENCE>"), "the internal receipt stays as the reference");
assert.equal(ledgerAmount(firstPurchase, "Purchase"), -4000, "the supplier's invoice value is what enters the books");
assert.equal(ledgerAmount(firstPurchase, "Agarwal Wholesale"), 3000, "only the unpaid part becomes a payable");
assert.equal(ledgerAmount(firstPurchase, "Bank"), 1000, "the part paid at receipt leaves the bank");
assert.ok(declaredLedgers(purchase.xml).includes("Agarwal Wholesale"), "the supplier ledger is created");
assert.ok(purchase.xml.includes("<PARENT>Sundry Creditors</PARENT>"), "a supplier is a creditor, not a debtor");
// A receipt whose supplier row was deleted still has to post somewhere real.
assert.ok(declaredLedgers(purchase.xml).includes("Sundry Supplier"), "a receipt with no supplier still posts to a named ledger");

/* ── Input tax on purchases ───────────────────────────────────────────────── */

// The gap that made this export incomplete: purchases posted the whole supplier
// invoice as goods value, so the accountant re-keyed every one of them to claim
// input tax credit.
function receipt(overrides = {}) {
  return {
    id: "grn_1", receiptNumber: "GRN-T1", supplierInvoiceNumber: "SUP/1",
    supplierInvoiceAmount: 4000, supplierInvoiceTax: 610, paidAmount: 0,
    supplier: { name: "Agarwal Wholesale", gstin: "27AAECS1234F1Z5" },
    createdAt: new Date("2026-08-11T06:00:00.000Z"),
    ...overrides,
  };
}

const localPurchase = envelope([], { purchases: [receipt()] });
assertWellFormed(localPurchase.xml);
const lp = vouchersOf(localPurchase.xml)[0];
assert.equal(balanceOf(lp), 0, "a purchase with input tax balances");
// Goods value is the residual, so it can never disagree with the invoice.
assert.equal(ledgerAmount(lp, "Purchase"), -3390, "goods value is the invoice less its tax");
assert.equal(ledgerAmount(lp, "Input CGST"), -305, "half the tax is central");
assert.equal(ledgerAmount(lp, "Input SGST"), -305, "half the tax is state");
assert.equal(ledgerAmount(lp, "Agarwal Wholesale"), 4000, "the supplier is owed the whole invoice");

// Input tax is a receivable from the government; netting it against Output would
// make the return impossible to reconcile.
assert.ok(!lp.includes("Output CGST"), "purchase tax must not touch the output ledgers");
assert.ok(declaredLedgers(localPurchase.xml).includes("Input CGST"), "the input ledger is declared");
assert.ok(localPurchase.xml.includes("<PARTYGSTIN>27AAECS1234F1Z5</PARTYGSTIN>"), "the supplier's GSTIN reaches the voucher");

// Jurisdiction runs the opposite way from a sale: the SUPPLIER is the
// counterparty, so it is their state that decides the split.
const interState = vouchersOf(envelope([], { purchases: [receipt({ supplier: { name: "Delhi Traders", gstin: "07AAECS1234F1Z5" } })] }).xml)[0];
assert.equal(ledgerAmount(interState, "Input IGST"), -610, "a supplier in another state charges integrated tax");
assert.equal(ledgerAmount(interState, "Input CGST"), 0, "no central tax on an inter-state purchase");
assert.equal(balanceOf(interState), 0, "an inter-state purchase balances");

// An unregistered supplier charges no GST to claim, and guessing "inter-state"
// would send the credit to the wrong government.
const noGstin = vouchersOf(envelope([], { purchases: [receipt({ supplier: { name: "Local Kirana", gstin: null } })] }).xml)[0];
assert.equal(ledgerAmount(noGstin, "Input IGST"), 0, "a supplier with no GSTIN is not assumed inter-state");
assert.equal(ledgerAmount(noGstin, "Input CGST"), -305, "it falls back to a local split");

// A receipt recorded before this feature existed has no tax and must post
// exactly as it did before.
const untaxed = vouchersOf(envelope([], { purchases: [receipt({ supplierInvoiceTax: 0 })] }).xml)[0];
assert.equal(ledgerAmount(untaxed, "Purchase"), -4000, "no tax recorded means the whole invoice is goods");
assert.ok(!untaxed.includes("Input CGST"), "no tax line is emitted when none was captured");
assert.equal(balanceOf(untaxed), 0, "an untaxed purchase still balances");

// Odd paise must reconstitute exactly, or the voucher cannot balance.
const oddTax = vouchersOf(envelope([], { purchases: [receipt({ supplierInvoiceAmount: 100, supplierInvoiceTax: 3.03 })] }).xml)[0];
assert.equal(balanceOf(oddTax), 0, "tax that cannot halve evenly still balances");

// Part-paid at receipt: the tender leg must not disturb the tax split.
const partPaidPurchase = vouchersOf(envelope([], { purchases: [receipt({ paidAmount: 1000, paymentMode: "bank" })] }).xml)[0];
assert.equal(ledgerAmount(partPaidPurchase, "Bank"), 1000, "what was paid leaves the bank");
assert.equal(ledgerAmount(partPaidPurchase, "Agarwal Wholesale"), 3000, "only the rest is payable");
assert.equal(balanceOf(partPaidPurchase), 0, "a part-paid taxed purchase balances");

const debitNote = envelope([], {
  purchaseReturns: [
    { returnNumber: "PR-1", totalAmount: 500, refundAmount: 200, supplierCreditAmount: 300, refundMode: "cash", supplier: { name: "Agarwal Wholesale" }, createdAt: new Date("2026-08-11T06:00:00.000Z") },
    { returnNumber: "PR-2", totalAmount: 500, refundAmount: 0, supplierCreditAmount: 500, refundMode: "supplier_credit", supplier: { name: "Agarwal Wholesale" }, createdAt: new Date("2026-08-11T06:00:00.000Z") },
  ],
});
assertWellFormed(debitNote.xml);
for (const voucher of vouchersOf(debitNote.xml)) assert.equal(balanceOf(voucher), 0, "a debit note balances");
const refunded = vouchersOf(debitNote.xml)[0];
assert.ok(refunded.includes('VCHTYPE="Debit Note"'), "a purchase return is a debit note");
assert.equal(ledgerAmount(refunded, "Purchase"), 500, "returned goods reverse the purchase");
assert.equal(ledgerAmount(refunded, "Cash"), -200, "cash refunded by the supplier comes back in");
assert.equal(ledgerAmount(refunded, "Agarwal Wholesale"), -300, "the rest reduces what we owe them");
// A credit-note settlement moves no money, so nothing may touch the cash book.
assert.equal(ledgerAmount(vouchersOf(debitNote.xml)[1], "Cash"), 0, "a supplier-credit return moves no cash");

/* ── A return hands the input tax credit back ─────────────────────────────── */

// The bug this closes: goods went back, the tax stayed claimed. The ledgers
// balanced either way, which is exactly why nothing looked wrong.
const taxedReturn = envelope([], {
  purchaseReturns: [{
    id: "pr_tax", returnNumber: "PR-T1", totalAmount: 1000, taxAmount: 180,
    refundAmount: 0, refundMode: "supplier_credit",
    supplier: { name: "Agarwal Wholesale", gstin: "27AAECS1234F1Z5" },
    createdAt: new Date("2026-08-11T06:00:00.000Z"),
  }],
});
assertWellFormed(taxedReturn.xml);
const tr = vouchersOf(taxedReturn.xml)[0];
assert.equal(balanceOf(tr), 0, "a return carrying tax balances");
assert.equal(ledgerAmount(tr, "Purchase"), 1000, "the goods leg reverses");
assert.equal(ledgerAmount(tr, "Input CGST"), 90, "half the tax goes back");
assert.equal(ledgerAmount(tr, "Input SGST"), 90, "the other half goes back");
// The payable moved by the tax-inclusive value on the purchase, so it has to
// come back the same way — 1000 goods + 180 tax.
assert.equal(ledgerAmount(tr, "Agarwal Wholesale"), -1180, "the supplier is debited the tax-inclusive value");

// Sign check: a purchase DEBITS the input ledgers, a return CREDITS them. Same
// sign on both would double the claim instead of unwinding it.
assert.ok(ledgerAmount(lp, "Input CGST") < 0 && ledgerAmount(tr, "Input CGST") > 0, "purchase and return move input tax in opposite directions");

// Buy then return the whole lot: the input ledgers must end flat.
const roundTrip = envelope([], {
  purchases: [receipt({ id: "rt_p", supplierInvoiceAmount: 1180, supplierInvoiceTax: 180 })],
  purchaseReturns: [{
    id: "rt_r", returnNumber: "PR-T2", totalAmount: 1000, taxAmount: 180,
    refundAmount: 0, refundMode: "supplier_credit",
    supplier: { name: "Agarwal Wholesale", gstin: "27AAECS1234F1Z5" },
    createdAt: new Date("2026-08-11T06:00:00.000Z"),
  }],
});
const netInputCgst = vouchersOf(roundTrip.xml).reduce((sum, voucher) => sum + ledgerAmount(voucher, "Input CGST"), 0);
const netPurchase = vouchersOf(roundTrip.xml).reduce((sum, voucher) => sum + ledgerAmount(voucher, "Purchase"), 0);
assert.equal(netInputCgst, 0, "a full return leaves no input tax claimed");
assert.equal(netPurchase, 0, "a full return leaves no purchase value");

// An inter-state supplier reverses out of IGST, never the local pair.
const interStateReturn = vouchersOf(envelope([], {
  purchaseReturns: [{
    id: "pr_is", returnNumber: "PR-T3", totalAmount: 1000, taxAmount: 180,
    refundAmount: 0, refundMode: "supplier_credit",
    supplier: { name: "Delhi Traders", gstin: "07AAECS1234F1Z5" },
    createdAt: new Date("2026-08-11T06:00:00.000Z"),
  }],
}).xml)[0];
assert.equal(ledgerAmount(interStateReturn, "Input IGST"), 180, "an inter-state return reverses integrated tax");
assert.equal(ledgerAmount(interStateReturn, "Input CGST"), 0, "and touches neither local ledger");

// Cash refunded alongside a taxed return still balances.
const refundedTaxed = vouchersOf(envelope([], {
  purchaseReturns: [{
    id: "pr_rf", returnNumber: "PR-T4", totalAmount: 1000, taxAmount: 180,
    refundAmount: 500, refundMode: "cash",
    supplier: { name: "Agarwal Wholesale", gstin: "27AAECS1234F1Z5" },
    createdAt: new Date("2026-08-11T06:00:00.000Z"),
  }],
}).xml)[0];
assert.equal(ledgerAmount(refundedTaxed, "Cash"), -500, "the refund comes back in cash");
assert.equal(ledgerAmount(refundedTaxed, "Agarwal Wholesale"), -680, "the rest comes off the payable");
assert.equal(balanceOf(refundedTaxed), 0, "a part-refunded taxed return balances");

// A return recorded before this existed carries no tax and posts as it did.
const untaxedReturn = vouchersOf(envelope([], {
  purchaseReturns: [{ id: "pr_none", returnNumber: "PR-T5", totalAmount: 1000, taxAmount: 0, refundAmount: 0, refundMode: "supplier_credit", supplier: { name: "Agarwal Wholesale" }, createdAt: new Date("2026-08-11T06:00:00.000Z") }],
}).xml)[0];
assert.ok(!untaxedReturn.includes("Input CGST"), "no tax leg when none was reversed");
assert.equal(ledgerAmount(untaxedReturn, "Agarwal Wholesale"), -1000, "the payable moves by the goods value alone");
assert.equal(balanceOf(untaxedReturn), 0, "an untaxed return still balances");

/* ── Receipts and payments ────────────────────────────────────────────────── */

const receipts = envelope([], {
  receipts: [
    { id: "clx0000000001", customerName: "Iqbal", amount: 300, mode: "cash", billNo: "KOS-2026-0001", businessDate: new Date("2026-08-11T06:00:00.000Z") },
    { id: "clx0000000002", customerName: "Iqbal", amount: 200, mode: "upi", note: "part payment", businessDate: new Date("2026-08-11T06:00:00.000Z") },
  ],
});
assertWellFormed(receipts.xml);
for (const voucher of vouchersOf(receipts.xml)) assert.equal(balanceOf(voucher), 0, "a receipt balances");
const cashReceipt = vouchersOf(receipts.xml)[0];
assert.ok(cashReceipt.includes('VCHTYPE="Receipt"'), "an udhar collection is a receipt voucher");
assert.equal(ledgerAmount(cashReceipt, "Cash"), -300, "collected cash comes into the till");
assert.equal(ledgerAmount(cashReceipt, "Iqbal"), 300, "the customer's balance comes down");
assert.equal(ledgerAmount(vouchersOf(receipts.xml)[1], "UPI Collections"), -200, "a UPI collection lands in the bank ledger");
assert.ok(declaredLedgers(receipts.xml).filter((name) => name === "Iqbal").length === 1, "one ledger for a customer paying twice");

const expenses = envelope([], {
  expenses: [
    { id: "clx0000000003", title: "August rent", category: "rent", amount: 12000, paymentMode: "bank", vendor: "Landlord", spentAt: new Date("2026-08-11T06:00:00.000Z") },
    { id: "clx0000000004", title: "Tea", category: "general", amount: 60, paymentMode: "cash", spentAt: new Date("2026-08-11T06:00:00.000Z") },
    { id: "clx0000000005", title: "Bulbs", category: "shop_upkeep", amount: 250, paymentMode: "cash", spentAt: new Date("2026-08-11T06:00:00.000Z") },
  ],
});
assertWellFormed(expenses.xml);
for (const voucher of vouchersOf(expenses.xml)) assert.equal(balanceOf(voucher), 0, "an expense payment balances");
const rent = vouchersOf(expenses.xml)[0];
assert.ok(rent.includes('VCHTYPE="Payment"'), "an expense is a payment voucher");
assert.equal(ledgerAmount(rent, "Rent"), -12000, "the expense hits its own category ledger");
assert.equal(ledgerAmount(rent, "Bank"), 12000, "the money leaves the account it was paid from");
// Categories become the P&L breakdown the shopkeeper already thinks in.
assert.ok(declaredLedgers(expenses.xml).includes("General Expenses"), "an uncategorised expense gets a general ledger");
assert.ok(declaredLedgers(expenses.xml).includes("Shop Upkeep"), "a snake_case category becomes a readable ledger name");
assert.ok(expenses.xml.includes("<PARENT>Indirect Expenses</PARENT>"), "expense ledgers sit under indirect expenses");

/* ── A full book in one envelope ──────────────────────────────────────────── */

const fullBook = envelope([bill({ billNo: "F-1", customerName: "Iqbal", creditAmount: 105 })], {
  purchases: [{ receiptNumber: "GRN-9", totalAmount: 1000, paidAmount: 0, supplier: { name: "Agarwal Wholesale" }, createdAt: new Date("2026-08-11T06:00:00.000Z") }],
  purchaseReturns: [{ returnNumber: "PR-9", totalAmount: 100, refundAmount: 0, refundMode: "supplier_credit", supplier: { name: "Agarwal Wholesale" }, createdAt: new Date("2026-08-11T06:00:00.000Z") }],
  receipts: [{ id: "clx0000000006", customerName: "Iqbal", amount: 105, mode: "cash", businessDate: new Date("2026-08-11T06:00:00.000Z") }],
  expenses: [{ id: "clx0000000007", title: "Tea", category: "general", amount: 60, paymentMode: "cash", spentAt: new Date("2026-08-11T06:00:00.000Z") }],
});
assertWellFormed(fullBook.xml);
assert.equal(fullBook.count, 5, "every document type produces a voucher");
assert.deepEqual(fullBook.counts, { sales: 1, purchases: 1, purchaseReturns: 1, receipts: 1, expenses: 1, production: 0 }, "the caller can see what went in");
for (const voucher of vouchersOf(fullBook.xml)) {
  const number = /<VOUCHERNUMBER>([^<]*)</.exec(voucher)[1];
  assert.equal(balanceOf(voucher), 0, `voucher ${number} does not balance`);
}

// The whole point of masters-first: nothing in a mixed book may reference a
// ledger the envelope forgot, and Iqbal must appear once despite being both a
// debtor on the sale and the payer on the receipt.
const fullDeclared = new Set([...declaredLedgers(fullBook.xml), "Cash"]);
for (const voucher of vouchersOf(fullBook.xml)) {
  for (const ledger of ledgerNamesIn(voucher)) {
    assert.ok(fullDeclared.has(ledger), `mixed book names an undeclared ledger: ${ledger}`);
  }
}
assert.equal(declaredLedgers(fullBook.xml).filter((name) => name === "Iqbal").length, 1, "one ledger for a party appearing in two voucher types");
assert.ok(fullBook.xml.indexOf("<LEDGER ") < fullBook.xml.indexOf("<VOUCHER "), "masters still lead in a mixed book");

/* ── Empty range ──────────────────────────────────────────────────────────── */

const empty = envelope([]);
assertWellFormed(empty.xml);
assert.equal(empty.count, 0, "an empty range exports no vouchers");
assert.ok(empty.xml.includes("<REQUESTDATA></REQUESTDATA>"), "an empty range is still a valid import file");

/* ── Voucher identity, so a re-send is not a second voucher ───────────────── */

// Derived, never random: re-exporting last month has to produce byte-identical
// identifiers, or "send again" quietly doubles that month's turnover in Tally.
assert.equal(
  remoteVoucherId("shop_1", "sale", "bill_1"),
  remoteVoucherId("shop_1", "sale", "bill_1"),
  "the same document always has the same identity",
);
assert.notEqual(remoteVoucherId("shop_1", "sale", "bill_1"), remoteVoucherId("shop_1", "sale", "bill_2"), "two bills are two vouchers");
// A sale and its return share nothing but the bill row they came from.
assert.notEqual(remoteVoucherId("shop_1", "sale", "bill_1"), remoteVoucherId("shop_1", "sales_return", "bill_1"), "a return is not its own sale");
// Two shops importing into one Tally company must not overwrite each other.
assert.notEqual(remoteVoucherId("shop_1", "sale", "bill_1"), remoteVoucherId("shop_2", "sale", "bill_1"), "identity is per shop");
assert.match(remoteVoucherId("shop_1", "sale", "bill_1"), /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/, "Tally expects a GUID-shaped remote id");

const identified = buildTallyEnvelope({
  companyName: "Test Shop", shopId: "shop_1", sellerStateCode: "27", timeZone: TZ,
  bills: [bill({ id: "bill_1", billNo: "X-1" }), bill({ id: "bill_2", billNo: "X-2", billType: "sales_return" })],
  expenses: [{ id: "exp_1", title: "Tea", category: "general", amount: 60, paymentMode: "cash", spentAt: new Date("2026-08-11T06:00:00.000Z") }],
});
assertWellFormed(identified.xml);
assert.equal(identified.documents.length, 3, "every voucher is reported to the caller");
assert.deepEqual(
  identified.documents.map((document) => document.type),
  ["sale", "sales_return", "expense"],
  "a return is reported as its own kind so it is tracked separately",
);
// What the caller records as sent must be exactly what is in the envelope.
for (const document of identified.documents) {
  assert.ok(identified.xml.includes(`REMOTEID="${document.remoteId}"`), `envelope carries the id reported for ${document.voucherNumber}`);
  assert.equal(document.remoteId, remoteVoucherId("shop_1", document.type, document.id), "reported identity matches the derivation");
}
assert.equal(new Set(identified.documents.map((d) => d.remoteId)).size, 3, "no two vouchers share an identity");

/* ── How much tax a return hands back (guarded at the service) ────────────── */

// The proportion is taken on GOODS value, not the invoice total, so it does not
// drift with how much tax the invoice carried. Source-asserted because the
// arithmetic lives inside a transaction that needs a database to exercise.
const returnsService = fs.readFileSync(new URL("../src/modules/purchase-returns/purchaseReturns.service.js", import.meta.url), "utf8");
assert.match(returnsService, /function reversedInputTax\(/, "the reversal has a named derivation");
assert.match(returnsService, /invoiceTotal - invoiceTax/, "the share is taken on goods value, not the tax-inclusive total");
assert.match(returnsService, /Math\.min\(1,\s*Math\.max\(0,/, "the share is clamped so a return cannot hand back more than was claimed");
assert.match(returnsService, /taxAmount,\s*supplierCreditAmount/, "the derived tax is persisted on the return");
assert.match(returnsService, /moneyShadows\(\{ totalAmount, taxAmount/, "and carries its paise shadow like every other money column");

// Replicated here so the proportional rule itself is pinned, not just its shape.
const shareOf = (invoiceTotal, invoiceTax, returned) => {
  const goods = round2(invoiceTotal - invoiceTax);
  if (invoiceTax <= 0 || goods <= 0) return 0;
  return round2(invoiceTax * Math.min(1, Math.max(0, returned / goods)));
};
assert.equal(shareOf(1180, 180, 1000), 180, "returning everything hands back all the tax");
assert.equal(shareOf(1180, 180, 500), 90, "returning half hands back half");
assert.equal(shareOf(1180, 180, 0), 0, "returning nothing hands back nothing");
assert.equal(shareOf(1000, 0, 1000), 0, "an untaxed purchase reverses no tax");
// A return can never exceed the purchase, but the clamp must hold if data ever says otherwise.
assert.equal(shareOf(1180, 180, 99999), 180, "the reversal is capped at what was claimed");
assert.equal(shareOf(180, 180, 100), 0, "a total that is entirely tax leaves no goods value to apportion");

/* ── Which books the caller asked for ─────────────────────────────────────── */

const parseQuery = (input) => tallyExportQuerySchema.safeParse(input);

// Sales-only would leave the accountant re-keying every purchase and
// collection, which is the whole problem this export exists to remove.
assert.deepEqual(parseQuery({}).data.include, ["sales", "purchases", "returns", "receipts", "expenses", "production"], "the default is the whole book");
assert.deepEqual(parseQuery({ include: "sales,expenses" }).data.include, ["sales", "expenses"], "a subset is respected");
assert.deepEqual(parseQuery({ include: " Sales , SALES ,expenses " }).data.include, ["sales", "expenses"], "casing, padding and repeats are tolerated");

// A typo must not silently export less than the shopkeeper believes it did.
assert.equal(parseQuery({ include: "sales,payroll" }).success, false, "an unknown document type is rejected, not ignored");
assert.equal(parseQuery({ include: "" }).success, false, "exporting nothing is a mistake worth reporting");

// z.coerce.boolean() reads the string "false" as true, which would turn the
// stock-item opt-in into an opt-out for anyone passing it explicitly.
assert.equal(parseQuery({ inventory: "false" }).data.inventory, false, '"false" must mean false');
assert.equal(parseQuery({ inventory: "1" }).data.inventory, true, '"1" must mean true');

const factory = buildTallyEnvelope({
  companyName: "Test Shop", shopId: "shop_1", timeZone: TZ,
  productionRuns: [{
    id: "run_1", runNumber: "PR-001", finishedBatchNumber: "FG-001", completedAt: new Date("2026-08-12T06:00:00.000Z"),
    consumptions: [{ productId: "raw_1", productName: "Raw turmeric", baseUnit: "kg", actualBaseQty: 100, stockValue: 10000 }],
    outputs: [{ productId: "fg_1", productName: "Turmeric powder", baseUnit: "kg", quantityBaseQty: 95, stockValue: 10000 }],
  }],
});
assertWellFormed(factory.xml);
assert.equal(factory.count, 1);
assert.equal(factory.documents[0].type, "production");
assert.match(factory.xml, /VCHTYPE="Stock Journal"/);
assert.match(factory.xml, /<ACTUALQTY>-100 kg<\/ACTUALQTY>/);
assert.match(factory.xml, /<ACTUALQTY>95 kg<\/ACTUALQTY>/);
assert.match(factory.xml, /<AMOUNT>-10000\.00<\/AMOUNT>/);
assert.match(factory.xml, /<AMOUNT>10000\.00<\/AMOUNT>/);

/* ── Bill selection (guarded at the query, so assert the query) ───────────── */

// Soft-deleting a bill sets deletedAt but leaves status "active", so filtering
// on status alone would export bills the shopkeeper deleted.
const service = fs.readFileSync(new URL("../src/modules/integrations/integrations.service.js", import.meta.url), "utf8");
const where = /where: \{ shopId, status: "active".*/.exec(service);
assert.ok(where, "the Tally export must still have an explicit bill filter");
assert.ok(where[0].includes("deletedAt: null"), "the export must exclude soft-deleted bills");
assert.ok(where[0].includes("businessDate:"), "the export must range on the business date");
assert.ok(!where[0].includes("createdAt:"), "the export must not range on the sync time");
assert.ok(where[0].includes('billType: { not: "estimate" }'), "estimates are not tax documents and stay out of the books");

assert.deepEqual(parseTallyImportResponse("<RESPONSE><CREATED>2</CREATED><ALTERED>1</ALTERED><IGNORED>0</IGNORED><ERRORS>0</ERRORS></RESPONSE>", 3), { created: 2, altered: 1, ignored: 0 });
assert.throws(() => parseTallyImportResponse("<RESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Unknown ledger</LINEERROR></RESPONSE>", 1), /Unknown ledger/);
assert.throws(() => parseTallyImportResponse("<RESPONSE><CREATED>1</CREATED><ERRORS>0</ERRORS></RESPONSE>", 2), /acknowledged 1 of 2/);

console.log("tally-voucher.examples.js: all assertions passed");
