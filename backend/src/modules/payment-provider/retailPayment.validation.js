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
