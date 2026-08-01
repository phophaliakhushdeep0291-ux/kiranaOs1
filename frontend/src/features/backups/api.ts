import { apiRequest } from "@/lib/api/http";

export type BackupArtifactStatus = "queued" | "processing" | "completed" | "failed" | "expired";

export interface BackupArtifact {
  id: string;
  type: "shop_logical";
  status: BackupArtifactStatus;
  format: string;
  storage_provider: string | null;
  checksum_sha256: string | null;
  size_bytes: string | null;
  record_count: number | null;
  schema_version: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface BackupListResponse {
  backups: BackupArtifact[];
  retention_days: number;
}

export interface BackupRestorePreview {
  artifact_id: string;
  restorable: true;
  schema_version: string;
  created_at: string;
  record_count: number;
  table_counts: Record<string, number>;
  credentials_preserved: boolean;
  warnings: string[];
}

export interface BackupRestoreResult {
  artifact_id: string;
  restoredRecords: number;
  restoredTables: number;
  recovery_backup: BackupArtifact;
}

export function listShopBackups(options: { background?: boolean } = {}) {
  return apiRequest<BackupListResponse>("/jobs/backups", {
    method: "GET",
    background: options.background,
  });
}

export function createShopBackup(ownerPin: string) {
  return apiRequest<{ backup: BackupArtifact }>("/jobs/backups", {
    method: "POST",
    ownerPin,
    body: "{}",
  });
}

export function downloadShopBackup(id: string, ownerPin: string) {
  return apiRequest<Blob>(`/jobs/backups/${encodeURIComponent(id)}/download`, {
    method: "GET",
    ownerPin,
    responseType: "blob",
  });
}

export function previewShopBackupRestore(id: string, ownerPin: string) {
  return apiRequest<{ preview: BackupRestorePreview }>(`/jobs/backups/${encodeURIComponent(id)}/restore-preview`, {
    method: "POST",
    ownerPin,
    body: "{}",
  });
}

export function restoreShopBackup(id: string, confirmation: string, ownerPin: string) {
  return apiRequest<{ restore: BackupRestoreResult }>(`/jobs/backups/${encodeURIComponent(id)}/restore`, {
    method: "POST", ownerPin, body: JSON.stringify({ confirmation }), timeoutMs: 240_000,
  });
}

export function saveBackupBlob(blob: Blob, artifact: BackupArtifact) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `artha-shop-${artifact.id}.kosb`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
