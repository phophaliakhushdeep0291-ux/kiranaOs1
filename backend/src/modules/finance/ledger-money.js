// The existing API accepts numeric minor units. Never silently round a BigInt
// into that contract; a report outside its safe range must fail visibly.
export function publicPaise(value) {
  const amount = BigInt(value);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw Object.assign(new Error("Accounting amount exceeds the supported report range"), {
      code: "ACCOUNTING_AMOUNT_OUT_OF_RANGE", status: 422,
    });
  }
  return Number(amount);
}
