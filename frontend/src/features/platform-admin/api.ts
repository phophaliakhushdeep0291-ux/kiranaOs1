import { apiRequest } from "@/lib/api/http";

export interface PlatformOverview {
  generatedAt: string;
  shops: { total: number; online: number; offline: number };
  devices: { total: number; active: number };
  incidents: { recentCrashes24h: number; failedSyncEvents: number; openConflicts: number; openSupportRequests: number };
  topErrors: { id: string; title: string; source: string; count: number; status: string; errorCode: string | null; shopId: string | null; lastSeenAt: string }[];
  failedEndpoints: { endpoint: string; count: number }[];
  appVersions: { appVersion: string; count: number }[];
  recentSupportRequests: { id: string; shopId: string; description: string; page: string | null; status: string; appVersion: string | null; createdAt: string }[];
  worstHealthStores: { shopId: string; minHealthScore: number }[];
  queue: { enabled: boolean; redis: { connected?: boolean } & Record<string, unknown> };
}

export function getPlatformAccess() {
  return apiRequest<{ isPlatformAdmin: boolean }>("/platform-admin/access");
}

export function getPlatformOverview() {
  return apiRequest<PlatformOverview>("/platform-admin/overview");
}
