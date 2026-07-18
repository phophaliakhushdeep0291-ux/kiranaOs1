import { z } from "zod";
import type { Product, ProductInput, ProductSellingUnit } from "@/lib/api/client";
import { mergeProductAliasSuggestions, splitProductAliases } from "@/features/products/product-reliability";
import { averageCost, baseUnitFor, fromBaseQty, round2, sellingUnitCode, sellingUnitConversion, sellingUnitName, toBaseQty } from "./product-pricing";

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
  isDefault: z.boolean(),
  isActive: z.boolean(),
});

export const productFormSchema = z.object({
  name: z.string().trim().min(1, "Product name required"),
  category: z.string().trim().min(1).default("general"),
  brand: z.string().trim().optional(),
  unit: z.string().trim().min(1).default("piece"),
  packSizeValue: z.coerce.number().positive("Pack size must be greater than zero").default(1),
  packSizeUnit: z.string().trim().min(1).default("piece"),
  sellingUnits: z.array(sellingUnitFormSchema).default([]),
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
  unit?: string;
  barcode?: string;
  aliases?: string[];
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
      unit: optionalString(draftRecord, "unit"),
      barcode: optionalString(draftRecord, "barcode"),
      aliases: optionalAliases(draftRecord),
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

export function productToForm(product?: Product): ProductFormData {
  const defaultUnit = product?.sellingUnits?.find((row) => row.isDefault) ?? product?.sellingUnits?.[0];
  const unit = defaultUnit?.unitType ?? product?.unit ?? product?.rateUnit ?? product?.displayUnit ?? "piece";
  const sellingPrice = product?.sellingPrice ?? product?.defaultPricePerRateUnit ?? 0;
  return {
    name: product?.name ?? "",
    category: product?.category ?? "general",
    brand: product?.brand ?? "",
    unit,
    packSizeValue: defaultUnit?.packSizeValue ?? 1,
    packSizeUnit: defaultUnit?.packSizeUnit ?? product?.baseUnit ?? (product?.isLooseItem ? unit : "piece"),
    sellingUnits: product?.sellingUnits ?? [],
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
    stockQuantity: defaultUnit?.conversionToBase
      ? round2(Number(product?.stockBaseQty ?? 0) / defaultUnit.conversionToBase)
      : fromBaseQty(product?.stockBaseQty, unit),
    lowStockAlert: defaultUnit?.conversionToBase
      ? round2(Number(product?.lowStockThreshold ?? 0) / defaultUnit.conversionToBase)
      : fromBaseQty(product?.lowStockThreshold, unit),
    batchTrackingEnabled: product?.batchTrackingEnabled ?? false,
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
  const sellingPrice = round2(values.sellingPrice);
  const minPrice = round2(values.minimumSellingPrice);
  const retailPrice = round2(values.retailPrice || sellingPrice);
  const wholesalePrice = round2(values.wholesalePrice || sellingPrice);
  const avgCost = round2(values.costPrice);
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
    maximumPrice: round2(values.mrp) || null,
    costPrice: avgCost || null,
    isDefault: true,
    isActive: true,
  };
  const sellingUnits = [
    defaultSellingUnit,
    ...values.sellingUnits.filter((row) => {
      const isPersistedDefault = Boolean(previousDefault?.id && row.id === previousDefault.id);
      return !row.isDefault && !isPersistedDefault && row.unitCode !== defaultSellingUnit.unitCode;
    }),
  ];

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
    stockBaseQty: round2(values.stockQuantity * conversionToBase),
    stockQuantity: values.stockQuantity,
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
    mrp: round2(values.mrp),
    gstRate: Number(values.gstRate || 0),
    reorderLevel: Number(values.reorderLevel || 0),
    description: values.description?.trim() || undefined,
    imageUrl: values.imageUrl || undefined,
    isLooseItem: values.isLooseItem,
    lowStockThreshold: round2(values.lowStockAlert * conversionToBase),
    batchTrackingEnabled: values.batchTrackingEnabled,
    lowStockAlert: values.lowStockAlert,
    isActive: values.isActive,
    status: values.isActive ? "active" : "inactive",
    ownerPin: ownerPin?.trim() || undefined,
    ownerPinReason: reason?.trim() || undefined,
  };
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
    unit: draft.unit ?? base.unit,
    barcode: draft.barcode ?? base.barcode,
    aliasesText: mergedAliases,
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
