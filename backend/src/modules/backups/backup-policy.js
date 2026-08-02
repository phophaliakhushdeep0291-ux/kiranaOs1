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
  "SupportRequest", "DeviceHealthSnapshot", "Subscription", "PaymentTransaction",
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
]);

export const RESTORABLE_CHILD_MODELS = Object.freeze({
  BillItem: { relation: "bill", where: { bill: { shopId: "__SHOP_ID__" } } },
  StockCountLine: { relation: "session", where: { session: { shopId: "__SHOP_ID__" } } },
  StockTransferItem: { relation: "transfer", where: { transfer: { shopId: "__SHOP_ID__" } } },
  PurchaseOrderItem: { relation: "purchaseOrder", where: { purchaseOrder: { shopId: "__SHOP_ID__" } } },
  PurchaseReceiptItem: { relation: "receipt", where: { receipt: { shopId: "__SHOP_ID__" } } },
  PurchaseReturnItem: { relation: "purchaseReturn", where: { purchaseReturn: { shopId: "__SHOP_ID__" } } },
  BillItemLotAllocation: { relation: "billItem", where: { billItem: { bill: { shopId: "__SHOP_ID__" } } } },
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
