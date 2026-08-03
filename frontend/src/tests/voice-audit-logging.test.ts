import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeAuditLog } from "@/features/core/audit-logs/local-actions";
import { executeVoiceAction } from "@/features/core/voice/voice-actions";
import { buildVoiceCommandAuditPayload, recordVoiceCommandAudit } from "@/features/core/voice/voice-audit";
import type { VoiceIntent } from "@/features/core/voice/voice-types";

vi.mock("@/features/core/audit-logs/local-actions", () => ({
  writeAuditLog: vi.fn(async (input: unknown) => ({ id: "audit_voice_1", input })),
}));

const mockedWriteAuditLog = vi.mocked(writeAuditLog);

function latestAuditPayload() {
  const call = mockedWriteAuditLog.mock.calls.at(-1);
  expect(call).toBeTruthy();
  const input = call?.[0] as { newValue?: unknown };
  expect(input.newValue).toBeTruthy();
  return input.newValue as Record<string, unknown>;
}

function latestAuditInput() {
  const call = mockedWriteAuditLog.mock.calls.at(-1);
  expect(call).toBeTruthy();
  return call?.[0] as Record<string, unknown>;
}

describe("voice command audit logging", () => {
  beforeEach(() => {
    mockedWriteAuditLog.mockClear();
  });

  it("successful voice command creates audit log", async () => {
    const setLocation = vi.fn();
    const setStatus = vi.fn();
    const toast = vi.fn();
    const intent: VoiceIntent = {
      action: "navigate",
      route: "/billing",
      message: "Opening Billing.",
      auditable: true,
    };

    await expect(
      executeVoiceAction({
        spoken: "open billing",
        intent,
        currentLocation: "/dashboard",
        setLocation,
        setStatus,
        toast,
      }),
    ).resolves.toBe(true);

    expect(setLocation).toHaveBeenCalledWith("/billing");
    expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1);
    const input = latestAuditInput();
    const payload = latestAuditPayload();

    expect(input.action).toBe("voice_command");
    expect(input.entityType).toBe("voice_command");
    expect(input.enqueueSync).toBe(true);
    expect(payload.command_text).toBe("open billing");
    expect(payload.parsed_intent).toMatchObject({ action: "navigate", route: "/billing" });
    expect(payload.action_preview).toMatchObject({ type: "navigation", route: "/billing" });
    expect(payload.user_confirmed).toBe(false);
    expect(payload.action_result).toBe("success");
    expect(payload.device_id).toEqual(expect.any(String));
    expect(payload.user_id).toEqual(expect.any(String));
    expect(payload.tenant_id).toEqual(expect.any(String));
    expect(payload.store_id).toEqual(expect.any(String));
    expect(payload.timestamp).toEqual(expect.any(String));
  });

  it("failed parse creates audit log", async () => {
    const intent: VoiceIntent = {
      action: "noop",
      message: "Try a supported command.",
    };

    await expect(
      executeVoiceAction({
        spoken: "random unsupported words",
        intent,
        currentLocation: "/dashboard",
        setLocation: vi.fn(),
        setStatus: vi.fn(),
        toast: vi.fn(),
      }),
    ).resolves.toBe(false);

    expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1);
    const payload = latestAuditPayload();
    expect(payload.command_text).toBe("random unsupported words");
    expect(payload.parsed_intent).toMatchObject({ action: "noop" });
    expect(payload.action_result).toBe("failed");
  });

  it("destructive command logs confirmation and owner PIN status", () => {
    const intent: VoiceIntent = {
      action: "inventory_draft",
      route: "/inventory",
      inventory: { movementType: "correction", productName: "chini", quantity: 50, unit: "kg" },
      requiresConfirmation: true,
      requiresOwnerPin: true,
      message: "Opening inventory entry with your voice details.",
    };

    const payload = buildVoiceCommandAuditPayload(
      {
        commandText: "correction sugar stock 50 kilo",
        intent,
        actionResult: "success",
        userConfirmed: false,
        pinConfirmed: false,
      },
      {
        tenant_id: "tenant_a",
        store_id: "store_a",
        device_id: "device_a",
        user_id: "user_a",
        timestamp: "2026-06-06T12:00:00.000Z",
      },
    );

    expect(payload.action_preview).toMatchObject({
      type: "inventory_draft",
      pin_required: true,
      requires_review: true,
    });
    expect(payload.user_confirmed).toBe(false);
    expect(payload.pin_required).toBe(true);
    expect(payload.pin_confirmed).toBe(false);
  });

  it("PIN value is never stored", async () => {
    const intent: VoiceIntent = {
      action: "inventory_draft",
      route: "/inventory",
      inventory: { movementType: "correction", productName: "sugar", quantity: 50, unit: "kg" },
      requiresConfirmation: true,
      requiresOwnerPin: true,
    };

    await recordVoiceCommandAudit({
      commandText: "correction sugar stock 50 kilo owner pin 1234",
      intent,
      actionResult: "success",
      resultMessage: "Owner PIN 1234 confirmed",
      pinConfirmed: true,
      userConfirmed: true,
    });

    expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(latestAuditInput());
    expect(serialized).not.toContain("1234");
    expect(serialized).toContain("[REDACTED]");
  });
});
