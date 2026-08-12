import assert from "assert";
import fs from "fs";
import { buildTallyEnvelope, splitGst } from "../src/modules/integrations/tally-voucher.js";
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

/* ── Masters: every ledger a voucher names must be declared ───────────────── */

const mixed = envelope([
  bill({ billNo: "M-1", customerName: "Sharma & Sons", buyerGstin: "27AAECS1234F1Z5" }),
  bill({ billNo: "M-2", customerName: "Sharma & Sons" }),
  bill({ billNo: "M-3", customerName: "Walk-in" }),
  bill({ billNo: "M-4", customerName: "Rao Traders", buyerStateCode: "29", gst: 18, subtotal: 118, grandTotal: 118 }),
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

/* ── Empty range ──────────────────────────────────────────────────────────── */

const empty = envelope([]);
assertWellFormed(empty.xml);
assert.equal(empty.count, 0, "an empty range exports no vouchers");
assert.ok(empty.xml.includes("<REQUESTDATA></REQUESTDATA>"), "an empty range is still a valid import file");

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

console.log("tally-voucher.examples.js: all assertions passed");
