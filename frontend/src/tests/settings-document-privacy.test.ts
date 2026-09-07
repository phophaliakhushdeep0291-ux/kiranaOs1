import { describe, expect, it } from "vitest";
import { settingsPrefsForSync } from "@/features/core/settings/use-settings-prefs";

describe("device document attachments", () => {
  it("excludes document contents and metadata from profile sync without deleting local copies", () => {
    const docs = { pan: { name: "identity.pdf", dataUrl: "data:application/pdf;base64,private", size: 100000 } };
    const prefs = { docs, storeProfile: { state: "Rajasthan" }, bank: { upiId: "qa@example" } };
    expect(settingsPrefsForSync(prefs)).toEqual({ storeProfile: prefs.storeProfile, bank: prefs.bank });
    expect(prefs.docs).toBe(docs);
    expect(JSON.stringify(settingsPrefsForSync(prefs))).not.toContain("identity.pdf");
  });
});
