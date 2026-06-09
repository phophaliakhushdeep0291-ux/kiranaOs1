export function normalizeProductName(name = "") {
  return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}

export function hasActiveDuplicateProductName(deletedProduct, activeProducts = []) {
  const targetName = normalizeProductName(deletedProduct?.name);
  if (!targetName) return false;

  return activeProducts.some((product) => {
    if (!product || product.id === deletedProduct.id) return false;
    return normalizeProductName(product.name) === targetName;
  });
}

export function getProductPermanentDeleteBlockReason({ stockLedgerCount = 0, purchaseHistoryCount = 0 } = {}) {
  if (stockLedgerCount > 0) {
    return "Product has stock ledger history";
  }

  if (purchaseHistoryCount > 0) {
    return "Product has purchase history";
  }

  return null;
}
