import { apiRequest } from "@/lib/api/http";
import type {
  PlaybookSuggestion,
  SupportCommandDto,
  SupportCommandType,
  SupportScope,
  SupportSessionDto,
} from "@/features/core/remote-support/api";

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

// ── Remote support (operator side) ───────────────────────────────────
// Being a platform admin is not enough to call any of these: the server also
// re-checks, on every request, that the shop's owner has a live session open.

export interface SupportCommandDefinition {
  type: SupportCommandType;
  scope: SupportScope;
  label: string;
  ownerSummary: string;
  reloadsApp: boolean;
}

export interface OperatorShopDevice {
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  status: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
}

export interface OperatorDiagnostics {
  session: SupportSessionDto;
  shop: { id: string; name: string; createdAt: string } | null;
  incident: Record<string, unknown> | null;
  errors: { id: string; title: string; count: number; status: string; lastSeenAt: string }[];
  sync: Record<string, unknown> | null;
  deviceHealth: Record<string, unknown>[];
  supportRequests: { id: string; description: string; status: string; createdAt: string }[];
  devices: OperatorShopDevice[];
  commands: SupportCommandDto[];
  /** Playbook matches for the focused device — the same reasoning auto-fix uses. */
  suggestions: PlaybookSuggestion[];
  autoFix: { enabled: boolean };
  focusDeviceId: string | null;
}

export function getSupportCatalog() {
  return apiRequest<{
    commands: SupportCommandDefinition[];
    scopes: SupportScope[];
    playbooks: { id: string; title: string; command: SupportCommandType; tier: "auto" | "suggest" }[];
  }>("/platform-admin/support/catalog");
}

export function redeemSupportCode(code: string) {
  return apiRequest<{ session: SupportSessionDto; shop: { id: string; name: string } | null }>(
    "/platform-admin/support/redeem",
    { method: "POST", body: JSON.stringify({ code }) },
  );
}

export function getSupportDiagnostics(sessionId: string, options: { problem?: string; deviceId?: string } = {}) {
  const params = new URLSearchParams();
  if (options.problem) params.set("problem", options.problem);
  // Playbook suggestions are per-device, so they follow whichever device the
  // operator has selected rather than always describing the first one.
  if (options.deviceId) params.set("deviceId", options.deviceId);
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<OperatorDiagnostics>(
    `/platform-admin/support/sessions/${encodeURIComponent(sessionId)}/diagnostics${query}`,
  );
}

export function dispatchSupportCommand(payload: {
  sessionId: string;
  type: SupportCommandType;
  deviceId?: string;
  reason?: string;
}) {
  return apiRequest<SupportCommandDto>("/platform-admin/support/commands", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Settings repair ──────────────────────────────────────────────────
// The one remote path that writes the shop's own data. Repair-scope only, and
// every key is a named catalog entry rather than a settings path.

export interface RepairableSetting {
  key: string;
  label: string;
  description: string;
  input: "gstin" | "none";
  needsLocation: boolean;
  currentValue: string | null;
  context: Record<string, unknown> | null;
  unavailable: boolean;
}

export interface SettingRepairRecord {
  id: string;
  key: string;
  label: string;
  operatorEmail: string | null;
  reason: string | null;
  before: string | null;
  after: string | null;
  createdAt: string;
}

export function getRepairableSettings(sessionId: string, locationId?: string) {
  const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  return apiRequest<{ settings: RepairableSetting[]; history: SettingRepairRecord[]; canRepair: boolean }>(
    `/platform-admin/support/sessions/${encodeURIComponent(sessionId)}/settings${query}`,
  );
}

export function repairSetting(payload: {
  sessionId: string;
  key: string;
  value?: string | null;
  locationId?: string;
  reason?: string;
}) {
  return apiRequest<{
    key: string;
    label: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    nudgedDevices: string[];
  }>("/platform-admin/support/settings", { method: "POST", body: JSON.stringify(payload) });
}

export function endSupportSession(sessionId: string) {
  return apiRequest<SupportSessionDto>(`/platform-admin/support/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}
