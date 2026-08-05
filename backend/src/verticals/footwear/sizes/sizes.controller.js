import * as svc from "./sizes.service.js";
import { convertSize, sizeLadder } from "./size-systems.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

export async function list(req, res, next) {
  try {
    const data = await svc.listSizeRuns(req.shopId, {
      search: req.query.search ? String(req.query.search).trim() : undefined,
      onlyBroken: String(req.query.onlyBroken ?? "") === "true",
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function summary(req, res, next) {
  try { res.json({ success: true, data: await svc.getSizeRunSummary(req.shopId) }); }
  catch (err) { next(err); }
}

export async function detail(req, res, next) {
  try { res.json({ success: true, data: await svc.getSizeRun(req.shopId, String(req.params.productId)) }); }
  catch (err) { next(err); }
}

export async function findBySize(req, res, next) {
  try {
    const data = await svc.findBySize(req.shopId, {
      system: req.query.system,
      value: req.query.value,
      gender: req.query.gender,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * The chart on its own, with no shop data in it.
 *
 * Useful before anything is profiled — a counter can still answer "what's a US 9
 * in UK?" on the first day, without having set up a single style.
 */
export async function convert(req, res, next) {
  try {
    const { system, value, gender = "unisex" } = req.query;
    res.json({
      success: true,
      data: {
        equivalents: convertSize(system, value, gender),
        ladder: sizeLadder(system, gender),
      },
    });
  } catch (err) { next(err); }
}

export async function setProfile(req, res, next) {
  try {
    const profile = await svc.setSizeProfile(req.shopId, String(req.params.productId), req.body);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "FOOTWEAR_SIZE_PROFILE_SET",
      entityType: "FootwearSizeProfile", entityId: profile.id,
      after: {
        productName: profile.productName,
        sizeSystem: profile.sizeSystem,
        gender: profile.gender,
      },
      req,
    });
    res.json({ success: true, message: "Size system saved", data: profile });
  } catch (err) { next(err); }
}
