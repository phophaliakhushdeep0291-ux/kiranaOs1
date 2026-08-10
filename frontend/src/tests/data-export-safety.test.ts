import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/core/audit-logs/local-actions", () => ({
  writeAuditLog: vi.fn(async () => ({ id: "audit_1", pendingSync: true })),
}));

vi.mock("@/features/core/settings/api", () => ({
  verifyOwnerPin: vi.fn(async () => ({ valid: true })),
}));

import { writeAuditLog } from "@/features/core/audit-logs/local-actions";
import { verifyOwnerPin } from "@/features/core/settings/api";
import { recordDataExportLocalFirst } from "@/features/core/reports/local-actions";

const mockedWriteAuditLog = vi.mocked(writeAuditLog);
const mockedVerifyOwnerPin = vi.mocked(verifyOwnerPin);

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

    expect(mockedVerifyOwnerPin).toHaveBeenCalledWith("1234");
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "data_exported",
      entityType: "report",
      entityId: "local_reports_snapshot",
      reason: "Monthly export",
      ownerPinProvided: true,
      newValue: expect.objectContaining({ rowCount: 7 }),
    }));
  });

  it("does not export or audit when the server rejects a well-formed but wrong PIN", async () => {
    mockedVerifyOwnerPin.mockRejectedValueOnce(new Error("Wrong owner PIN"));

    await expect(recordDataExportLocalFirst({
      ownerPin: "9999",
      reason: "Attempted export",
      reportType: "local_reports_snapshot",
    })).rejects.toThrow("Wrong owner PIN");

    expect(mockedWriteAuditLog).not.toHaveBeenCalled();
  });
});
