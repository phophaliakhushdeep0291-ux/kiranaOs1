import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Shop } from "@/types/api";

const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  outbox: [] as Array<Record<string, unknown>>,
  idCounter: 0,
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: vi.fn(async (key: string) => state.settings.get(key) ?? null),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      state.settings.set(key, value);
    }),
    enqueueOutboxOperation: vi.fn(async (event: Record<string, unknown>) => {
      state.outbox.push(event);
    }),
  },
}));

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({
    tenant_id: "tenant_test",
    store_id: "store_test",
    device_id: "device_test",
  }),
  nowIso: () => "2026-07-08T10:00:00.000Z",
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_${++state.idCounter}`),
}));

import { offlineDB } from "@/lib/offline/db";
import { updateSettingsLocalFirst } from "@/features/settings/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);

const existingShop: Shop = {
  id: "shop_1",
  name: "Krish Store",
  ownerName: "Owner",
  city: "Jodhpur",
  address: "Main Road",
  gstNumber: null,
  phone: null,
  settingsJson: JSON.stringify({ customerOrdering: { enabled: false }, printPreview: true }),
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
};

describe("settings local actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.settings = new Map<string, unknown>([["shop", { ...existingShop }]]);
    state.outbox = [];
    state.idCounter = 0;
  });

  it("preserves settingsJson when saving customer QR ordering locally", async () => {
    const settingsJson = JSON.stringify({ customerOrdering: { enabled: true }, printPreview: true });

    const saved = await updateSettingsLocalFirst({ settingsJson, ownerPin: "1234" });

    expect(saved).toEqual(expect.objectContaining({
      id: "shop_1",
      name: "Krish Store",
      settingsJson,
    }));
    expect(mockedOfflineDB.setSetting).toHaveBeenCalledWith("shop", expect.objectContaining({ settingsJson }));
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]).toEqual(expect.objectContaining({
      entity_type: "settings",
      operation_type: "UPDATE_SETTINGS",
      payload: expect.objectContaining({
        shop: expect.objectContaining({ settingsJson }),
      }),
    }));
  });
});
