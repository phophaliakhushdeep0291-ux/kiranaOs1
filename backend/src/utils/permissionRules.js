export function doesBodyTouchProtectedFields(body = {}, protectedFields = []) {
  return protectedFields.some((field) => Object.prototype.hasOwnProperty.call(body, field));
}

export function purchaseChangesProtectedPrice(body = {}) {
  return body.updateCost !== false || body.updateMinPrice === true;
}
