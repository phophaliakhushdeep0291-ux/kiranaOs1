import { describe, expect, it } from "vitest";
import {
  decryptLocalBackupEnvelope,
  encryptLocalBackupPayload,
  LOCAL_BACKUP_FORMAT,
  type LocalBackupPayload,
} from "@/features/core/recovery/local-backup";

const payload: LocalBackupPayload = {
  format: LOCAL_BACKUP_FORMAT,
  schemaVersion: 1,
  databaseVersion: 6,
  createdAt: "2026-08-08T12:00:00.000Z",
  scope: { tenant_id: "shop_1", store_id: "shop_1" },
  device: { device_id: "device_original", metadataOnly: true },
  tables: {
    products: [{ id: "product_1", name: "Rice", tenant_id: "shop_1", store_id: "shop_1" }],
    sync_outbox: [{ clientEventId: "event_1", status: "PENDING", tenant_id: "shop_1", store_id: "shop_1" }],
  },
};

describe("encrypted local backup envelope", () => {
  it("round-trips scoped IndexedDB data without exposing its plaintext", async () => {
    const encrypted = await encryptLocalBackupPayload(payload, "correct horse battery staple");
    expect(encrypted).toContain(LOCAL_BACKUP_FORMAT);
    expect(encrypted).not.toContain("Rice");
    expect(await decryptLocalBackupEnvelope(encrypted, "correct horse battery staple")).toEqual(payload);
  });

  it("rejects a wrong passphrase and ciphertext checksum tampering", async () => {
    const encrypted = await encryptLocalBackupPayload(payload, "correct horse battery staple");
    await expect(decryptLocalBackupEnvelope(encrypted, "different strong passphrase")).rejects.toThrow(/wrong|damaged/i);

    const envelope = JSON.parse(encrypted) as { ciphertextSha256: string };
    envelope.ciphertextSha256 = "0".repeat(64);
    await expect(decryptLocalBackupEnvelope(JSON.stringify(envelope), "correct horse battery staple")).rejects.toThrow(/checksum/i);
  });

  it("rejects weak backup passphrases", async () => {
    await expect(encryptLocalBackupPayload(payload, "short")).rejects.toThrow(/at least 10/i);
  });
});
