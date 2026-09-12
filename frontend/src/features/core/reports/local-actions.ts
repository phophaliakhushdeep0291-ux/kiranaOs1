import { ownerPinRequiredActionSchema } from "@/lib/validation";
import { parseOrThrow } from "@/lib/offline/actions/utils";
import { writeAuditLog } from "@/features/core/audit-logs/local-actions";
import { verifyOwnerPin } from "@/features/core/settings/api";
import { isActionProtected } from "@/features/core/settings/security-policy";

export interface DataExportApprovalInput {
  ownerPin: string;
  reason?: string;
  reportType: string;
  from?: string;
  to?: string;
  format?: "json" | "csv" | "xml";
  rowCount?: number;
}

export async function recordDataExportLocalFirst(input: DataExportApprovalInput) {
  const protectedExport = isActionProtected("exportData") || Boolean(input.ownerPin);
  if (protectedExport) parseOrThrow(ownerPinRequiredActionSchema, {
    action: "data_export",
    ownerPin: input.ownerPin,
    reason: input.reason,
    entityId: input.reportType,
  });

  // Export is irreversible disclosure, so a four-digit shape check is not
  // authorization. Verify with the server before the browser creates a file.
  if (protectedExport) {
    const result = await verifyOwnerPin(input.ownerPin);
    if (!result.valid) throw new Error("Owner PIN verification failed");
  }

  return writeAuditLog({
    action: "data_exported",
    entityType: "report",
    entityId: input.reportType,
    entityLabel: input.reportType,
    newValue: {
      reportType: input.reportType,
      from: input.from,
      to: input.to,
      format: input.format ?? "json",
      rowCount: input.rowCount ?? 0,
    },
    reason: (input.reason?.trim() || "Data export approved by owner"),
    ownerPinProvided: protectedExport,
    summary: `${input.reportType} exported from ${input.from ?? "start"} to ${input.to ?? "today"}`,
  });
}
