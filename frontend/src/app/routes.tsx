import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import NotFound from "@/components/shared/NotFound";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { PageLoading } from "@/components/shared/PageLoading";
import { RouteTransition } from "@/components/shared/RouteTransition";
import { useAuth } from "@/features/auth/useAuth";
import { getLandingRoute } from "@/features/settings/landing-page";
import { SessionLockGate } from "@/features/settings/SessionLockGate";
import { stashPostLoginRedirect } from "@/features/auth/post-login-redirect";
import { FeatureGate } from "@/features/subscription/components/FeatureGate";
import type { FeatureName } from "@/features/subscription/plans";

const Login = lazy(() => import("@/features/auth/pages/LoginPage"));
const Register = lazy(() => import("@/features/auth/pages/RegisterPage"));
const ForgotPassword = lazy(() => import("@/features/auth/pages/ForgotPasswordPage"));
const ResetPassword = lazy(() => import("@/features/auth/pages/ResetPasswordPage"));
const VerifyEmail = lazy(() => import("@/features/auth/pages/VerifyEmailPage"));
const DeviceRemoved = lazy(() => import("@/features/devices/pages/DeviceRemovedPage"));
const CustomerOrder = lazy(() => import("@/features/customer-order/CustomerOrderPage"));
const ImportOrder = lazy(() => import("@/features/customer-order/ImportOrderPage"));
const Dashboard = lazy(() => import("@/features/dashboard/pages/DashboardPage"));
const Billing = lazy(() => import("@/features/billing/pages/BillingPage"));
const BillsPage = lazy(() => import("@/features/bills/pages/BillsPage"));
const BillDetailPage = lazy(() => import("@/features/bills/pages/BillDetailPage"));
const OrdersReceivedPage = lazy(() => import("@/features/orders/pages/OrdersReceivedPage"));
const SalesOverviewPage = lazy(() => import("@/features/sales/pages/SalesOverviewPage"));
const NewReturnPage = lazy(() => import("@/features/returns/pages/NewReturnPage"));
const Products = lazy(() => import("@/features/products/pages/ProductsPage"));
const ProductPricing = lazy(() => import("@/features/pricing/pages/ProductPricingPage"));
const Customers = lazy(() => import("@/features/customers/pages/CustomersPage"));
const CustomerDetailPage = lazy(() => import("@/features/customers/pages/CustomerDetailPage"));
const Inventory = lazy(() => import("@/features/inventory/pages/InventoryPage"));
const StockIn = lazy(() => import("@/features/inventory/pages/StockInPage"));
const StockOut = lazy(() => import("@/features/inventory/pages/StockOutPage"));
const Adjustments = lazy(() => import("@/features/inventory/pages/AdjustmentsPage"));
const StockTransfers = lazy(() => import("@/features/inventory/pages/StockTransfersPage"));
const StockCounts = lazy(() => import("@/features/inventory/pages/StockCountsPage"));
const InventoryLots = lazy(() => import("@/features/inventory/pages/InventoryLotsPage"));
const Categories = lazy(() => import("@/features/inventory/pages/CategoriesPage"));
const PurchaseBillsPage = lazy(() => import("@/features/purchases/pages/PurchaseBillsPage"));
const Suppliers = lazy(() => import("@/features/suppliers/pages/SuppliersPage"));
const Expenses = lazy(() => import("@/features/expenses/pages/ExpensesPage"));
const Offers = lazy(() => import("@/features/offers/pages/OffersPage"));
const Loyalty = lazy(() => import("@/features/loyalty/pages/LoyaltyPage"));
const GiftCards = lazy(() => import("@/features/gift-cards/GiftCardsPage"));
const Reports = lazy(() => import("@/features/reports/pages/ReportsPage"));
const MoneyStatementPage = lazy(() => import("@/features/money-statement/pages/MoneyStatementPage"));
const DailyClosingPage = lazy(() => import("@/features/reports/pages/DailyClosingPage"));
const Settings = lazy(() => import("@/features/settings/pages/SettingsPage"));
const MerchantSetupSettings = lazy(() => import("@/features/settings/pages/MerchantSetupPage"));
const StoreProfileSettings = lazy(() => import("@/features/settings/pages/StoreProfilePage"));
const PrinterSettings = lazy(() => import("@/features/settings/pages/PrinterSettingsPage"));
const BillingSettings = lazy(() => import("@/features/settings/pages/BillingSettingsPage"));
const StaffSettings = lazy(() => import("@/features/settings/pages/StaffSettingsPage"));
const DevicesSettings = lazy(() => import("@/features/settings/pages/DevicesSettingsPage"));
const SyncSettings = lazy(() => import("@/features/settings/pages/SyncSettingsPage"));
const TaxesSettings = lazy(() => import("@/features/settings/pages/TaxesSettingsPage"));
const SecuritySettings = lazy(() => import("@/features/settings/pages/SecuritySettingsPage"));
const NotificationsSettings = lazy(() => import("@/features/settings/pages/NotificationsSettingsPage"));
const IntegrationsSettings = lazy(() => import("@/features/settings/pages/IntegrationsSettingsPage"));
const AdvancedSettings = lazy(() => import("@/features/settings/pages/AdvancedSettingsPage"));
const SyncStatusPage = lazy(() => import("@/features/sync/pages/SyncStatusPage"));
const PlansPage = lazy(() => import("@/features/subscription/pages/PlansPage"));
const SubscriptionPage = lazy(() => import("@/features/subscription/pages/SubscriptionPage"));
const DevicesPage = lazy(() => import("@/features/devices/pages/DevicesPage"));
const PlatformAdminPage = lazy(() => import("@/features/platform-admin/pages/PlatformAdminPage"));
const StaffPage = lazy(() => import("@/features/staff/pages/StaffPage"));
const AuditLogsPage = lazy(() => import("@/features/audit-logs/pages/AuditLogsPage"));
const AssuranceDashboardPage = lazy(() => import("@/features/assurance/pages/AssuranceDashboardPage"));
const AssuranceFindingsPage = lazy(() => import("@/features/assurance/pages/FindingsPage"));
const AssuranceFindingDetailPage = lazy(() => import("@/features/assurance/pages/FindingDetailPage"));
const AssuranceEvidencePage = lazy(() => import("@/features/assurance/pages/EvidenceRequestsPage"));
const AssuranceRunsPage = lazy(() => import("@/features/assurance/pages/AuditRunsPage"));
const AssuranceRulesPage = lazy(() => import("@/features/assurance/pages/AuditRulesPage"));
const AssuranceReviewQueuePage = lazy(() => import("@/features/assurance/pages/ReviewQueuePage"));
const AssuranceReportPage = lazy(() => import("@/features/assurance/pages/AssuranceReportPage"));
const RecycleBinPage = lazy(() => import("@/features/recycle-bin/pages/RecycleBinPage"));
const SmartToolsPage = lazy(() => import("@/features/innovation/pages/SmartToolsPage"));
const RecoveryModePage = lazy(() => import("@/features/recovery/pages/RecoveryModePage"));

const ROUTE_LOADING_LABELS: Record<string, string> = {
  login: "Opening secure sign in…",
  register: "Preparing shop registration…",
  "forgot-password": "Opening account recovery…",
  "reset-password": "Opening password reset…",
  "verify-email": "Verifying your shop email…",
  dashboard: "Preparing today’s dashboard…",
  billing: "Opening a new bill…",
  bills: "Loading bill history…",
  products: "Loading your products…",
  categories: "Loading product categories…",
  customers: "Loading customers and udhar…",
  inventory: "Checking current stock…",
  "purchase-bills": "Loading purchases…",
  suppliers: "Loading suppliers…",
  expenses: "Loading expenses…",
  offers: "Loading offers and coupons…",
  reports: "Preparing business reports…",
  "money-statement": "Preparing cash and payment activity…",
  "daily-closing": "Preparing daily closing…",
  settings: "Opening store settings…",
  "settings/setup": "Checking merchant setup...",
  plans: "Loading available plans…",
  subscription: "Checking your subscription…",
  devices: "Checking registered devices…",
  staff: "Loading staff access…",
  "audit-logs": "Loading audit history…",
  "recycle-bin": "Loading recoverable records…",
  "smart-tools": "Opening smart tools…",
  "recovery-mode": "Preparing recovery tools…",
  "sync-status": "Checking backup status…",
  returns: "Loading returns…",
  "orders-received": "Loading customer orders…",
  "sales-overview": "Preparing sales overview…",
  "import-order": "Preparing customer order…",
  order: "Loading this store…",
};

function LoadingScreen() {
  const [location] = useLocation();
  const path = location.split(/[?#]/)[0].replace(/^\/+/, "");
  const section = path.split("/").filter(Boolean)[0] ?? "dashboard";
  return <PageLoading label={ROUTE_LOADING_LABELS[path] ?? ROUTE_LOADING_LABELS[section] ?? "Opening Artha..."} />;
}

function LazyPage({ component: Component, featureName }: { component: ComponentType; featureName?: FeatureName }) {
  const [location] = useLocation();
  const routeKey = location.split(/[?#]/)[0] || "/";

  useEffect(() => {
    const main = document.getElementById("main-content");
    if (main) main.scrollTo({ top: 0, left: 0, behavior: "auto" });
    else window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [routeKey]);

  return (
    <div key={routeKey} className="app-route-frame min-w-0">
      <Suspense fallback={<LoadingScreen />}>
        <RouteTransition routeKey={routeKey}>
          {featureName ? <FeatureGate featureName={featureName}><Component /></FeatureGate> : <Component />}
        </RouteTransition>
      </Suspense>
    </div>
  );
}

function ProtectedRoute({ component: Component, featureName }: { component: ComponentType; featureName?: FeatureName }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;

  if (!isAuthenticated) {
    // Remember where they were headed (incl. any #order hash) so login can send them back.
    if (typeof window !== "undefined") {
      stashPostLoginRedirect(window.location.pathname + window.location.search + window.location.hash);
    }
    return <Redirect to="/login" />;
  }

  return (
    <SessionLockGate>
      <Layout>
        <ErrorBoundary>
          <LazyPage component={Component} featureName={featureName} />
        </ErrorBoundary>
      </Layout>
    </SessionLockGate>
  );
}

function PublicRoute({ component: Component }: { component: ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Redirect to={getLandingRoute()} />;

  return (
    <ErrorBoundary>
      <LazyPage component={Component} />
    </ErrorBoundary>
  );
}

export function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();
  const isCustomerOrderPath = /^\/order\/[^/]+/.test(location);

  if (isLoading && !isCustomerOrderPath) return <LoadingScreen />;

  return (
    <Switch>
      <Route path="/login">
        <PublicRoute component={Login} />
      </Route>
      <Route path="/register">
        <PublicRoute component={Register} />
      </Route>
      <Route path="/forgot-password">
        <PublicRoute component={ForgotPassword} />
      </Route>
      <Route path="/reset-password">
        <PublicRoute component={ResetPassword} />
      </Route>
      <Route path="/verify-email">
        <PublicRoute component={VerifyEmail} />
      </Route>
      <Route path="/device-removed">
        <ErrorBoundary>
          <LazyPage component={DeviceRemoved} />
        </ErrorBoundary>
      </Route>
      {/* Customer QR self-order page: fully public (no auth gate, no redirect-if-logged-in) so a
          customer on their own phone — or an owner previewing — can always open it. */}
      <Route path="/order/:shopCode">
        <ErrorBoundary>
          <LazyPage component={CustomerOrder} />
        </ErrorBoundary>
      </Route>
      <Route path="/">
        {isAuthenticated ? <Redirect to={getLandingRoute()} /> : <Redirect to="/login" />}
      </Route>
      <Route path="/dashboard">
        <ProtectedRoute component={Dashboard} />
      </Route>
      <Route path="/billing">
        <ProtectedRoute component={Billing} />
      </Route>
      {/* Owner lands here after scanning a customer's order QR with the native camera. */}
      <Route path="/import-order">
        <ProtectedRoute component={ImportOrder} />
      </Route>
      <Route path="/returns/new">
        <ProtectedRoute component={NewReturnPage} />
      </Route>
      <Route path="/returns">
        <ProtectedRoute component={NewReturnPage} />
      </Route>
      <Route path="/bills/:id">
        <ProtectedRoute component={BillDetailPage} />
      </Route>
      <Route path="/bills">
        <ProtectedRoute component={BillsPage} />
      </Route>
      <Route path="/orders-received">
        <ProtectedRoute component={OrdersReceivedPage} />
      </Route>
      <Route path="/sales-overview">
        <ProtectedRoute component={SalesOverviewPage} />
      </Route>
      <Route path="/products/:productId/pricing">
        <ProtectedRoute component={ProductPricing} featureName="dynamic_customer_pricing" />
      </Route>
      <Route path="/products">
        <ProtectedRoute component={Products} />
      </Route>
      <Route path="/categories">
        <ProtectedRoute component={Categories} />
      </Route>
      <Route path="/customers/:id">
        <ProtectedRoute component={CustomerDetailPage} />
      </Route>
      <Route path="/customers">
        <ProtectedRoute component={Customers} />
      </Route>
      <Route path="/inventory/stock-in">
        <ProtectedRoute component={StockIn} />
      </Route>
      <Route path="/inventory/stock-out">
        <ProtectedRoute component={StockOut} />
      </Route>
      <Route path="/inventory/adjustments">
        <ProtectedRoute component={Adjustments} />
      </Route>
      <Route path="/inventory/stock-transfers">
        <ProtectedRoute component={StockTransfers} featureName="multi_store" />
      </Route>
      <Route path="/inventory/stock-counts">
        <ProtectedRoute component={StockCounts} featureName="stock_adjustment" />
      </Route>
      <Route path="/inventory/batches">
        <ProtectedRoute component={InventoryLots} featureName="batch_expiry" />
      </Route>
      <Route path="/inventory">
        <ProtectedRoute component={Inventory} />
      </Route>
      <Route path="/purchase-bills">
        <ProtectedRoute component={PurchaseBillsPage} />
      </Route>
      <Route path="/suppliers">
        <ProtectedRoute component={Suppliers} />
      </Route>
      <Route path="/expenses">
        <ProtectedRoute component={Expenses} />
      </Route>
      <Route path="/offers">
        <ProtectedRoute component={Offers} featureName="dynamic_customer_pricing" />
      </Route>
      <Route path="/loyalty">
        <ProtectedRoute component={Loyalty} featureName="loyalty_program" />
      </Route>
      <Route path="/gift-cards">
        <ProtectedRoute component={GiftCards} featureName="loyalty_program" />
      </Route>
      <Route path="/reports">
        <ProtectedRoute component={Reports} />
      </Route>
      <Route path="/money-statement">
        <ProtectedRoute component={MoneyStatementPage} />
      </Route>
      <Route path="/daily-closing">
        <ProtectedRoute component={DailyClosingPage} />
      </Route>
      <Route path="/settings/setup">
        <ProtectedRoute component={MerchantSetupSettings} />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={Settings} />
      </Route>
      <Route path="/settings/store-profile">
        <ProtectedRoute component={StoreProfileSettings} />
      </Route>
      <Route path="/settings/printer">
        <ProtectedRoute component={PrinterSettings} />
      </Route>
      <Route path="/settings/billing">
        <ProtectedRoute component={BillingSettings} />
      </Route>
      <Route path="/settings/staff">
        <ProtectedRoute component={StaffSettings} featureName="staff_login" />
      </Route>
      <Route path="/settings/devices">
        <ProtectedRoute component={DevicesSettings} />
      </Route>
      <Route path="/settings/sync">
        <ProtectedRoute component={SyncSettings} />
      </Route>
      <Route path="/settings/taxes">
        <ProtectedRoute component={TaxesSettings} />
      </Route>
      <Route path="/settings/security">
        <ProtectedRoute component={SecuritySettings} />
      </Route>
      <Route path="/settings/notifications">
        <ProtectedRoute component={NotificationsSettings} />
      </Route>
      <Route path="/settings/integrations">
        <ProtectedRoute component={IntegrationsSettings} featureName="api_webhook_later" />
      </Route>
      <Route path="/settings/advanced">
        <ProtectedRoute component={AdvancedSettings} />
      </Route>
      <Route path="/plans">
        <ProtectedRoute component={PlansPage} />
      </Route>
      <Route path="/subscription">
        <ProtectedRoute component={SubscriptionPage} />
      </Route>
      <Route path="/devices">
        <ProtectedRoute component={DevicesPage} />
      </Route>
      <Route path="/platform-admin">
        <ProtectedRoute component={PlatformAdminPage} />
      </Route>
      <Route path="/staff">
        <ProtectedRoute component={StaffPage} featureName="staff_login" />
      </Route>
      <Route path="/audit-logs">
        <ProtectedRoute component={AuditLogsPage} featureName="audit_logs" />
      </Route>
      <Route path="/assurance/findings/:id">
        <ProtectedRoute component={AssuranceFindingDetailPage} />
      </Route>
      <Route path="/assurance/findings">
        <ProtectedRoute component={AssuranceFindingsPage} />
      </Route>
      <Route path="/assurance/evidence">
        <ProtectedRoute component={AssuranceEvidencePage} />
      </Route>
      <Route path="/assurance/review-queue">
        <ProtectedRoute component={AssuranceReviewQueuePage} />
      </Route>
      <Route path="/assurance/runs">
        <ProtectedRoute component={AssuranceRunsPage} />
      </Route>
      <Route path="/assurance/rules">
        <ProtectedRoute component={AssuranceRulesPage} />
      </Route>
      <Route path="/assurance/report">
        <ProtectedRoute component={AssuranceReportPage} />
      </Route>
      <Route path="/assurance">
        <ProtectedRoute component={AssuranceDashboardPage} />
      </Route>
      <Route path="/recycle-bin">
        <ProtectedRoute component={RecycleBinPage} />
      </Route>
      <Route path="/smart-tools">
        <ProtectedRoute component={SmartToolsPage} />
      </Route>
      <Route path="/recovery-mode">
        <ProtectedRoute component={RecoveryModePage} />
      </Route>
      <Route path="/sync-status">
        <ProtectedRoute component={SyncStatusPage} />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}
