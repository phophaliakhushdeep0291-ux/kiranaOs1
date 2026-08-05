import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import NotFound from "@/components/shared/NotFound";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { PageLoading } from "@/components/shared/PageLoading";
import { RouteTransition } from "@/components/shared/RouteTransition";
import { useAuth } from "@/features/core/auth/useAuth";
import { getLandingRoute } from "@/features/core/settings/landing-page";
import { SessionLockGate } from "@/features/core/settings/SessionLockGate";
import { peekPostLoginRedirect, stashPostLoginRedirect } from "@/features/core/auth/post-login-redirect";
import { FeatureGate } from "@/features/core/subscription/components/FeatureGate";
import { useActiveVerticalPack, type VerticalPageId } from "@/features/verticals/registry";
import { useScreenTracking } from "@/lib/activity";
import type { FeatureName } from "@/features/core/subscription/plans";
import { isPathInBusinessProfile, profileHasCapability, useShopBusinessProfile } from "@/features/core/settings/business-profile-bootstrap";
import { PermissionDenied } from "@/components/shared/PermissionDenied";

const Login = lazy(() => import("@/features/core/auth/pages/LoginPage"));
const Register = lazy(() => import("@/features/core/auth/pages/RegisterPage"));
const ForgotPassword = lazy(() => import("@/features/core/auth/pages/ForgotPasswordPage"));
const ResetPassword = lazy(() => import("@/features/core/auth/pages/ResetPasswordPage"));
const VerifyEmail = lazy(() => import("@/features/core/auth/pages/VerifyEmailPage"));
const DeviceRemoved = lazy(() => import("@/features/core/devices/pages/DeviceRemovedPage"));
const CustomerOrder = lazy(() => import("@/features/core/customer-order/CustomerOrderPage"));
const ImportOrder = lazy(() => import("@/features/core/customer-order/ImportOrderPage"));
const Dashboard = lazy(() => import("@/features/core/dashboard/pages/DashboardPage"));
const Billing = lazy(() => import("@/features/core/billing/pages/BillingPage"));
const BillsPage = lazy(() => import("@/features/core/bills/pages/BillsPage"));
const BillDetailPage = lazy(() => import("@/features/core/bills/pages/BillDetailPage"));
const OrdersReceivedPage = lazy(() => import("@/features/core/orders/pages/OrdersReceivedPage"));
const SalesOverviewPage = lazy(() => import("@/features/core/sales/pages/SalesOverviewPage"));
const NewReturnPage = lazy(() => import("@/features/core/returns/pages/NewReturnPage"));
const Products = lazy(() => import("@/features/core/products/pages/ProductsPage"));
const ProductPricing = lazy(() => import("@/features/core/pricing/pages/ProductPricingPage"));
const Customers = lazy(() => import("@/features/core/customers/pages/CustomersPage"));
const CustomerDetailPage = lazy(() => import("@/features/core/customers/pages/CustomerDetailPage"));
const Inventory = lazy(() => import("@/features/core/inventory/pages/InventoryPage"));
const StockIn = lazy(() => import("@/features/core/inventory/pages/StockInPage"));
const StockOut = lazy(() => import("@/features/core/inventory/pages/StockOutPage"));
const Adjustments = lazy(() => import("@/features/core/inventory/pages/AdjustmentsPage"));
const StockTransfers = lazy(() => import("@/features/core/inventory/pages/StockTransfersPage"));
const StockCounts = lazy(() => import("@/features/core/inventory/pages/StockCountsPage"));
const InventoryLots = lazy(() => import("@/features/core/inventory/pages/InventoryLotsPage"));
const Categories = lazy(() => import("@/features/core/inventory/pages/CategoriesPage"));
const PurchaseBillsPage = lazy(() => import("@/features/core/purchases/pages/PurchaseBillsPage"));
const Suppliers = lazy(() => import("@/features/core/suppliers/pages/SuppliersPage"));
const Expenses = lazy(() => import("@/features/core/expenses/pages/ExpensesPage"));
const Offers = lazy(() => import("@/features/core/offers/pages/OffersPage"));
const Loyalty = lazy(() => import("@/features/core/loyalty/pages/LoyaltyPage"));
const GiftCards = lazy(() => import("@/features/core/gift-cards/GiftCardsPage"));
const Reports = lazy(() => import("@/features/core/reports/pages/ReportsPage"));
const MoneyStatementPage = lazy(() => import("@/features/core/money-statement/pages/MoneyStatementPage"));
const DailyClosingPage = lazy(() => import("@/features/core/reports/pages/DailyClosingPage"));
const Settings = lazy(() => import("@/features/core/settings/pages/SettingsPage"));
const MerchantSetupSettings = lazy(() => import("@/features/core/settings/pages/MerchantSetupPage"));
const StoreProfileSettings = lazy(() => import("@/features/core/settings/pages/StoreProfilePage"));
const ModulesSettings = lazy(() => import("@/features/core/settings/pages/ModulesSettingsPage"));
const PrinterSettings = lazy(() => import("@/features/core/settings/pages/PrinterSettingsPage"));
const BillingSettings = lazy(() => import("@/features/core/settings/pages/BillingSettingsPage"));
const StaffSettings = lazy(() => import("@/features/core/settings/pages/StaffSettingsPage"));
const DevicesSettings = lazy(() => import("@/features/core/settings/pages/DevicesSettingsPage"));
const SyncSettings = lazy(() => import("@/features/core/settings/pages/SyncSettingsPage"));
const TaxesSettings = lazy(() => import("@/features/core/settings/pages/TaxesSettingsPage"));
const SecuritySettings = lazy(() => import("@/features/core/settings/pages/SecuritySettingsPage"));
const NotificationsSettings = lazy(() => import("@/features/core/settings/pages/NotificationsSettingsPage"));
const IntegrationsSettings = lazy(() => import("@/features/core/settings/pages/IntegrationsSettingsPage"));
const AdvancedSettings = lazy(() => import("@/features/core/settings/pages/AdvancedSettingsPage"));
const SyncStatusPage = lazy(() => import("@/features/core/sync/pages/SyncStatusPage"));
const PlansPage = lazy(() => import("@/features/core/subscription/pages/PlansPage"));
const SubscriptionPage = lazy(() => import("@/features/core/subscription/pages/SubscriptionPage"));
const DevicesPage = lazy(() => import("@/features/core/devices/pages/DevicesPage"));
const PlatformAdminPage = lazy(() => import("@/features/core/platform-admin/pages/PlatformAdminPage"));
const RemoteSupportConsolePage = lazy(() => import("@/features/core/remote-support/pages/RemoteSupportConsolePage"));
const AskArthaPage = lazy(() => import("@/features/core/support/pages/AskArthaPage"));
const ActivityInsightsPage = lazy(() => import("@/features/core/activity/pages/ActivityInsightsPage"));
const StaffPage = lazy(() => import("@/features/core/staff/pages/StaffPage"));
const AuditLogsPage = lazy(() => import("@/features/core/audit-logs/pages/AuditLogsPage"));
const AssuranceDashboardPage = lazy(() => import("@/features/core/assurance/pages/AssuranceDashboardPage"));
const AssuranceFindingsPage = lazy(() => import("@/features/core/assurance/pages/FindingsPage"));
const AssuranceFindingDetailPage = lazy(() => import("@/features/core/assurance/pages/FindingDetailPage"));
const AssuranceEvidencePage = lazy(() => import("@/features/core/assurance/pages/EvidenceRequestsPage"));
const AssuranceRunsPage = lazy(() => import("@/features/core/assurance/pages/AuditRunsPage"));
const AssuranceRulesPage = lazy(() => import("@/features/core/assurance/pages/AuditRulesPage"));
const AssuranceReviewQueuePage = lazy(() => import("@/features/core/assurance/pages/ReviewQueuePage"));
const AssuranceReportPage = lazy(() => import("@/features/core/assurance/pages/AssuranceReportPage"));
const AssuranceCasesPage = lazy(() => import("@/features/core/assurance/pages/CasesPage"));
const RecycleBinPage = lazy(() => import("@/features/core/recycle-bin/pages/RecycleBinPage"));
const SmartToolsPage = lazy(() => import("@/features/core/innovation/pages/SmartToolsPage"));
const RecoveryModePage = lazy(() => import("@/features/core/recovery/pages/RecoveryModePage"));
const AppLayout = lazy(() => import("@/components/layout").then((module) => ({ default: module.Layout })));

/**
 * The trade-specific screens, declared here alongside every other route import
 * so each one merges with its lazy siblings instead of being folded into the
 * startup shell (see `VerticalPageId`). Which of them a shop can actually reach
 * is decided by its pack, not by this map.
 */
const VERTICAL_PAGES: Record<VerticalPageId, ComponentType> = {
  "clothing/rentals": lazy(() => import("@/features/verticals/clothing/rentals/pages/RentalsPage")),
  "auto-parts/fitment": lazy(() => import("@/features/verticals/auto-parts/fitment/pages/FitmentPage")),
  "electronics/units": lazy(() => import("@/features/verticals/electronics/units/pages/ProductUnitsPage")),
  "footwear/size-runs": lazy(() => import("@/features/verticals/footwear/sizes/pages/SizeRunsPage")),
  "pharmacy/prescriptions": lazy(() => import("@/features/verticals/pharmacy/prescriptions/pages/PrescriptionsPage")),
  "stationery/book-lists": lazy(() => import("@/features/verticals/stationery-books/book-lists/pages/BookListsPage")),
  "restaurant/tables": lazy(() => import("@/features/verticals/restaurant/pages/TablesPage")),
  "restaurant/kitchen": lazy(() => import("@/features/verticals/restaurant/pages/KitchenPage")),
};

const ROUTE_LOADING_LABELS: Record<string, string> = {
  dashboard: "Preparing today’s dashboard…",
  billing: "Opening a new bill…",
};

function LoadingScreen() {
  const [location] = useLocation();
  const path = location.split(/[?#]/)[0].replace(/^\/+/, "");
  const section = path.split("/").filter(Boolean)[0] ?? "dashboard";
  const fallback = path.split("/").filter(Boolean).at(-1)?.replace(/-/g, " ");
  return <PageLoading label={ROUTE_LOADING_LABELS[path] ?? ROUTE_LOADING_LABELS[section] ?? `Opening ${fallback || "Artha"}…`} />;
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

function BusinessProfileRouteGate({ capability, children }: { capability?: string; children: ReactNode }) {
  const [location] = useLocation();
  const profile = useShopBusinessProfile();
  if (profile.isLoading) return <LoadingScreen />;
  // Preserve offline-first access when bootstrap itself is temporarily unavailable.
  if (!profile.data) return <>{children}</>;
  if (!isPathInBusinessProfile(location, profile.data.navigation)) {
    return <PermissionDenied title="Not part of this business profile" message="This page is hidden because it is not enabled for the active shop profile." />;
  }
  if (capability && !profileHasCapability(profile.data.capabilities, capability)) {
    return <PermissionDenied title="Feature not available" message="This capability is not enabled for the active shop profile." />;
  }
  return <>{children}</>;
}

function ProtectedRoute({ component: Component, featureName, capability }: { component: ComponentType; featureName?: FeatureName; capability?: string }) {
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
      <Suspense fallback={<LoadingScreen />}>
        <AppLayout>
          <ErrorBoundary>
            <BusinessProfileRouteGate capability={capability}>
              <LazyPage component={Component} featureName={featureName} />
            </BusinessProfileRouteGate>
          </ErrorBoundary>
        </AppLayout>
      </Suspense>
    </SessionLockGate>
  );
}

/**
 * The catch-all. A mistyped or stale URL used to render the bare card with no
 * app shell at all, which on a phone meant losing the tab bar and top bar — the
 * only way out of a wrong link was the one button on the card. It also skipped
 * `RouteTransition`, so the tab kept the previous screen's `document.title` and
 * screen readers were never told the page had changed.
 *
 * Signed in, the card now sits inside the normal shell. The business-profile
 * gate is deliberately left off: an unknown path is genuinely missing, not a
 * screen this shop is not entitled to, and that gate would mislabel it.
 */
function NotFoundRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;

  // Signed out there is no shell to sit in, so the bare card stays — but it
  // still goes through LazyPage for the title and the route announcement.
  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <LazyPage component={NotFound} />
      </ErrorBoundary>
    );
  }

  return (
    <SessionLockGate>
      <Suspense fallback={<LoadingScreen />}>
        <AppLayout pageTitle="Page not found">
          <ErrorBoundary>
            <LazyPage component={NotFound} />
          </ErrorBoundary>
        </AppLayout>
      </Suspense>
    </SessionLockGate>
  );
}

function PublicRoute({ component: Component }: { component: ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Redirect to={peekPostLoginRedirect() ?? getLandingRoute()} />;

  return (
    <ErrorBoundary>
      <LazyPage component={Component} />
    </ErrorBoundary>
  );
}

export function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();
  const verticalPack = useActiveVerticalPack();
  const isCustomerOrderPath = /^\/order\/[^/]+/.test(location);

  // §13 screen tracking. The public storefront tracks its own online-session
  // events, so it is excluded here to keep a shopper's browsing out of the POS
  // page ranking.
  useScreenTracking(location, isAuthenticated && !isCustomerOrderPath);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Warm the two highest-frequency workspaces only after the browser is idle.
    // Dynamic imports are cached by the module loader, so the eventual route
    // transition can render immediately without adding pressure to first paint.
    const warmCoreRoutes = () => {
      if (location !== "/dashboard") void import("@/features/core/dashboard/pages/DashboardPage");
      if (location !== "/billing") void import("@/features/core/billing/pages/BillingPage");
    };
    const browserWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (browserWindow.requestIdleCallback) {
      const handle = browserWindow.requestIdleCallback(warmCoreRoutes, { timeout: 2500 });
      return () => browserWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(warmCoreRoutes, 900);
    return () => window.clearTimeout(handle);
  }, [isAuthenticated, location]);

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
      {/* "Udhar" / "khata" is the credit view of the customer list, not a page of
          its own. The dashboard "Collect" shortcut, every voice "open udhar"
          command, and the backend voice intent all navigate here, so the alias
          is redirected in one place rather than rewritten at each call site —
          the server can still send "/udhar" at any time. */}
      <Route path="/udhar">
        <Redirect to="/customers?filter=udhar" />
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
        <ProtectedRoute component={InventoryLots} featureName="batch_expiry" capability="BATCH_TRACKING" />
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
      <Route path="/settings/modules">
        <ProtectedRoute component={ModulesSettings} />
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
      <Route path="/platform-admin/support">
        <ProtectedRoute component={RemoteSupportConsolePage} />
      </Route>
      <Route path="/help">
        <ProtectedRoute component={AskArthaPage} />
      </Route>
      <Route path="/activity-insights">
        <ProtectedRoute component={ActivityInsightsPage} />
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
      <Route path="/assurance/cases">
        <ProtectedRoute component={AssuranceCasesPage} />
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
      {/* This shop's trade-specific screens, and only this shop's. Another
          vertical's route is not registered here at all, so typing its URL
          falls through to NotFound rather than rendering a page the shop has
          no business seeing. */}
      {verticalPack.routes.map((route) => (
        <Route key={route.path} path={route.path}>
          <ProtectedRoute component={VERTICAL_PAGES[route.page]} featureName={route.featureName} />
        </Route>
      ))}
      <Route component={NotFoundRoute} />
    </Switch>
  );
}
