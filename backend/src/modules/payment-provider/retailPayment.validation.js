export function validateRetailUpiPayment(intent, orderId, paymentId, payment, order = null) {
  const checks = [
    [payment?.id === paymentId, "payment id"],
    [payment?.order_id === orderId, "order id"],
    [Number(payment?.amount) === Number(intent?.amountPaise), "amount"],
    [String(payment?.currency || "").toUpperCase() === String(intent?.currency || "").toUpperCase(), "currency"],
    [String(payment?.status || "").toLowerCase() === "captured" && payment?.captured === true, "capture status"],
    [String(payment?.method || "").toLowerCase() === "upi", "payment method"],
  ];
  if (order) {
    checks.push(
      [order.id === orderId, "fetched order id"],
      [Number(order.amount) === Number(intent?.amountPaise), "fetched order amount"],
      [String(order.currency || "").toUpperCase() === String(intent?.currency || "").toUpperCase(), "fetched order currency"],
      [String(order.status || "").toLowerCase() === "paid", "fetched order status"],
    );
  }
  const failed = checks.find(([valid]) => !valid);
  return failed ? { valid: false, reason: `Retail UPI ${failed[1]} mismatch` } : { valid: true, reason: null };
}

export function validateRetailQrPayment(intent, qrCode, payment) {
  const notes = qrCode?.notes || {};
  const checks = [
    [intent?.checkoutMode === "dynamic_qr", "intent mode"],
    [qrCode?.id === intent?.providerQrCodeId, "QR id"],
    [qrCode?.type === "upi_qr", "QR type"],
    [qrCode?.usage === "single_use", "QR usage"],
    [qrCode?.fixed_amount === true, "fixed amount"],
    [Number(qrCode?.payment_amount) === Number(intent?.amountPaise), "QR amount"],
    [String(notes.intentId || "") === String(intent?.id || ""), "intent binding"],
    [String(notes.shopId || "") === String(intent?.shopId || ""), "shop binding"],
    [String(notes.locationId || "") === String(intent?.locationId || ""), "location binding"],
    [Boolean(payment?.id), "payment id"],
    [Number(payment?.amount) === Number(intent?.amountPaise), "payment amount"],
    [String(payment?.currency || "").toUpperCase() === String(intent?.currency || "INR").toUpperCase(), "payment currency"],
    [String(payment?.status || "").toLowerCase() === "captured" && payment?.captured === true, "capture status"],
    [String(payment?.method || "").toLowerCase() === "upi", "payment method"],
  ];
  const failed = checks.find(([valid]) => !valid);
  return failed ? { valid: false, reason: `Retail dynamic QR ${failed[1]} mismatch` } : { valid: true, reason: null };
}
