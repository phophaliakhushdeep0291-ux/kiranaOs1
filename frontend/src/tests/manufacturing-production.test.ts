import { describe, expect, it } from "vitest";
import { completionPayload, initialCompletion, type RunDetails } from "@/features/verticals/manufacturing/production-run";

function fixture(): RunDetails {
  return {
    run: { id: "run", bomId: "recipe", locationId: "location", runNumber: "RUN-1", status: "planned", qcStatus: "pending", plannedOutputBaseQty: 20,
      bom: { id: "recipe", name: "Recipe", status: "active", finishedProductId: "finished", outputQuantityBaseQty: 10,
        items: [{ materialProductId: "raw", quantityBaseQty: 12, wastagePercent: 10 }, { materialProductId: "label", quantityBaseQty: 5, wastagePercent: 0 }] } },
    products: [
      { id: "finished", packagingMode: "per_pack", sellingUnits: [{ id: "bag", isActive: true, conversionToBase: 2 }] },
      { id: "raw", batchTrackingEnabled: true, sellingUnits: [] },
      { id: "label", sellingUnits: [] },
    ] as RunDetails["products"],
    lots: [{ id: "lot", productId: "raw", batchNumber: "RAW-1", expiresOn: "2028-01-01", availableBaseQty: 30 }],
  };
}
function ready(details: RunDetails) {
  const draft = initialCompletion(details);
  draft.batch = " FINISHED-1 "; draft.manufacturedOn = "2026-09-09"; draft.expiresOn = "2027-09-09";
  draft.materials.raw[0].inventoryLotId = "lot";
  return draft;
}
describe("production entry", () => {
  it("scales every ingredient including wastage and starts with a QC hold", () => {
    const draft = initialCompletion(fixture());
    expect(draft.outputs[0]).toMatchObject({ amount: "10", sellingUnitId: "bag" });
    expect(draft.materials.raw[0].amount).toBe("26.4");
    expect(draft.materials.label[0].amount).toBe("10");
    expect(draft.materials.raw[0].inventoryLotId).toBe("");
    expect(draft.qcStatus).toBe("conditional");
  });
  it("submits actual quantities and reconciled packaging instead of silently replacing them with the plan", () => {
    const details = fixture(); const draft = ready(details);
    draft.outputs[0].amount = "9"; draft.materials.raw[0].amount = "25";
    const payload = completionPayload(details, draft);
    expect(payload.actualOutputBaseQty).toBe(18);
    expect(payload.outputs).toEqual([{ quantityBaseQty: 18, sellingUnitId: "bag", packageCount: 9 }]);
    expect(payload.consumptions[0]).toMatchObject({ actualBaseQty: 25, inventoryLotId: "lot" });
    expect(payload.finishedBatchNumber).toBe("FINISHED-1");
  });
  it("requires every recipe material and a usable batch belonging to that material", () => {
    const details = fixture(); const draft = ready(details);
    delete draft.materials.label;
    expect(() => completionPayload(details, draft)).toThrow("quantity");
    draft.materials.label = [{ key: "label", amount: "10", sellingUnitId: "" }];
    draft.materials.raw[0].inventoryLotId = "";
    expect(() => completionPayload(details, draft)).toThrow("sourceBatch");
    draft.materials.raw[0].inventoryLotId = "lot"; details.lots[0].productId = "label";
    expect(() => completionPayload(details, draft)).toThrow("sourceBatch");
  });
  it("blocks quantities above the selected batch's available stock", () => {
    const details = fixture(); const draft = ready(details); draft.materials.raw[0].amount = "31";
    expect(() => completionPayload(details, draft)).toThrow("stock");
  });
  it.each(["2026-99-01", "2026-02-30", "", "2026-09-09"])("reports an actionable date error for %s", (expiry) => {
    const details = fixture(); const draft = ready(details); draft.expiresOn = expiry;
    expect(() => completionPayload(details, draft)).toThrow(/^dates$/);
  });
  it("rejects missing, inactive or unknown packaging", () => {
    const details = fixture(); const draft = ready(details);
    for (const id of ["", "unknown"]) { draft.outputs[0].sellingUnitId = id; expect(() => completionPayload(details, draft)).toThrow("quantity"); }
    draft.outputs[0].sellingUnitId = "bag"; details.products[0].sellingUnits![0].isActive = false;
    expect(() => completionPayload(details, draft)).toThrow("quantity");
  });
  it("splits a material across batches and sums different finished packaging", () => {
    const details = fixture(); const draft = ready(details);
    details.lots.push({ ...details.lots[0], id: "lot2", batchNumber: "RAW-2" });
    details.products[0].sellingUnits!.push({ id: "carton", isActive: true, conversionToBase: 5 } as NonNullable<RunDetails["products"][number]["sellingUnits"]>[number]);
    draft.materials.raw = [{ key: "first", amount: "6.4", sellingUnitId: "", inventoryLotId: "lot" }, { key: "second", amount: "20", sellingUnitId: "", inventoryLotId: "lot2" }];
    draft.outputs = [{ key: "bag", amount: "5", sellingUnitId: "bag" }, { key: "carton", amount: "2", sellingUnitId: "carton" }];
    const result = completionPayload(details, draft);
    expect(result.consumptions).toHaveLength(3);
    expect(result.consumptions.filter(row => row.productId === "raw").map(row => row.actualBaseQty)).toEqual([6.4, 20]);
    expect(result.actualOutputBaseQty).toBe(20);
    expect(result.outputs.map(row => row.quantityBaseQty)).toEqual([10, 10]);
  });
  it("rejects duplicate source rows and duplicate output packaging", () => {
    const details = fixture(); const draft = ready(details);
    draft.materials.raw.push({ ...draft.materials.raw[0], key: "duplicate" });
    expect(() => completionPayload(details, draft)).toThrow("duplicateSource");
    draft.materials.raw.pop(); draft.outputs.push({ ...draft.outputs[0], key: "duplicate" });
    expect(() => completionPayload(details, draft)).toThrow("duplicateOutput");
  });
  it("checks cumulative source-lot stock across different packaging rows", () => {
    const details = fixture(); const draft = ready(details);
    details.products[1].sellingUnits = [{ id: "raw-pack", isActive: true, conversionToBase: 2 }] as RunDetails["products"][number]["sellingUnits"];
    draft.materials.raw[0].amount = "25";
    draft.materials.raw.push({ key: "second", sellingUnitId: "raw-pack", inventoryLotId: "lot", amount: "3" });
    expect(() => completionPayload(details, draft)).toThrow("stock");
    draft.materials.raw[1].amount = "2";
    expect(completionPayload(details, draft).consumptions).toHaveLength(3);
    details.lots[0].sellingUnitId = "raw-pack";
    expect(() => completionPayload(details, draft)).toThrow("sourcePack");
  });
  it("rejects fractional input below stock precision and over-limit aggregate output", () => {
    const details = fixture(); const draft = ready(details);
    draft.outputs[0].amount = "0.014";
    expect(() => completionPayload(details, draft)).toThrow("quantity");
    draft.outputs[0].amount = "500000000";
    details.products[0].packagingMode = "pooled";
    draft.outputs.push({ key: "base", amount: "1", sellingUnitId: "" });
    expect(() => completionPayload(details, draft)).toThrow("quantity");
  });
});
