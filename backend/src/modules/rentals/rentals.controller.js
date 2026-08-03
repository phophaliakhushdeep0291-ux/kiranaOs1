import * as svc from "./rentals.service.js";
import { createAuditLog } from "../audit/audit.service.js";

export async function list(req, res, next) {
  try {
    const data = await svc.listRentals(req.shopId, {
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
      search: req.query.search ? String(req.query.search).trim() : undefined,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function summary(req, res, next) {
  try { res.json({ success: true, data: await svc.getRentalSummary(req.shopId) }); }
  catch (err) { next(err); }
}

export async function availability(req, res, next) {
  try {
    const data = await svc.getAvailability(req.shopId, {
      from: req.query.from,
      to: req.query.to,
      excludeBookingId: req.query.excludeBookingId ? String(req.query.excludeBookingId) : null,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function detail(req, res, next) {
  try { res.json({ success: true, data: await svc.getRental(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const booking = await svc.createRental(req.shopId, req.body, { userId: req.user?.userId });
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "RENTAL_BOOKED",
      entityType: "RentalBooking", entityId: booking.id,
      after: {
        id: booking.id, bookingNumber: booking.bookingNumber, customerName: booking.customerName,
        fromDate: booking.fromDateKey, toDate: booking.toDateKey, items: booking.items.length,
      },
      req,
    });
    res.status(201).json({ success: true, data: booking });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try { res.json({ success: true, data: await svc.updateRental(req.shopId, req.params.id, req.body) }); }
  catch (err) { next(err); }
}

export async function pickup(req, res, next) {
  try { res.json({ success: true, message: "Marked as picked up", data: await svc.markPickedUp(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

export async function markReturned(req, res, next) {
  try {
    const booking = await svc.markReturned(req.shopId, req.params.id, req.body ?? {});
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "RENTAL_RETURNED",
      entityType: "RentalBooking", entityId: booking.id,
      after: {
        id: booking.id, bookingNumber: booking.bookingNumber,
        returnedAt: booking.returnedAt, lateFee: booking.lateFee, damageCharge: booking.damageCharge,
      },
      req,
    });
    res.json({ success: true, message: "Booking closed and items back in stock", data: booking });
  } catch (err) { next(err); }
}

export async function cancel(req, res, next) {
  try {
    const booking = await svc.cancelRental(req.shopId, req.params.id, req.body ?? {});
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "RENTAL_CANCELLED",
      entityType: "RentalBooking", entityId: booking.id,
      after: { id: booking.id, bookingNumber: booking.bookingNumber, status: booking.status },
      req,
    });
    res.json({ success: true, message: "Booking cancelled", data: booking });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const booking = await svc.softDeleteRental(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "RENTAL_DELETED",
      entityType: "RentalBooking", entityId: booking.id,
      after: { id: booking.id, bookingNumber: booking.bookingNumber, deletedAt: booking.deletedAt },
      metadata: { softDelete: true }, req,
    });
    res.json({ success: true, message: "Booking moved to recycle bin", data: booking });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try { res.json({ success: true, message: "Booking restored", data: await svc.restoreRental(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}
