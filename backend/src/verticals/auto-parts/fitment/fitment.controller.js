import * as svc from "./fitment.service.js";

export async function findForVehicle(req, res, next) {
  try {
    const data = await svc.findPartsForVehicle(req.shopId, {
      make: req.query.make,
      model: req.query.model,
      variant: req.query.variant,
      year: req.query.year,
      search: req.query.search ? String(req.query.search).trim() : undefined,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function vehicleOptions(req, res, next) {
  try {
    res.json({ success: true, data: await svc.getVehicleOptions(req.shopId, { make: req.query.make }) });
  } catch (err) { next(err); }
}

export async function byPartNumber(req, res, next) {
  try {
    res.json({ success: true, data: await svc.findByPartNumber(req.shopId, req.params.partNumber) });
  } catch (err) { next(err); }
}

export async function summary(req, res, next) {
  try { res.json({ success: true, data: await svc.getFitmentSummary(req.shopId) }); }
  catch (err) { next(err); }
}

export async function list(req, res, next) {
  try {
    const data = await svc.listFitments(req.shopId, {
      make: req.query.make,
      model: req.query.model,
      search: req.query.search ? String(req.query.search).trim() : undefined,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function forProduct(req, res, next) {
  try {
    const [fitments, references] = await Promise.all([
      svc.listFitmentsForProduct(req.shopId, String(req.params.productId)),
      svc.listCrossReferences(req.shopId, String(req.params.productId)),
    ]);
    res.json({ success: true, data: { fitments, references } });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createFitment(req.shopId, req.body) }); }
  catch (err) { next(err); }
}

export async function createBulk(req, res, next) {
  try {
    const { created, skipped } = await svc.createFitmentsBulk(req.shopId, req.body);
    res.status(201).json({
      success: true,
      message: skipped.length
        ? `${created.length} added, ${skipped.length} already recorded`
        : `${created.length} vehicle${created.length === 1 ? "" : "s"} added`,
      data: { created, skipped },
    });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try { res.json({ success: true, data: await svc.updateFitment(req.shopId, req.params.id, req.body) }); }
  catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try { res.json({ success: true, message: "Fitment removed", data: await svc.deleteFitment(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

export async function createReference(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createCrossReference(req.shopId, req.body) }); }
  catch (err) { next(err); }
}

export async function updateReference(req, res, next) {
  try { res.json({ success: true, data: await svc.updateCrossReference(req.shopId, req.params.id, req.body) }); }
  catch (err) { next(err); }
}

export async function removeReference(req, res, next) {
  try { res.json({ success: true, message: "Alternative removed", data: await svc.deleteCrossReference(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}
