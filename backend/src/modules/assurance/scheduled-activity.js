// Shared by tenant discovery and record collection. A late entry must qualify
// for both, even when its business date predates the scheduler window.
export function scheduledActivity(range) {
  const changed = { OR: [{ createdAt: range }, { updatedAt: range }] };
  return {
    bills: { OR: [...changed.OR, { payments: { some: { createdAt: range } } }] },
    expenses: { ...changed, deletedAt: null },
    purchaseReceipts: { createdAt: range },
    purchaseHistory: { ...changed, purchaseReceiptId: null },
    dailyClosingSnapshots: changed,
    offlineSyncEvents: changed,
    customers: { OR: [...changed.OR, { udharLedger: { some: { createdAt: range } } }] },
    products: { OR: [...changed.OR, { stockLedger: { some: { createdAt: range } } }] },
  };
}
