import { apiRequest } from "@/lib/api/http";

export type SupportScope = "diagnose" | "repair";

export type SupportCommandType =
  | "COLLECT_DIAGNOSTICS"
  | "RUN_SYNC_NOW"
  | "RETRY_FAILED_SYNC"
  | "PULL_FROM_CLOUD"
  | "CLEAR_LOCAL_CACHE"
  | "REFRESH_APP";

export interface SupportSessionDto {
  id: string;
  shopId: string;
  scope: SupportScope;
  status: "pending" | "active" | "ended" | "revoked" | "expired";
  deviceId: string | null;
  operatorEmail: string | null;
  reason: string | null;
  redeemedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  endedAt: string | null;
  commandCount: number;
  createdAt: string;
  expiresInSeconds: number;
}

/** Only ever present on the create response — the code is not stored in the clear. */
export interface SupportSessionGrantDto extends SupportSessionDto {
  code: string;
}

export interface SupportCommandDto {
  id: string;
  type: SupportCommandType;
  label: string;
  ownerSummary: string | null;
  /** Set when a playbook issued this rather than a person. */
  playbookId: string | null;
  automatic: boolean;
  deviceId: string;
  status: "queued" | "delivered" | "applied" | "failed" | "expired" | "cancelled";
  reason: string | null;
  issuedByEmail: string | null;
  attempts: number;
  deliveredAt: string | null;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
}

export interface AutoFixSettings {
  enabled: boolean;
}

/** A setting support changed on the shop's behalf, with what it used to be. */
export interface SettingRepairDto {
  id: string;
  key: string;
  label: string;
  operatorEmail: string | null;
  reason: string | null;
  before: string | null;
  after: string | null;
  createdAt: string;
}

export interface SupportStateDto {
  activeSession: SupportSessionDto | null;
  recentCommands: SupportCommandDto[];
  recentSessions: SupportSessionDto[];
  autoFix: AutoFixSettings;
  settingRepairs: SettingRepairDto[];
}

/** A playbook match: the problem the server sees and the fix it maps to. */
export interface PlaybookSuggestion {
  playbookId: string;
  title: string;
  command: SupportCommandType;
  tier: "auto" | "suggest";
  confidence: number;
  ownerSummary: string | null;
  evidence: Record<string, unknown>;
}

/** A command the server has handed this device to run. */
export interface PendingDeviceCommand {
  id: string;
  type: SupportCommandType;
  params: Record<string, unknown>;
  label: string;
  ownerSummary: string | null;
  reloadsApp: boolean;
  issuedByEmail: string | null;
  reason: string | null;
  createdAt: string;
}

export function createSupportSession(payload: {
  scope?: SupportScope;
  deviceId?: string | null;
  reason?: string | null;
  expiresInMinutes?: number;
}) {
  return apiRequest<SupportSessionGrantDto>("/support/sessions", { method: "POST", body: JSON.stringify(payload) });
}

export function getSupportState() {
  return apiRequest<SupportStateDto>("/support/state");
}

export function setAutoFixEnabled(enabled: boolean) {
  return apiRequest<AutoFixSettings>("/support/auto-fix", { method: "PATCH", body: JSON.stringify({ enabled }) });
}

export function revokeSupportSession(sessionId?: string) {
  return apiRequest<{ session: SupportSessionDto; cancelledCommands: number }>(
    sessionId ? `/support/sessions/${encodeURIComponent(sessionId)}` : "/support/sessions",
    { method: "DELETE" },
  );
}

/**
 * Drained on the sync timer. `background` keeps a poll from tripping a global
 * loading state, and `skipRefresh` stops a 401 on a broken device from cascading
 * into a token-refresh storm — this is telemetry-grade traffic, not user traffic.
 */
export function pollDeviceCommands() {
  return apiRequest<{ commands: PendingDeviceCommand[] }>("/support/commands", {
    background: true,
    skipRefresh: true,
  });
}

export function ackDeviceCommand(
  commandId: string,
  payload: { status: "applied" | "failed"; result?: Record<string, unknown>; error?: string },
) {
  return apiRequest<SupportCommandDto>(`/support/commands/${encodeURIComponent(commandId)}/ack`, {
    method: "POST",
    body: JSON.stringify(payload),
    background: true,
    skipRefresh: true,
  });
}
