import * as reservations from "./reservations.service.js";
import * as shifts from "./shifts.service.js";
import * as kiosk from "./kiosk.service.js";
import * as guestRequests from "./guest-requests.service.js";

export async function listReservations(req, res, next) {
  try { res.json({ success: true, data: await reservations.listReservations(req.shopId, req.query) }); } catch (error) { next(error); }
}

export async function createReservation(req, res, next) {
  try {
    const data = await reservations.createReservation(req.shopId, req.body, req.user, req);
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function updateReservation(req, res, next) {
  try { res.json({ success: true, data: await reservations.updateReservation(req.shopId, req.params.id, req.body, req.user, req) }); } catch (error) { next(error); }
}

export async function setReservationStatus(req, res, next) {
  try { res.json({ success: true, data: await reservations.setReservationStatus(req.shopId, req.params.id, req.body.status, req.user, req) }); } catch (error) { next(error); }
}

export async function listShifts(req, res, next) {
  try { res.json({ success: true, data: await shifts.listShifts(req.shopId, req.query) }); } catch (error) { next(error); }
}

export async function roster(req, res, next) {
  try { res.json({ success: true, data: await shifts.getRoster(req.shopId, req.query) }); } catch (error) { next(error); }
}

export async function createShift(req, res, next) {
  try {
    const data = await shifts.createShift(req.shopId, req.body, req.user, req);
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function updateShift(req, res, next) {
  try { res.json({ success: true, data: await shifts.updateShift(req.shopId, req.params.id, req.body, req.user, req) }); } catch (error) { next(error); }
}

export async function listTerminals(req, res, next) {
  try { res.json({ success: true, data: await kiosk.listTerminals(req.shopId) }); } catch (error) { next(error); }
}

export async function createTerminal(req, res, next) {
  try {
    const data = await kiosk.createTerminal(req.shopId, req.body, req.user, req);
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function updateTerminal(req, res, next) {
  try { res.json({ success: true, data: await kiosk.updateTerminal(req.shopId, req.params.id, req.body, req.user, req) }); } catch (error) { next(error); }
}

export async function listGuestRequests(req, res, next) {
  try { res.json({ success: true, data: await guestRequests.listGuestRequests(req.shopId, req.query) }); } catch (error) { next(error); }
}

export async function setGuestRequestStatus(req, res, next) {
  try { res.json({ success: true, data: await guestRequests.setGuestRequestStatus(req.shopId, req.params.id, req.body.status, req.user, req) }); } catch (error) { next(error); }
}

// Public: called by the unattended screen itself, which has no session.
export async function resolveTerminal(req, res, next) {
  try { res.json({ success: true, data: await kiosk.resolveTerminal(req.params.shopId, req.params.terminalCode) }); } catch (error) { next(error); }
}
