// Portable restore replaces business history but preserves the credentials,
// subscriptions, device identity, integration secrets, active sync transport,
// support telemetry, and the backup/maintenance control plane of this install.
export const PRESERVED_SHOP_MODELS = Object.freeze([
  "ShopMaintenanceLock", "User", "AuthToken", "Session", "UserLocationAccess",
  "ReportExportJob", "BackupArtifact", "OfflineSyncEvent", "SyncConflict",
  "SyncCommand", "ChangeLog", "SyncIdMapping", "ErrorGroup", "ErrorEvent",
  // Behavioural telemetry and its counter read model sit with the other
  // observability tables, not with business history: a portable restore must not
  // overwrite what this install actually observed with an older device's record
  // of it, and stale personalization counters are worse than the live ones.
  "ActivityEvent", "ActivityAggregate",
  "SupportRequest",
  // Remote support is a live, time-boxed consent grant and the command queue it
  // authorises. Both belong to this install, not to business history: restoring
  // an older backup must not resurrect a session the owner already revoked, nor
  // re-queue repair commands a device has already run or refused.
  "SupportSession", "DeviceCommand",
  "DeviceHealthSnapshot", "Subscription", "OnboardingPurchase", "PaymentTransaction",
  "PaymentProviderEvent", "IntegrationApiKey", "WebhookEndpoint", "WebhookDelivery",
  "Device", "DeviceReplacementChallenge", "DeviceLicense",
]);

export const RESTORABLE_SHOP_MODELS = Object.freeze([
  "PricingRule", "ProductSellingUnit", "PricingDecisionEvent", "CustomerOrder",
  "BillCounter", "Product", "Customer", "Bill", "Payment", "RetailPaymentIntent",
  "StoreLocation", "LocationStock", "StockCountSession", "GiftCard",
  "GiftCardTransaction", "StockTransfer", "TransferDocumentCounter",
  "LoyaltyProgram", "LoyaltyAccount", "LoyaltyTransaction", "ComplianceDocument",
  "StockLedger", "UdharLedger", "Supplier", "Expense", "Offer", "PurchaseHistory",
  "PurchaseOrder", "PurchaseReceipt", "PurchaseReturn", "InventoryLot", "AiActionLog",
  "AuditLog", "DailyClosingSnapshot", "ReminderTemplate", "ReminderLog",
  "FinancialLedger", "BankStatementImport", "BankStatementTransaction",
  "BankReconciliationAllocation", "BankReconciliationEvent", "AuditRule", "AuditRun",
  "AuditEvaluation", "AuditFinding", "AuditFindingRule", "AuditEvidenceRequirement",
  "AuditEvidence", "AuditFindingStatusHistory", "AuditReview", "AuditCase",
  "AuditCaseFinding", "AuditBaseline",
  // A booking is business history — who took which garment, for which days, and
  // what money is still owed on it. It restores with the rest of the ledger.
  "RentalBooking",
  // ── Trade registers ────────────────────────────────────────────────────────
  // Every one of these is the shop's own record of its trade, not this
  // install's: what was dispensed, which serial went to whom, which part fits
  // which car, what a school asked for, what a showroom promised to deliver,
  // and which tester is open on the counter. A restore that dropped them would
  // hand a pharmacy back its bills with no prescription register behind them.
  //
  // They are listed because the test derives the model set from the schema
  // rather than from a hand-kept list — so a trade shipping a new table cannot
  // quietly leave it out of backup and discover it missing at restore time.
  "Prescription", "ProductUnit", "PartFitment", "PartCrossReference",
  "FootwearSizeProfile", "BookList", "FurnitureOrder", "TesterUnit",
  // The restaurant floor and its recipe book. The floor is what every printed
  // table QR resolves against — losing it turns every sticker in the room into
  // a dead link — and a recipe is what makes the kitchen's stock figures true.
  //
  // A kitchen ticket is business history too, not install state: it is the
  // record of what was actually cooked, which is the answer when a guest
  // disputes a line on the bill. It is short-lived on the rail, but a restore
  // that dropped it would leave the sale with nothing behind it.
  "RestaurantTable", "DishRecipeComponent", "KitchenTicket",
  // Menu add-ons are durable shop configuration. Groups define the selection
  // rule, options carry prices/ingredient links, and the join decides which
  // dishes offer them; losing any one of the three changes the live menu.
  "MenuAddonGroup", "MenuAddonOption", "ProductAddonGroup",
]);

export const RESTORABLE_CHILD_MODELS = Object.freeze({
  BillItem: { relation: "bill", where: { bill: { shopId: "__SHOP_ID__" } } },
  StockCountLine: { relation: "session", where: { session: { shopId: "__SHOP_ID__" } } },
  StockTransferItem: { relation: "transfer", where: { transfer: { shopId: "__SHOP_ID__" } } },
  PurchaseOrderItem: { relation: "purchaseOrder", where: { purchaseOrder: { shopId: "__SHOP_ID__" } } },
  PurchaseReceiptItem: { relation: "receipt", where: { receipt: { shopId: "__SHOP_ID__" } } },
  PurchaseReturnItem: { relation: "purchaseReturn", where: { purchaseReturn: { shopId: "__SHOP_ID__" } } },
  BillItemLotAllocation: { relation: "billItem", where: { billItem: { bill: { shopId: "__SHOP_ID__" } } } },
  // Carries no shopId of its own, so the tenant scan cannot see it. Without this
  // rule a restored booking would come back with no line items — no record of
  // what actually went out of the door.
  RentalBookingItem: { relation: "booking", where: { booking: { shopId: "__SHOP_ID__" } } },
  // Sold add-ons are receipt history and intentionally carry no shopId. Restore
  // them through their bill item so a reprinted bill still shows exactly what
  // the guest selected and paid for.
  BillItemAddon: { relation: "billItem", where: { billItem: { bill: { shopId: "__SHOP_ID__" } } } },
});

export const CREDENTIAL_FIELDS_ALWAYS_PRESERVED = Object.freeze([
  "passwordHash", "pinHash", "tokenHash", "refreshTokenHash", "fingerprintHash",
  "secretHash", "webhookSecret", "apiKeyHash",
]);

export function prismaDelegateName(modelName) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

export function childWhereForShop(template, shopId) {
  return JSON.parse(JSON.stringify(template).replaceAll("__SHOP_ID__", shopId));
}
