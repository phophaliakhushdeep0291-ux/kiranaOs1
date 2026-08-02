import { useQuery } from "@tanstack/react-query";
import {
  fetchActivityAnalytics,
  fetchInsights,
  fetchPersonalization,
  fetchRecentActivity,
  fetchReplenishment,
  type ActivityAnalytics,
  type ActivityInsights,
  type Personalization,
  type RecentActivity,
  type ReplenishmentSuggestion,
} from "./api";

/**
 * Read hooks for the personalization surfaces.
 *
 * Two shared decisions:
 *
 *  - **Long staleness.** Behaviour changes over days, not seconds, so refetching
 *    on every focus would spend a rural shop's bandwidth for no visible
 *    difference.
 *  - **No retries, no error surface.** If suggestions cannot be fetched the
 *    screen falls back to its default ordering, which is exactly what a
 *    first-day shop sees anyway. A failed suggestion fetch must never produce an
 *    error state on the billing screen.
 *
 * Query keys are not shop-scoped because the auth layer clears the whole React
 * Query cache when the shop or user changes.
 */
const SUGGESTION_QUERY = {
  staleTime: 10 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
  retry: false,
  refetchOnWindowFocus: false,
} as const;

export const activityQueryKeys = {
  recent: ["activity", "recent"] as const,
  personalization: ["activity", "personalization"] as const,
  replenishment: ["activity", "replenishment"] as const,
  insights: (days: number) => ["activity", "insights", days] as const,
  analytics: (days: number) => ["activity", "analytics", days] as const,
};

export function useRecentActivity(enabled = true) {
  return useQuery<RecentActivity>({
    queryKey: activityQueryKeys.recent,
    queryFn: () => fetchRecentActivity(),
    enabled,
    ...SUGGESTION_QUERY,
  });
}

export function usePersonalization(enabled = true) {
  return useQuery<Personalization>({
    queryKey: activityQueryKeys.personalization,
    queryFn: () => fetchPersonalization(),
    enabled,
    ...SUGGESTION_QUERY,
  });
}

export function useReplenishmentSuggestions(enabled = true) {
  return useQuery<ReplenishmentSuggestion[]>({
    queryKey: activityQueryKeys.replenishment,
    queryFn: () => fetchReplenishment(),
    enabled,
    ...SUGGESTION_QUERY,
  });
}

// Owner-only surfaces. These are explicit screens the user opened, so unlike the
// suggestion hooks they do surface their loading and error state.
export function useActivityInsights(days = 30, enabled = true) {
  return useQuery<ActivityInsights>({
    queryKey: activityQueryKeys.insights(days),
    queryFn: () => fetchInsights(days),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useActivityAnalytics(days = 30, enabled = true) {
  return useQuery<ActivityAnalytics>({
    queryKey: activityQueryKeys.analytics(days),
    queryFn: () => fetchActivityAnalytics(days),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
