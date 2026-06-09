import { dexieDB } from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { createLocalId } from "@/lib/offline/instant-cache";
import { enqueueOutboxOperation } from "@/features/sync/outbox";
import { createPendingDeviceRegistration, markDeviceRemovePending, type DeviceRegistration } from "@/features/devices/license";

export async function addDeviceLocalFirst(deviceName: string): Promise<DeviceRegistration> {
  const name = deviceName.trim();
  if (name.length < 2) throw new Error("Enter a device name before adding.");
  const device = await createPendingDeviceRegistration(name);
  await enqueueOutboxOperation({
    entity_type: "device_license",
    entity_id: device.id,
    operation_type: "DEVICE_ADD_PENDING",
    payload: { device, requested_at: nowIso() },
    idempotency_key: `device-add:${device.tenant_id}:${device.store_id}:${device.id}`,
  });
  await writeDeviceAudit("device_activation", device.id, { device_name: name });
  return device;
}

export async function removeDeviceLocalFirst(deviceId: string, ownerPin: string): Promise<DeviceRegistration> {
  const device = await markDeviceRemovePending(deviceId, ownerPin);
  await enqueueOutboxOperation({
    entity_type: "device_license",
    entity_id: device.id,
    operation_type: "DEVICE_REMOVE_PENDING",
    payload: { device_id: device.device_id, row_id: device.id, owner_pin_provided: true, requested_at: nowIso() },
    idempotency_key: `device-remove:${device.tenant_id}:${device.store_id}:${device.id}`,
  });
  await writeDeviceAudit("device_remove_requested", device.id, { device_id: device.device_id });
  return device;
}

async function writeDeviceAudit(action: string, entityId: string, after: Record<string, unknown>) {
  const scope = getOfflineScope();
  const now = nowIso();
  await dexieDB.local_audit_logs.put({
    id: createLocalId("audit"),
    action,
    entity_type: "device_license",
    entity_id: entityId,
    after,
    actor_id: "owner",
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 1,
    sync_status: "pending_sync",
    last_modified_by: "owner",
  });
}
