/**
 * Files that still contain user-visible English written straight into the component.
 *
 * Every path here is a screen a shopkeeper can still hit an untranslated string on. The
 * list is the honest record of that debt, and the check in
 * i18n-hardcoded-strings.test.ts enforces STRICTLY on every file not listed — so the
 * rule is real today instead of waiting for a full migration.
 *
 * The only correct direction is down. Translate a file, delete its line. A companion
 * test fails if a listed file no longer exists or no longer has any hardcoded string,
 * so the list cannot rot or be padded.
 *
 * Counted at 2662 strings across 138 files. The previous count (2791/145) was taken
 * before the checker stopped reporting JSX guards and generic signatures as prose, so
 * part of that drop is debt that never existed; the rest is billing and first-run setup
 * being translated out of this list.
 */
export const I18N_HARDCODED_ALLOWLIST: readonly string[] = [
  "app/providers.tsx", // 3
  "components/layout/Layout.tsx", // 20
  "components/layout/MobileAppChrome.tsx", // 3
  "components/security/OwnerPinModal.tsx", // 3
  "components/shared/ErrorBoundary.tsx", // 3
  "components/shared/MetricCard.tsx", // 1
  "components/shared/NotFound.tsx", // 1
  "components/ui/alert.tsx", // 1
  "components/ui/breadcrumb.tsx", // 1
  "components/ui/button-group.tsx", // 1
  "components/ui/carousel.tsx", // 3
  "components/ui/chart.tsx", // 1
  "components/ui/dialog.tsx", // 1
  "components/ui/empty.tsx", // 1
  "components/ui/field.tsx", // 1
  "components/ui/form.tsx", // 4
  "components/ui/input-group.tsx", // 1
  "components/ui/item.tsx", // 1
  "components/ui/pagination.tsx", // 3
  "components/ui/sheet.tsx", // 1
  "components/ui/sidebar.tsx", // 4
  "features/core/activity/pages/ActivityInsightsPage.tsx", // 1
  "features/core/assurance/pages/AssuranceDashboardPage.tsx", // 12
  "features/core/assurance/pages/AssuranceReportPage.tsx", // 9
  "features/core/assurance/pages/AuditRulesPage.tsx", // 6
  "features/core/assurance/pages/AuditRunsPage.tsx", // 7
  "features/core/assurance/pages/CasesPage.tsx", // 5
  "features/core/assurance/pages/EvidenceRequestsPage.tsx", // 2
  "features/core/assurance/pages/FindingDetailPage.tsx", // 27
  "features/core/assurance/pages/FindingsPage.tsx", // 3
  "features/core/assurance/ui.tsx", // 1
  "features/core/audit-logs/pages/AuditLogsPage.tsx", // 21
  "features/core/auth/AuthContext.tsx", // 2
  "features/core/auth/pages/ForgotPasswordPage.tsx", // 3
  "features/core/auth/pages/LoginPage.tsx", // 15
  "features/core/auth/pages/RegisterPage.tsx", // 16
  "features/core/auth/pages/ResetPasswordPage.tsx", // 4
  "features/core/auth/pages/VerifyEmailPage.tsx", // 1
  "features/core/customer-order/BillingOrderQrButton.tsx", // 10
  "features/core/customer-order/CustomerOrderPage.tsx", // 155
  "features/core/customer-order/DineInMenuPage.tsx", // 4
  "features/core/customer-order/ImportOrderPage.tsx", // 6
  "features/core/customer-order/OwnerOrderingCard.tsx", // 5
  "features/core/demo/DemoModeBanner.tsx", // 4
  "features/core/devices/pages/DeviceRemovedPage.tsx", // 2
  "features/core/devices/pages/DevicesPage.tsx", // 20
  "features/core/expenses/pages/ExpensesPage.tsx", // 47
  "features/core/gift-cards/GiftCardsPage.tsx", // 38
  "features/core/innovation/components/OfflineConfidenceMeter.tsx", // 8
  "features/core/innovation/pages/SmartToolsPage.tsx", // 4
  "features/core/loyalty/pages/LoyaltyPage.tsx", // 27
  "features/core/money-statement/pages/MoneyStatementPage.tsx", // 20
  "features/core/offers/pages/OffersPage.tsx", // 30
  "features/core/orders/pages/OrdersReceivedPage.tsx", // 44
  "features/core/platform-admin/pages/PlatformAdminPage.tsx", // 4
  "features/core/pricing/pages/ProductPricingPage.tsx", // 26
  "features/core/products/pages/ProductsPage.tsx", // 4
  "features/core/products/pages/components/BulkDeleteDialog.tsx", // 4
  "features/core/products/pages/components/BulkEditDialog.tsx", // 16
  "features/core/products/pages/components/ImportProductsDialog.tsx", // 17
  "features/core/products/pages/components/ProductAliasSuggestions.tsx", // 5
  "features/core/products/pages/components/ProductFormPanel.tsx", // 16
  "features/core/products/pages/components/ProductPricingForm.tsx", // 11
  "features/core/products/pages/components/ProductStockForm.tsx", // 3
  "features/core/products/pages/components/VariantGridEditor.tsx", // 5
  "features/core/purchases/components/PurchaseOrdersPanel.tsx", // 113
  "features/core/purchases/pages/PurchaseBillsPage.tsx", // 141
  "features/core/recovery/pages/RecoveryModePage.tsx", // 7
  "features/core/recycle-bin/pages/RecycleBinPage.tsx", // 19
  "features/core/remote-support/RemoteHelpCard.tsx", // 2
  "features/core/remote-support/pages/RemoteSupportConsolePage.tsx", // 8
  "features/core/reports/components/AccountingControlPanel.tsx", // 11
  "features/core/reports/components/BankReconciliationPanel.tsx", // 45
  "features/core/reports/pages/DailyClosingPage.tsx", // 53
  "features/core/reports/pages/ReportsPage.tsx", // 34
  "features/core/returns/components/ReturnDialog.tsx", // 33
  "features/core/returns/pages/NewReturnPage.tsx", // 56
  "features/core/sales/pages/SalesOverviewPage.tsx", // 15
  // Not debt: the one string here is a developer assertion thrown when the hook
  // is used outside its provider. It never reaches a shopkeeper.
  "features/core/settings/i18n.tsx", // 1
  "features/core/settings/pages/IntegrationsSettingsPage.tsx", // 59
  "features/core/settings/pages/NotificationsSettingsPage.tsx", // 40
  "features/core/settings/pages/PrinterSettingsPage.tsx", // 48
  "features/core/settings/pages/SecuritySettingsPage.tsx", // 42
  "features/core/settings/pages/StoreProfilePage.tsx", // 41
  "features/core/settings/pages/TaxesSettingsPage.tsx", // 66
  "features/core/staff/pages/StaffPage.tsx", // 40
  "features/core/subscription/components/CancelSubscriptionDialog.tsx", // 8
  "features/core/subscription/components/SubscriptionStatusBanner.tsx", // 3
  "features/core/subscription/components/UpgradeModal.tsx", // 12
  "features/core/subscription/components/UpgradePrompt.tsx", // 1
  "features/core/subscription/pages/PlansPage.tsx", // 7
  "features/core/subscription/pages/SubscriptionPage.tsx", // 13
  "features/core/suppliers/pages/SuppliersPage.tsx", // 11
  "features/core/support/ReportIssueButton.tsx", // 4
  "features/core/support/pages/AskArthaPage.tsx", // 1
  "features/core/sync/SyncAlertBanner.tsx", // 3
  "features/core/sync/pages/SyncDiagnosticsSection.tsx", // 4
  "features/core/sync/pages/SyncStatusPage.tsx", // 59
  "features/core/voice/VoiceAssistant.tsx", // 9
  "features/verticals/auto-parts/fitment/pages/FitmentPage.tsx", // 19
  "features/verticals/beauty-cosmetics/testers/pages/TestersPage.tsx", // 27
  "features/verticals/clothing/rentals/components/RentalBookingPanel.tsx", // 13
  "features/verticals/clothing/rentals/pages/RentalsPage.tsx", // 22
  "features/verticals/electronics/units/components/ReceiveUnitsPanel.tsx", // 8
  "features/verticals/electronics/units/pages/ProductUnitsPage.tsx", // 28
  "features/verticals/footwear/sizes/pages/SizeRunsPage.tsx", // 22
  "features/verticals/furniture-home/orders/components/OrderPanel.tsx", // 11
  "features/verticals/furniture-home/orders/pages/FurnitureOrdersPage.tsx", // 20
  "features/verticals/pharmacy/prescriptions/components/PrescriptionAttach.tsx", // 1
  "features/verticals/pharmacy/prescriptions/components/PrescriptionPanel.tsx", // 9
  "features/verticals/pharmacy/prescriptions/pages/PrescriptionsPage.tsx", // 17
  "features/verticals/restaurant/pages/KitchenPage.tsx", // 7
  "features/verticals/restaurant/pages/KitchenStockPage.tsx", // 9
  "features/verticals/restaurant/pages/MenuPage.tsx", // 19
  "features/verticals/restaurant/pages/TablesPage.tsx", // 12
  "features/verticals/restaurant/pages/components/GuestOrdersStrip.tsx", // 2
  "features/verticals/restaurant/pages/components/TableQrDialog.tsx", // 3
  "features/verticals/stationery-books/book-lists/components/BookListPanel.tsx", // 8
  "features/verticals/stationery-books/book-lists/pages/BookListsPage.tsx", // 22
];
