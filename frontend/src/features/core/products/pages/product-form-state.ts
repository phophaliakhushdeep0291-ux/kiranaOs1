import { z } from "zod";
import type { Product, ProductInput, ProductSellingUnit } from "@/lib/api/client";
import { getStoredBusinessType, type BusinessType } from "@/features/core/settings/business-type-store";
import { BUSINESS_TYPE_DEFS, defaultCategoryFor } from "@/features/core/settings/business-types";
import { mergeProductAliasSuggestions, splitProductAliases } from "@/features/core/products/product-reliability";
import { normalizeProductAttributes, productAttributesForSave } from "@/features/core/products/product-attributes";
import { averageCost, baseUnitFor, fromBaseQty, isScaleUnit, sellingUnitCode, sellingUnitConversion, sellingUnitName, toBaseQty } from "./product-pricing";
import { roundMoney } from "@/lib/money";

const sellingUnitFormSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  unitType: z.string(),
  unitCode: z.string(),
  packSizeValue: z.number().nullable().optional(),
  packSizeUnit: z.string().nullable().optional(),
  conversionToBase: z.number(),
  barcode: z.string().nullable().optional(),
  defaultPrice: z.number(),
  minimumPrice: z.number().nullable().optional(),
  maximumPrice: z.number().nullable().optional(),
  costPrice: z.number().nullable().optional(),
  // Only meaningful when the product is "per_pack": how many of THIS pack are on
  // the shelf, and the level at which this size alone needs reordering. Pooled
  // products leave them null and keep using the single shared stock number.
  onHandQty: z.number().nullable().optional(),
  lowStockThreshold: z.number().nullable().optional(),
  // Where this row sits on the product's variant axes. Carried through the form
  // explicitly: anything not named here is dropped on save, which would strip
  // every size and colour off a garment the moment it was edited.
  variantValue1: z.string().nullable().optional(),
  variantValue2: z.string().nullable().optional(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});

const variantAxisFormSchema = z.object({
  name: z.string(),
  values: z.array(z.string()),
});

export const productFormSchema = z.object({
  name: z.string().trim().min(1, "Product name required"),
  category: z.string().trim().min(1).default("general"),
  brand: z.string().trim().optional(),
  unit: z.string().trim().min(1).default("piece"),
  packSizeValue: z.coerce.number().positive("Pack size must be greater than zero").default(1),
  packSizeUnit: z.string().trim().min(1).default("piece"),
  sellingUnits: z.array(sellingUnitFormSchema).default([]),
  // The size × colour grid. Empty for every ordinary product, which is what
  // keeps a kirana shop's form exactly as it was.
  variantAxes: z.array(variantAxisFormSchema).max(2).default([]),
  // "pooled": every pack draws on one shared stock number — loose rice, where 1 kg
  // and a 5 kg bag come out of the same sack. "per_pack": each pack is counted and
  // reordered on its own, so the shopkeeper can see WHICH size has run low.
  packagingMode: z.enum(["pooled", "per_pack"]).default("pooled"),
  barcode: z.string().trim().optional(),
  hsn: z.string().trim().optional(),
  aliasesText: z.string().optional(),
  mrp: z.coerce.number().min(0).default(0),
  costPrice: z.coerce.number().min(0).default(0),
  sellingPrice: z.coerce.number().positive("Selling price required"),
  gstRate: z.coerce.number().min(0).max(100).default(0),
  minimumSellingPrice: z.coerce.number().min(0).default(0),
  retailPrice: z.coerce.number().min(0).default(0),
  retailFromQuantity: z.coerce.number().min(0).default(1),
  wholesalePrice: z.coerce.number().min(0).default(0),
  wholesaleFromQuantity: z.coerce.number().min(0).default(10),
  stockQuantity: z.coerce.number().min(0).default(0),
  lowStockAlert: z.coerce.number().min(0).default(0),
  batchTrackingEnabled: z.boolean().default(false),
  // h | h1 | x | otc, or null for anything that is not a scheduled drug — which
  // is every product until a pharmacy classifies it. Setting h/h1/x is what
  // makes billing demand a prescription for this medicine.
  drugSchedule: z.enum(["h", "h1", "x", "otc"]).nullable().default(null),
  // Trade details — the facts this shop type needs and no other does. Held as a
  // bag rather than as named fields because the set changes with the business
  // type; product-attributes.ts is the catalogue that says which keys are real.
  // Values a previous trade left behind ride along here untouched, so re-saving
  // a product after switching shop type cannot silently drop them.
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  reorderLevel: z.coerce.number().min(0).default(0),
  description: z.string().trim().max(500).optional(),
  imageUrl: z.string().optional(),
  isLooseItem: z.boolean().default(false),
  isActive: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (!value.isLooseItem && ["packet", "pack", "pouch"].includes(value.unit.toLowerCase())) {
    if (!(value.packSizeValue > 0) || !value.packSizeUnit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packSizeValue"], message: "Tell us what one packet contains" });
    }
  }
});

export type ProductFormData = z.infer<typeof productFormSchema>;

export interface ProductDraftPayload {
  mode?: "create" | "edit";
  productName?: string;
  name?: string;
  category?: string;
  brand?: string;
  unit?: string;
  packSizeValue?: number;
  packSizeUnit?: string;
  barcode?: string;
  hsn?: string;
  aliases?: string[];
  mrp?: number;
  gstRate?: number;
  reorderLevel?: number;
  description?: string;
  imageUrl?: string;
  costPrice?: number;
  sellingPrice?: number;
  minimumSellingPrice?: number;
  retailPrice?: number;
  retailFromQuantity?: number;
  wholesalePrice?: number;
  wholesaleFromQuantity?: number;
  stockQuantity?: number;
  lowStockAlert?: number;
}

export interface ProductDraftEventDetail {
  draft: ProductDraftPayload;
  merge: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalAliases(record: Record<string, unknown>): string[] | undefined {
  const value = record.aliases;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

export function readProductDraftEventDetail(detail: unknown): ProductDraftEventDetail | null {
  if (!isRecord(detail) || !isRecord(detail.draft)) return null;
  const draftRecord = detail.draft;
  const modeValue = draftRecord.mode;
  return {
    merge: detail.merge === true,
    draft: {
      mode: modeValue === "create" || modeValue === "edit" ? modeValue : undefined,
      productName: optionalString(draftRecord, "productName"),
      name: optionalString(draftRecord, "name"),
      category: optionalString(draftRecord, "category"),
      brand: optionalString(draftRecord, "brand"),
      unit: optionalString(draftRecord, "unit"),
      packSizeValue: optionalNumber(draftRecord, "packSizeValue"),
      packSizeUnit: optionalString(draftRecord, "packSizeUnit"),
      barcode: optionalString(draftRecord, "barcode"),
      hsn: optionalString(draftRecord, "hsn"),
      aliases: optionalAliases(draftRecord),
      mrp: optionalNumber(draftRecord, "mrp"),
      gstRate: optionalNumber(draftRecord, "gstRate"),
      reorderLevel: optionalNumber(draftRecord, "reorderLevel"),
      description: optionalString(draftRecord, "description"),
      imageUrl: optionalString(draftRecord, "imageUrl"),
      costPrice: optionalNumber(draftRecord, "costPrice"),
      sellingPrice: optionalNumber(draftRecord, "sellingPrice"),
      minimumSellingPrice: optionalNumber(draftRecord, "minimumSellingPrice"),
      retailPrice: optionalNumber(draftRecord, "retailPrice"),
      retailFromQuantity: optionalNumber(draftRecord, "retailFromQuantity"),
      wholesalePrice: optionalNumber(draftRecord, "wholesalePrice"),
      wholesaleFromQuantity: optionalNumber(draftRecord, "wholesaleFromQuantity"),
      stockQuantity: optionalNumber(draftRecord, "stockQuantity"),
      lowStockAlert: optionalNumber(draftRecord, "lowStockAlert"),
    },
  };
}

/**
 * What a new product is sold as, before the shop says otherwise.
 *
 * The trade's own first unit, skipping weight and volume — those belong to loose
 * selling, and a manufacturer would otherwise start every finished good in
 * kilograms. In practice this only moves two trades off "piece", and both were
 * plainly wrong there: a shoe shop sells pairs and a chemist sells strips.
 */
function defaultSellingUnitFor(businessType: BusinessType): string {
  const primaryUnits = BUSINESS_TYPE_DEFS[businessType]?.primaryUnits ?? [];
  return primaryUnits.find((unit) => !isScaleUnit(unit)) ?? "piece";
}

export function productToForm(product?: Product): ProductFormData {
  const defaultUnit = product?.sellingUnits?.find((row) => row.isDefault) ?? product?.sellingUnits?.[0];
  // Products saved before `packagingMode` existed may still have an individual
  // quantity on each pack. Preserve that established mode when editing them;
  // otherwise merely saving a price would accidentally request a mode change.
  const packagingMode = product?.packagingMode === "per_pack"
    || (product?.packagingMode == null && product?.sellingUnits?.some((row) => row.onHandQty != null))
    ? "per_pack"
    : "pooled";
  const businessType = getStoredBusinessType();
  const unit = defaultUnit?.unitType ?? product?.unit ?? product?.rateUnit ?? product?.displayUnit
    ?? defaultSellingUnitFor(businessType);
  const sellingPrice = product?.sellingPrice ?? product?.defaultPricePerRateUnit ?? 0;
  return {
    name: product?.name ?? "",
    // A new product starts in one of THIS trade's categories. "general" is not on
    // eleven of the twelve lists, so it left the picker looking empty while the
    // form quietly held a value no filter would ever show.
    category: product?.category ?? defaultCategoryFor(businessType),
    brand: product?.brand ?? "",
    unit,
    packSizeValue: defaultUnit?.packSizeValue ?? 1,
    packSizeUnit: defaultUnit?.packSizeUnit ?? product?.baseUnit ?? (product?.isLooseItem ? unit : "piece"),
    sellingUnits: product?.sellingUnits ?? [],
    variantAxes: product?.variantAxes ?? [],
    packagingMode,
    barcode: product?.barcode ?? product?.sku ?? "",
    hsn: product?.hsn ?? "",
    aliasesText: (product?.aliases ?? []).join(", "),
    mrp: product?.mrp ?? 0,
    costPrice: averageCost(product),
    sellingPrice,
    gstRate: product?.gstRate ?? 0,
    minimumSellingPrice: product?.minimumSellingPrice ?? product?.minPricePerRateUnit ?? 0,
    retailPrice: product?.retailPrice ?? product?.retailPricePerRateUnit ?? sellingPrice,
    retailFromQuantity: product?.retailFromQuantity ?? 1,
    wholesalePrice: product?.wholesalePrice ?? product?.wholesalePricePerRateUnit ?? sellingPrice,
    wholesaleFromQuantity: product?.wholesaleFromQuantity ?? 10,
    // These two boxes describe the DEFAULT pack, and in per-pack mode that pack
    // holds its own count — the product's total belongs to every size together.
    // Dividing the total by the default pack's size instead reported the whole
    // shelf as if it were all 1 kg packets (10 x 1 kg + 20 x 500 g read back as
    // "20 packets"), and saving wrote that inflated figure onto the 1 kg row:
    // opening a per-pack product and pressing Save silently created stock.
    stockQuantity: packagingMode === "per_pack"
      ? roundMoney(Number(defaultUnit?.onHandQty ?? 0))
      : defaultUnit?.conversionToBase
        ? roundMoney(Number(product?.stockBaseQty ?? 0) / defaultUnit.conversionToBase)
        : fromBaseQty(product?.stockBaseQty, unit),
    lowStockAlert: packagingMode === "per_pack" && defaultUnit?.lowStockThreshold != null
      ? roundMoney(Number(defaultUnit.lowStockThreshold))
      : defaultUnit?.conversionToBase
        ? roundMoney(Number(product?.lowStockThreshold ?? 0) / defaultUnit.conversionToBase)
        : fromBaseQty(product?.lowStockThreshold, unit),
    batchTrackingEnabled: product?.batchTrackingEnabled ?? false,
    drugSchedule: product?.drugSchedule ?? null,
    attributes: normalizeProductAttributes(product?.attributes),
    reorderLevel: product?.reorderLevel ?? 0,
    description: product?.description ?? "",
    imageUrl: product?.imageUrl ?? "",
    isLooseItem: product?.isLooseItem ?? false,
    isActive: product?.isActive ?? product?.status !== "inactive",
  };
}

export function formToInput(values: ProductFormData, ownerPin?: string, reason?: string): ProductInput {
  const baseUnit = values.isLooseItem ? baseUnitFor(values.unit) : baseUnitFor(values.packSizeUnit);
  const conversionToBase = values.isLooseItem
    ? toBaseQty(1, values.unit)
    : sellingUnitConversion(values.packSizeValue, values.packSizeUnit);
  const sellingPrice = roundMoney(values.sellingPrice);
  const minPrice = roundMoney(values.minimumSellingPrice);
  const retailPrice = roundMoney(values.retailPrice || sellingPrice);
  const wholesalePrice = roundMoney(values.wholesalePrice || sellingPrice);
  const avgCost = roundMoney(values.costPrice);
  const previousDefault = values.sellingUnits.find((row) => row.isDefault);
  const defaultUnitCode = sellingUnitCode(values.unit, values.packSizeValue, values.packSizeUnit);
  const defaultUnitId = previousDefault?.id && previousDefault.unitCode === defaultUnitCode
    ? previousDefault.id
    : undefined;
  const unitName = values.isLooseItem
    ? values.unit
    : sellingUnitName(values.unit, values.packSizeValue, values.packSizeUnit);
  const defaultSellingUnit: ProductSellingUnit = {
    ...(defaultUnitId ? { id: defaultUnitId } : {}),
    name: unitName,
    unitType: values.unit,
    // The code describes the actual pack. Keep the database id stable when editing,
    // but update the code when a 1 kg packet becomes a 500 g packet so billing and
    // barcode lookups cannot confuse the two sizes.
    unitCode: defaultUnitCode,
    packSizeValue: values.isLooseItem ? null : values.packSizeValue,
    packSizeUnit: values.isLooseItem ? null : values.packSizeUnit,
    conversionToBase,
    barcode: values.barcode?.trim() || null,
    defaultPrice: sellingPrice,
    minimumPrice: minPrice || null,
    maximumPrice: roundMoney(values.mrp) || null,
    costPrice: avgCost || null,
    // The default pack is edited through the main stock fields, so its per-pack
    // count comes from those rather than from a second input the form never shows.
    ...(values.packagingMode === "per_pack"
      ? {
          onHandQty: Number(values.stockQuantity) || 0,
          lowStockThreshold: Number(values.lowStockAlert) || null,
        }
      : {}),
    isDefault: true,
    isActive: true,
  };
  /**
   * A variant grid replaces the packaging rows rather than joining them.
   *
   * For an ordinary product the form synthesises one default pack out of the
   * main unit/size/price fields and appends any extra packs. A garment has no
   * such row: its selling units ARE the size × colour cells, one of which
   * carries `isDefault`. Prepending the synthesised pack here would put a
   * sizeless row on the shelf alongside the grid, and billing would happily
   * sell it.
   */
  const variantRows = values.sellingUnits.filter((row) => row.variantValue1 || row.variantValue2);
  // Defaulted rather than assumed: `formToInput` is exported and called with
  // hand-built form data from the CSV importer and the voice draft path, and a
  // caller predating the grid must not crash on a field it never knew about.
  const variantAxes = values.variantAxes ?? [];
  const hasGrid = variantAxes.length > 0 && variantRows.length > 0;

  const sellingUnits = hasGrid
    ? variantRows
    : [
        defaultSellingUnit,
        ...values.sellingUnits.filter((row) => {
          const isPersistedDefault = Boolean(previousDefault?.id && row.id === previousDefault.id);
          return !row.isDefault && !isPersistedDefault && row.unitCode !== defaultSellingUnit.unitCode;
        }),
      ];

  // Each cell holds its own pieces, so the product's own figure is their sum.
  // The server does not recompute it, and everything that asks "how many of this
  // shirt are there?" without opening the grid reads this number.
  const gridQty = roundMoney(variantRows.reduce((sum, row) => sum + (Number(row.onHandQty) || 0), 0));
  /**
   * Per-pack stock is the sum over every pack, never the default pack alone.
   *
   * In "count each size" mode each row carries its own count, and the server
   * requires the product total to equal sum(count x pack size) — anything else
   * is refused with PACKAGING_STOCK_TOTAL_MISMATCH. This used to be built from
   * the main stock box only, so the moment a second size was given any count at
   * all the save failed outright: "Per-pack opening stock totals 20000 base
   * units, but the product total says 10000." Adding a size and typing how many
   * you have is the ordinary use of the feature, so it failed on the first try
   * on both create and edit.
   */
  const perPackBaseQty = roundMoney(sellingUnits.reduce((sum, row) => (
    row.isActive === false ? sum : sum + (Number(row.onHandQty) || 0) * (Number(row.conversionToBase) || 0)
  ), 0));
  const perPack = !hasGrid && values.packagingMode === "per_pack";
  // A cell is one piece, never a pack, so the grid's total is already in base units.
  const stockBaseQty = hasGrid ? gridQty : perPack ? perPackBaseQty : roundMoney(values.stockQuantity * conversionToBase);
  // The product's stock counted in its own default pack — a display figure that
  // must stay the base total's twin, because readers that have no selling unit to
  // hand multiply it back by the default conversion (see inventoryBaseQuantity).
  const stockQuantity = hasGrid
    ? gridQty
    : perPack && conversionToBase > 0
      ? roundMoney(perPackBaseQty / conversionToBase)
      : values.stockQuantity;

  return {
    name: values.name.trim(),
    category: values.category,
    brand: values.brand?.trim() || undefined,
    unit: values.unit,
    displayUnit: unitName,
    rateUnit: values.unit,
    baseUnit,
    barcode: values.barcode?.trim() || undefined,
    sku: values.barcode?.trim() || undefined,
    hsn: values.hsn?.trim() || undefined,
    aliases: splitProductAliases(values.aliasesText),
    stockBaseQty,
    stockQuantity,
    stockUnit: values.unit,
    stockTrackingEnabled: true,
    trackStock: true,
    costPerRateUnit: avgCost,
    costPrice: avgCost,
    averageCostPrice: avgCost,
    minPricePerRateUnit: minPrice,
    minimumSellingPrice: minPrice,
    defaultPricePerRateUnit: sellingPrice,
    sellingPrice,
    retailPricePerRateUnit: retailPrice,
    retailPrice,
    retailFromQuantity: Number(values.retailFromQuantity || 1),
    wholesalePricePerRateUnit: wholesalePrice,
    wholesalePrice,
    wholesaleFromQuantity: Number(values.wholesaleFromQuantity || 10),
    quantitySlabPricing: [],
    customerSpecificPricing: [],
    sellingUnits,
    variantAxes,
    // A grid always counts per row — that is what makes "which size is out?"
    // answerable, and the server forces it anyway.
    packagingMode: hasGrid ? "per_pack" : values.packagingMode,
    mrp: roundMoney(values.mrp),
    gstRate: Number(values.gstRate || 0),
    reorderLevel: Number(values.reorderLevel || 0),
    description: values.description?.trim() || undefined,
    imageUrl: values.imageUrl || undefined,
    isLooseItem: values.isLooseItem,
    lowStockThreshold: roundMoney(values.lowStockAlert * conversionToBase),
    batchTrackingEnabled: values.batchTrackingEnabled,
    /**
     * The schedule that makes billing demand a prescription.
     *
     * It was missing from this payload entirely: the form held it, the schema
     * validated it, the product screen offered the selector — and the value was
     * dropped on the way out, so no medicine a chemist classified as Schedule H
     * ever asked for a prescription. Nothing caught it because the write path
     * falls back to the product's existing value when the key is absent, so a
     * schedule was never LOST, it simply could never be SET.
     *
     * Always named, including as null, because that is how the shop takes a
     * schedule back off a product it classified by mistake. The importer is
     * unaffected: a new row has no schedule to state, and an updated row builds
     * from productToForm(existing), which carries the saved one through.
     */
    drugSchedule: values.drugSchedule ?? null,
    // The trade whose fields the form just rendered, read from the store rather
    // than passed in: this function is also called by the CSV importer and the
    // voice-draft path, neither of which has a business type to hand, and the
    // store is the same one the form panel itself reads. Naming the trade matters
    // because a field left blank has to be sent as an explicit clear — see
    // productAttributesForSave.
    attributes: productAttributesForSave(getStoredBusinessType(), normalizeProductAttributes(values.attributes)),
    lowStockAlert: values.lowStockAlert,
    isActive: values.isActive,
    status: values.isActive ? "active" : "inactive",
    ownerPin: ownerPin?.trim() || undefined,
    ownerPinReason: reason?.trim() || undefined,
  };
}

const OWNER_APPROVAL_PRODUCT_FIELDS = [
  "stockBaseQty",
  "costPerRateUnit",
  "minPricePerRateUnit",
  "defaultPricePerRateUnit",
  "gstRate",
  "hsn",
  "mrp",
  "barcode",
  "sku",
  "sellingUnits",
  "variantAxes",
  "packagingMode",
  "batchTrackingEnabled",
  "drugSchedule",
  "isActive",
] as const;

function approvalNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? roundMoney(number) : 0;
}

function normalizedApprovalValue(field: typeof OWNER_APPROVAL_PRODUCT_FIELDS[number], value: unknown): unknown {
  if (["stockBaseQty", "costPerRateUnit", "minPricePerRateUnit", "defaultPricePerRateUnit", "gstRate", "mrp"].includes(field)) {
    return approvalNumber(value);
  }
  if (["hsn", "barcode", "sku", "drugSchedule"].includes(field)) {
    return String(value ?? "").trim().toLowerCase() || null;
  }
  if (["batchTrackingEnabled", "isActive"].includes(field)) return Boolean(value);
  if (field === "packagingMode") return String(value ?? "pooled").trim().toLowerCase();
  if (field === "variantAxes") {
    return (Array.isArray(value) ? value : []).map((axis) => {
      const row = axis as { name?: unknown; values?: unknown };
      return {
        name: String(row.name ?? "").trim().toLowerCase(),
        values: (Array.isArray(row.values) ? row.values : []).map((item) => String(item).trim().toLowerCase()),
      };
    });
  }
  if (field === "sellingUnits") {
    return (Array.isArray(value) ? value : []).map((raw) => {
      const unit = raw as Partial<ProductSellingUnit>;
      return {
        unitCode: String(unit.unitCode ?? "").trim().toLowerCase(),
        unitType: String(unit.unitType ?? "").trim().toLowerCase(),
        name: String(unit.name ?? "").trim().toLowerCase(),
        barcode: String(unit.barcode ?? "").trim() || null,
        conversionToBase: approvalNumber(unit.conversionToBase),
        defaultPrice: approvalNumber(unit.defaultPrice),
        minimumPrice: unit.minimumPrice == null ? null : approvalNumber(unit.minimumPrice),
        maximumPrice: unit.maximumPrice == null ? null : approvalNumber(unit.maximumPrice),
        costPrice: unit.costPrice == null ? null : approvalNumber(unit.costPrice),
        onHandQty: unit.onHandQty == null ? null : approvalNumber(unit.onHandQty),
        lowStockThreshold: unit.lowStockThreshold == null ? null : approvalNumber(unit.lowStockThreshold),
        reorderLevel: unit.reorderLevel == null ? null : approvalNumber(unit.reorderLevel),
        variantValue1: String(unit.variantValue1 ?? "").trim().toLowerCase() || null,
        variantValue2: String(unit.variantValue2 ?? "").trim().toLowerCase() || null,
        isDefault: Boolean(unit.isDefault),
        isActive: unit.isActive !== false,
      };
    }).sort((a, b) => a.unitCode.localeCompare(b.unitCode));
  }
  return value;
}

/**
 * Full product records are queued for offline sync, so field presence cannot decide
 * whether an edit is sensitive. Compare the actual protected values and ask for the
 * owner PIN only when stock, pricing, tax, identity, packaging or compliance changed.
 */
export function productUpdateNeedsOwnerApproval(existing: Product, next: ProductInput): boolean {
  return OWNER_APPROVAL_PRODUCT_FIELDS.some((field) => (
    JSON.stringify(normalizedApprovalValue(field, existing[field]))
      !== JSON.stringify(normalizedApprovalValue(field, next[field]))
  ));
}

export function findDraftProduct(draft: ProductDraftPayload, products: Product[]): Product | undefined {
  const lookupName = String(draft.productName ?? draft.name ?? "").trim().toLowerCase();
  if (draft.mode !== "edit" || !lookupName) return undefined;
  return products.find((product) => {
    const aliases = product.aliases ?? [];
    return product.name.toLowerCase().includes(lookupName)
      || aliases.some((alias) => alias.toLowerCase().includes(lookupName));
  });
}

export function mergeDraftIntoProductForm(base: ProductFormData, draft: ProductDraftPayload): ProductFormData {
  const mergedAliases = Array.isArray(draft.aliases) && draft.aliases.length
    ? mergeProductAliasSuggestions(splitProductAliases(base.aliasesText), draft.aliases).join(", ")
    : base.aliasesText;

  return {
    ...base,
    name: draft.name ?? draft.productName ?? base.name,
    category: draft.category ?? base.category,
    brand: draft.brand ?? base.brand,
    unit: draft.unit ?? base.unit,
    packSizeValue: Number(draft.packSizeValue ?? base.packSizeValue),
    packSizeUnit: draft.packSizeUnit ?? base.packSizeUnit,
    barcode: draft.barcode ?? base.barcode,
    hsn: draft.hsn ?? base.hsn,
    aliasesText: mergedAliases,
    mrp: Number(draft.mrp ?? base.mrp),
    gstRate: Number(draft.gstRate ?? base.gstRate),
    reorderLevel: Number(draft.reorderLevel ?? base.reorderLevel),
    description: draft.description ?? base.description,
    imageUrl: draft.imageUrl ?? base.imageUrl,
    costPrice: Number(draft.costPrice ?? base.costPrice),
    sellingPrice: Number(draft.sellingPrice ?? base.sellingPrice),
    minimumSellingPrice: Number(draft.minimumSellingPrice ?? base.minimumSellingPrice),
    retailPrice: Number(draft.retailPrice ?? base.retailPrice),
    retailFromQuantity: Number(draft.retailFromQuantity ?? base.retailFromQuantity),
    wholesalePrice: Number(draft.wholesalePrice ?? base.wholesalePrice),
    wholesaleFromQuantity: Number(draft.wholesaleFromQuantity ?? base.wholesaleFromQuantity),
    stockQuantity: Number(draft.stockQuantity ?? base.stockQuantity),
    lowStockAlert: Number(draft.lowStockAlert ?? base.lowStockAlert),
  };
}
