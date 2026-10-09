import test from "node:test";
import assert from "node:assert/strict";
import db from "../../src/db.js";
import { connectTally, getTallyConnection } from "../../src/modules/integrations/tally-connection.service.js";
import { buildTallyExport, markTallyPosted } from "../../src/modules/integrations/integrations.service.js";
import { confirmBill } from "../../src/modules/bills/bills.service.js";
import { createTenant, createProduct, billPayload } from "./factories.js";

test("Tally destination, signed confirmation and retry history remain tenant scoped", async () => {
  try {
    const tenant = await createTenant(db);
    const other = await createTenant(db);
    const product = await createProduct(db, tenant.shop.id, { stockBaseQty: 20, defaultPricePerRateUnit: 105 });
    const bill = await confirmBill(tenant.shop.id, { ...billPayload(product), clientBillId: "tally-connect-sale" }, { userId: tenant.owner.id });
    const query = { include: ["sales"], unsent: true };
    await assert.rejects(() => buildTallyExport(tenant.shop.id, query), { code: "TALLY_CONNECTION_REQUIRED" });
    const company = { guid: "test-tally-company", name: "Accountant & Retail Books", currencyCode: "INR" };
    await assert.rejects(() => connectTally(tenant.shop.id, { ...company, currencyCode: "AED" }), { code: "TALLY_CURRENCY_MISMATCH" });
    await connectTally(tenant.shop.id, company, { userId: tenant.owner.id });
    assert.deepEqual((await getTallyConnection(tenant.shop.id)).company, company);
    await assert.rejects(() => connectTally(tenant.shop.id, { ...company, guid: "other-tally-company" }), { code: "TALLY_COMPANY_LOCKED" });
    const transfer = await buildTallyExport(tenant.shop.id, query);
    assert.equal(transfer.count, 1); assert.equal(transfer.documents[0].id, bill.id);
    assert.match(transfer.vouchersXml, /Accountant &amp; Retail Books/);
    assert.doesNotMatch(transfer.vouchersXml, /<LEDGER NAME=/);
    assert.doesNotMatch(transfer.mastersXml, /<VOUCHER /);
    assert.match(transfer.mastersXml, /<REPORTNAME>All Masters<\/REPORTNAME>/);
    const receipt = { companyGuid: company.guid, signature: transfer.signature };
    await assert.rejects(() => markTallyPosted(tenant.shop.id, transfer.documents, {}, { ...receipt, signature: "0".repeat(64) }), { code: "TALLY_MANIFEST_INVALID" });
    await assert.rejects(() => markTallyPosted(tenant.shop.id, [{ ...transfer.documents[0], id: "foreign-bill" }], {}, receipt), { code: "TALLY_MANIFEST_INVALID" });
    await connectTally(other.shop.id, company);
    await assert.rejects(() => markTallyPosted(other.shop.id, transfer.documents, {}, receipt), { code: "TALLY_MANIFEST_INVALID" });
    assert.equal((await getTallyConnection(tenant.shop.id)).posted, 0);
    await markTallyPosted(tenant.shop.id, transfer.documents, {}, receipt);
    await markTallyPosted(tenant.shop.id, transfer.documents, {}, receipt);
    assert.equal((await getTallyConnection(tenant.shop.id)).posted, 1);
    const repeat = await buildTallyExport(tenant.shop.id, query);
    assert.equal(repeat.count, 0); assert.equal(repeat.skipped, 1);
    assert.equal((await buildTallyExport(tenant.shop.id, { ...query, unsent: false })).count, 1);
    await db.bill.update({ where: { id: bill.id }, data: { currencyCode: "AED" } });
    await assert.rejects(() => buildTallyExport(tenant.shop.id, query), { code: "TALLY_CURRENCY_MISMATCH" });
  } finally { await db.$disconnect(); }
});
