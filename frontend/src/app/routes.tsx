import { lazy, Suspense, type ComponentType } from "react";
import { Redirect, Route, Switch } from "wouter";
import { Layout } from "@/components/layout";
import NotFound from "@/components/shared/NotFound";
import { ErrorBoundary, PageLoading } from "@/components/shared";
import { useAuth } from "@/features/auth/useAuth";
import { getLandingRoute } from "@/features/settings/landing-page";
import { stashPostLoginRedirect } from "@/features/auth/post-login-redirect";

const Login = lazy(() => import("@/features/auth/pages/LoginPage"));
const Register = lazy(() => import("@/features/auth/pages/RegisterPage"));
const CustomerOrder = lazy(() => import("@/features/customer-order/CustomerOrderPage"));
const ImportOrder = lazy(() => import("@/features/customer-order/ImportOrderPage"));
const Dashboard = lazy(() => import("@/features/dashboard/pages/DashboardPage"));
const Billing = lazy(() => import("@/features/billing/pages/BillingPage"));
const BillsPage = lazy(() => import("@/features/bills/pages/BillsPage"));
const BillDetailPage = lazy(() => import("@/features/bills/pages/BillDetailPage"));
const SalesOverviewPage = lazy(() => import("@/features/sales/pages/SalesOverviewPage"));
const NewReturnPage = lazy(() => import("@/features/returns/pages/NewReturnPage"));
const Products = lazy(() => import("@/features/products/pages/ProductsPage"));
const Customers = lazy(() => import("@/features/customers/pages/CustomersPage"));
const CustomerDetailPage = lazy(() => import("@/features/customers/pages/CustomerDetailPage"));
const Inventory = lazy(() => import("@/features/inventory/pages/InventoryPage"));
const StockIn = lazy(() => import("@/features/inventory/pages/StockInPage"));
const StockOut = lazy(() => import("@/features/inventory/pages/StockOutPage"));
const Adjustments = lazy(() => import("@/features/inventory/pages/AdjustmentsPage"));
const StockTransfers = lazy(() => import("@/features/inventory/pages/StockTransfersPage"));
const Categories = lazy(() => import("@/features/inventory/pages/CategoriesPage"));
const PurchaseBillsPage = lazy(() => import("@/features/purchases/pages/PurchaseBillsPage"));
const Suppliers = lazy(() => import("@/features/suppliers/pages/SuppliersPage"));
const Expenses = lazy(() => import("@/features/expenses/pages/ExpensesPage"));
const Offers = lazy(() => import("@/features/offers/pages/OffersPage"));
const Reports = lazy(() => import("@/features/reports/pages/ReportsPage"));
const DailyClosingPage = lazy(() => import("@/features/reports/pages/DailyClosingPage"));
const Settings = lazy(() => import("@/features/settings/pages/SettingsPage"));
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
const StaffPage = lazy(() => import("@/features/staff/pages/StaffPage"));
const AuditLogsPage = lazy(() => import("@/features/audit-logs/pages/AuditLogsPage"));
const RecycleBinPage = lazy(() => import("@/features/recycle-bin/pages/RecycleBinPage"));
const SmartToolsPage = lazy(() => import("@/features/innovation/pages/SmartToolsPage"));
const RecoveryModePage = lazy(() => import("@/features/recovery/pages/RecoveryModePage"));

function LoadingScreen() {
  return <PageLoading label="Loading counter..." />;
}

function LazyPage({ component: Component }: { component: ComponentType }) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <div className="animate-in fade-in duration-200">
        <Component />
      </div>
    </Suspense>
  );
}

function ProtectedRoute({ component: Component }: { component: ComponentType }) {
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
    <Layout>
      <ErrorBoundary>
        <LazyPage component={Component} />
      </ErrorBoundary>
    </Layout>
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

  if (isLoading) return <LoadingScreen />;

  return (
    <Switch>
      <Route path="/login">
        <PublicRoute component={Login} />
      </Route>
      <Route path="/register">
        <PublicRoute component={Register} />
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
      <Route path="/sales-overview">
        <ProtectedRoute component={SalesOverviewPage} />
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
        <ProtectedRoute component={StockTransfers} />
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
        <ProtectedRoute component={Offers} />
      </Route>
      <Route path="/reports">
        <ProtectedRoute component={Reports} />
      </Route>
      <Route path="/daily-closing">
        <ProtectedRoute component={DailyClosingPage} />
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
        <ProtectedRoute component={StaffSettings} />
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
        <ProtectedRoute component={IntegrationsSettings} />
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
      <Route path="/staff">
        <ProtectedRoute component={StaffPage} />
      </Route>
      <Route path="/audit-logs">
        <ProtectedRoute component={AuditLogsPage} />
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
