import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/audit-logs/local-actions", () => ({
  writeAuditLog: vi.fn(async () => ({ id: "audit_1", pendingSync: true })),
}));

import { writeAuditLog } from "@/features/audit-logs/local-actions";
import { recordDataExportLocalFirst } from "@/features/reports/local-actions";

const mockedWriteAuditLog = vi.mocked(writeAuditLog);

describe("data export safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks report export audit when owner PIN is missing", async () => {
    await expect(recordDataExportLocalFirst({ ownerPin: "", reason: "Monthly export", reportType: "local_reports_snapshot" })).rejects.toThrow(/Owner PIN/i);
    expect(mockedWriteAuditLog).not.toHaveBeenCalled();
  });

  it("records owner-approved report export audit", async () => {
    await recordDataExportLocalFirst({
      ownerPin: "1234",
      reason: "Monthly export",
      reportType: "local_reports_snapshot",
      from: "2026-06-01",
      to: "2026-06-06",
      rowCount: 7,
    });

    expect(mockedWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "data_exported",
      entityType: "report",
      entityId: "local_reports_snapshot",
      reason: "Monthly export",
      ownerPinProvided: true,
      newValue: expect.objectContaining({ rowCount: 7 }),
    }));
  });
});
