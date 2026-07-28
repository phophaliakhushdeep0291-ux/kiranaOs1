import * as service from "./compliance.service.js";
import { requestLocationId } from "../stores/location-context.service.js";

export async function readiness(req, res, next) {
  try { res.json({ success: true, data: await service.getReadiness(req.shopId) }); } catch (error) { next(error); }
}

export async function gstRegister(req, res, next) {
  try {
    const data = await service.getGstInvoiceRegister(req.shopId, { ...req.query, locationId: requestLocationId(req) });
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="gst-invoice-register-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(`\uFEFF${service.registerToCsv(data)}`);
    }
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
}

export async function gstr3bWorking(req, res, next) {
  try {
    const data = await service.getGstr3bWorkingPapers(req.shopId, { ...req.query, locationId: requestLocationId(req) });
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
}

export async function gstr1Working(req, res, next) {
  try {
    const data = await service.getGstr1WorkingPapers(req.shopId, { ...req.query, locationId: requestLocationId(req) });
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="gstr1-working-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(`\uFEFF${service.gstr1WorkingToCsv(data)}`);
    }
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
}

export async function hsnSummary(req, res, next) {
  try { res.json({ success: true, data: await service.getHsnCategorySummary(req.shopId) }); } catch (error) { next(error); }
}

export async function assignHsnCategory(req, res, next) {
  try { res.json({ success: true, data: await service.assignHsnToCategory(req.shopId, req.body, { userId: req.user?.userId }, req) }); } catch (error) { next(error); }
}

export async function sandboxEInvoice(req, res, next) {
  try { res.status(201).json({ success: true, data: await service.createSandboxEInvoice(req.shopId, req.params.billId), warning: "Sandbox only. No legal IRN was created." }); } catch (error) { next(error); }
}

export async function submitEInvoice(req, res, next) {
  try { res.status(201).json({ success: true, data: await service.submitEInvoice(req.shopId, req.params.billId) }); } catch (error) { next(error); }
}

export async function draftEWayBill(req, res, next) {
  try { res.status(201).json({ success: true, data: await service.createEWayBillDraft(req.shopId, req.params.billId, req.body), warning: "Transport record saved. No legal e-way bill number was created." }); } catch (error) { next(error); }
}

export async function submitEWayBill(req, res, next) {
  try { res.status(201).json({ success: true, data: await service.submitEWayBill(req.shopId, req.params.billId, req.body) }); } catch (error) { next(error); }
}
