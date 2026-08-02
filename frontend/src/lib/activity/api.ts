import { apiRequest } from "@/lib/api/http";

/** Read side of the activity engine (§13). Ingest lives in activityClient.ts. */

export interface ActivityEntry {
  key: string;
  label: string;
  count: number;
  score: number;
  lastSeenAt: string;
}

export interface RecentSearchEntry {
  value: string;
  at: string;
  results: number | null;
}

export interface AbandonedCartEntry {
  sessionId: string;
  customerName: string | null;
  itemCount: number | null;
  total: number | null;
  productIds: string[];
  lastSeenAt: string;
}

export interface RecentActivity {
  recentSearches: RecentSearchEntry[];
  recentReports: ActivityEntry[];
  frequentCustomers: ActivityEntry[];
  frequentProducts: ActivityEntry[];
  recentPaymentMethods: ActivityEntry[];
  frequentFilters: ActivityEntry[];
  frequentPages: ActivityEntry[];
  recentOnlineProducts: ActivityEntry[];
  abandonedCarts: AbandonedCartEntry[];
}

export interface PersonalizationProduct extends ActivityEntry {
  source: "user" | "shop" | "both";
}

export interface Personalization {
  generatedAt: string;
  quickProducts: PersonalizationProduct[];
  searchSuggestions: Array<{ query: string; count: number; score: number }>;
  frequentCustomers: ActivityEntry[];
  preferredPaymentMethod: string | null;
  paymentMethods: ActivityEntry[];
  preferredFilters: Record<string, Array<{ filter: string; count: number; score: number }>>;
  dashboardOrder: Array<{ key: string; score: number }>;
  productCombos: Record<string, Array<{ productId: string; count: number; score: number }>>;
  predictedProducts: { hour: number; sufficientData: boolean; products: Array<{ productId: string; label: string; count: number }> };
  onlineTrending: ActivityEntry[];
  onlineCartTrending: ActivityEntry[];
  abandonedCarts: AbandonedCartEntry[];
}

export interface ReplenishmentSuggestion {
  productId: string;
  productName: string;
  baseUnit: string;
  stockBaseQty: number;
  recommendedOrderBaseQty: number;
  coverageDaysRemaining: number | null;
  forecastConfidence: string;
  reason: string;
  supplierName: string | null;
  activityScore: number;
}

export interface InsightResult {
  insight: string;
  sufficientData: boolean;
  note?: string;
  items: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ActivityInsights {
  generatedAt: string;
  windowDays: number;
  topProducts: InsightResult;
  topReports: InsightResult;
  slowestTasks: InsightResult;
  peakHours: InsightResult;
  reorder: InsightResult;
  lapsingCustomers: InsightResult;
  onlineViewedNotBought: InsightResult;
  checkoutDropOff: InsightResult;
}

export interface ActivityAnalytics {
  generatedAt: string;
  windowDays: number;
  totalEvents: number;
  activeUsers: { dau: number; wau: number; mau: number; stickiness: number | null };
  eventCounts: Record<string, number>;
  mostUsedFeatures: Array<{ feature: string; label: string; count: number; users: number; adoptionRate: number | null }>;
  leastUsedFeatures: Array<{ feature: string; label: string; count: number; users: number; adoptionRate: number | null }>;
  featureAdoption: Array<{ feature: string; label: string; count: number; users: number; adoptionRate: number | null }>;
  averageBillingTimeMs: { averageMs: number | null; samples: number };
  averageCheckoutDurationMs: { averageMs: number | null; samples: number };
  averageSearchDurationMs: { averageMs: number | null; samples: number };
  slowestTasks: Array<{ task: string; label: string; samples: number; averageMs: number; totalMs: number }>;
  mostSearchedProducts: Array<{ key: string; label: string | null; count: number }>;
  mostEditedProducts: Array<{ key: string; label: string | null; count: number }>;
  mostCancelledBillProducts: Array<{ key: string; label: string | null; count: number }>;
  cancelledBills: { total: number; reasons: Array<{ key: string; label: string | null; count: number }> };
  commonSupportIssues: { total: number; byPage: Array<{ page: string; count: number; open: number }> };
  commonSystemErrors: Array<{ id: string; title: string; source: string; count: number; status: string; lastSeenAt: string }>;
  aiUsage: { queries: number; helpArticles: number; users: number };
  voiceUsage: { commands: number; users: number };
  online: {
    sessions: number;
    productViews: number;
    cartAdds: number;
    checkoutsStarted: number;
    checkoutsCompleted: number;
    cartsAbandoned: number;
    paymentFailures: number;
    conversionRate: number | null;
    cartAbandonmentRate: number | null;
    checkoutDropOffRate: number | null;
  };
}

export function fetchRecentActivity(limit = 10): Promise<RecentActivity> {
  return apiRequest<RecentActivity>(`/activity/recent?limit=${limit}`, { background: true });
}

export function fetchPersonalization(limit = 10): Promise<Personalization> {
  return apiRequest<Personalization>(`/activity/personalization?limit=${limit}`, { background: true });
}

export function fetchReplenishment(limit = 10): Promise<ReplenishmentSuggestion[]> {
  return apiRequest<ReplenishmentSuggestion[]>(`/activity/replenishment?limit=${limit}`, { background: true });
}

export function fetchInsights(days = 30): Promise<ActivityInsights> {
  return apiRequest<ActivityInsights>(`/activity/insights?days=${days}`);
}

export function fetchActivityAnalytics(days = 30): Promise<ActivityAnalytics> {
  return apiRequest<ActivityAnalytics>(`/activity/analytics?days=${days}`);
}
