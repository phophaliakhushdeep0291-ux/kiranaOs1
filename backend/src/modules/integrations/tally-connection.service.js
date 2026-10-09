import crypto from "node:crypto";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { serializableTransaction } from "../../lib/transactions.js";
import { createAuditLog } from "../audit/audit.service.js";

export async function getTallyConnection(shopId) {
  const [shop, posted, last] = await Promise.all([
    db.shop.findUnique({ where: { id: shopId } }),
    db.tallyPost.count({ where: { shopId } }),
    db.tallyPost.findFirst({ where: { shopId }, orderBy: { postedAt: "desc" } }),
  ]);
  if (!shop) throw new AppError("Shop not found", 404);
  return { company: shop.tallyCompanyGuid ? { guid: shop.tallyCompanyGuid, name: shop.tallyCompanyName, currencyCode: shop.currencyCode } : null,
    currencyCode: shop.currencyCode, posted, lastPostedAt: last?.postedAt ?? null };
}

export async function connectTally(shopId, company, actor = {}) {
  return serializableTransaction(async (tx) => {
    const shop = await tx.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new AppError("Shop not found", 404);
    if (company.currencyCode !== shop.currencyCode) throw new AppError("The Tally company's base currency must match this shop", 409, "TALLY_CURRENCY_MISMATCH");
    // Binding is deliberately stable, including while another counter is sending
    // a prepared batch. Changing a destination needs a reconciled migration.
    if (shop.tallyCompanyGuid && (shop.tallyCompanyGuid !== company.guid || shop.tallyCompanyName !== company.name)) {
      throw new AppError("This shop is linked to another Tally company. Reconcile the existing books before changing the destination.", 409, "TALLY_COMPANY_LOCKED");
    }
    const prior = await tx.tallyPost.count({ where: { shopId } });
    if (!shop.tallyCompanyGuid && prior > 0 && company.name !== shop.name) {
      throw new AppError("Earlier transfers used the shop name as the Tally company. Select that company or reconcile the previous transfers first.", 409, "TALLY_LEGACY_COMPANY_MISMATCH");
    }
    await tx.shop.update({ where: { id: shopId }, data: { tallyCompanyGuid: company.guid, tallyCompanyName: company.name } });
    const audit = await createAuditLog({ shopId, userId: actor.userId ?? null, action: "TALLY_COMPANY_CONNECTED", entityType: "Shop", entityId: shopId,
      after: company, req: actor.req ?? null, client: tx });
    if (!audit) throw new AppError("Tally connection could not be audited", 503, "INTEGRATION_AUDIT_UNAVAILABLE");
    return { company };
  });
}

// Binds a confirmation to exactly the server-built documents and company. The
// receipt is retained by the counter after import, so confirmation can be retried
// without sending the money entries to Tally again. No expiry: an offline counter
// may reconnect much later; this receipt grants no new financial-write access.
export function tallyManifestSignature(shopId, companyGuid, documents) {
  return crypto.createHmac("sha256", env.JWT_SECRET)
    .update(JSON.stringify(["tally-confirmation-v1", shopId, companyGuid, documents])).digest("hex");
}
export function verifyTallyManifest(shopId, companyGuid, documents, signature) {
  const expected = Buffer.from(tallyManifestSignature(shopId, companyGuid, documents));
  const actual = Buffer.from(String(signature ?? ""));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new AppError("The Tally transfer confirmation is invalid. Reload the prepared transfer.", 409, "TALLY_MANIFEST_INVALID");
  }
}
