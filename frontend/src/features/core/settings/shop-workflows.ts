import type { BusinessType, QuickActionIconKey } from "./business-types";
import type { TranslationKey } from "./i18n";

/**
 * Every string below is a dictionary KEY, not the words.
 *
 * Same constraint as `business-types.ts`: this table is a module-level constant,
 * evaluated when the module is imported and long before a language has been
 * chosen, so prose written here could never reach `t()` — it would render in
 * English on every Hindi counter. The words live in `translations/workflows.ts`.
 *
 * `recommendBatchTracking` is the exception: a boolean is not copy.
 */
export interface ShopWorkflowAction {
  label: TranslationKey;
  detail: TranslationKey;
  href: string;
  icon: QuickActionIconKey;
}

export interface ShopProductEntryConfig {
  helper: TranslationKey;
  nameLabel: TranslationKey;
  namePlaceholder: TranslationKey;
  looseNamePlaceholder: TranslationKey;
  brandLabel: TranslationKey;
  brandPlaceholder: TranslationKey;
  identifierLabel: TranslationKey;
  identifierPlaceholder: TranslationKey;
  notesLabel: TranslationKey;
  notesPlaceholder: TranslationKey;
  batchRecommendation: TranslationKey;
  recommendBatchTracking: boolean;
}

export interface ShopWorkflowDefinition {
  title: TranslationKey;
  subtitle: TranslationKey;
  actions: [ShopWorkflowAction, ShopWorkflowAction, ShopWorkflowAction, ShopWorkflowAction];
  productEntry: ShopProductEntryConfig;
}

export const SHOP_WORKFLOWS: Record<BusinessType, ShopWorkflowDefinition> = {
  manufacturing: {
    title: "workflow.manufacturing.title",
    subtitle: "workflow.manufacturing.subtitle",
    actions: [
      { label: "workflow.manufacturing.action.1", detail: "workflow.manufacturing.action.1.detail", href: "/manufacturing", icon: "inventory" },
      { label: "workflow.manufacturing.action.2", detail: "workflow.manufacturing.action.2.detail", href: "/purchase-bills", icon: "purchase" },
      { label: "workflow.manufacturing.action.3", detail: "workflow.manufacturing.action.3.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.manufacturing.action.4", detail: "workflow.manufacturing.action.4.detail", href: "/billing", icon: "billing" },
    ],
    productEntry: {
      helper: "workflow.manufacturing.entry.helper",
      nameLabel: "workflow.manufacturing.entry.name",
      namePlaceholder: "workflow.manufacturing.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.manufacturing.entry.looseNamePlaceholder",
      brandLabel: "workflow.manufacturing.entry.brand",
      brandPlaceholder: "workflow.manufacturing.entry.brandPlaceholder",
      identifierLabel: "workflow.manufacturing.entry.identifier",
      identifierPlaceholder: "workflow.manufacturing.entry.identifierPlaceholder",
      notesLabel: "workflow.manufacturing.entry.notes",
      notesPlaceholder: "workflow.manufacturing.entry.notesPlaceholder",
      batchRecommendation: "workflow.manufacturing.entry.batchNote",
      recommendBatchTracking: true,
    },
  },
  kirana: {
    title: "workflow.kirana.title",
    subtitle: "workflow.kirana.subtitle",
    actions: [
      { label: "workflow.kirana.action.1", detail: "workflow.kirana.action.1.detail", href: "/billing", icon: "billing" },
      { label: "workflow.kirana.action.2", detail: "workflow.kirana.action.2.detail", href: "/purchase-bills", icon: "purchase" },
      { label: "workflow.kirana.action.3", detail: "workflow.kirana.action.3.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.kirana.action.4", detail: "workflow.kirana.action.4.detail", href: "/orders-received", icon: "reports" },
    ],
    productEntry: {
      helper: "workflow.kirana.entry.helper",
      nameLabel: "workflow.kirana.entry.name",
      namePlaceholder: "workflow.kirana.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.kirana.entry.looseNamePlaceholder",
      brandLabel: "workflow.kirana.entry.brand",
      brandPlaceholder: "workflow.kirana.entry.brandPlaceholder",
      identifierLabel: "workflow.kirana.entry.identifier",
      identifierPlaceholder: "workflow.kirana.entry.identifierPlaceholder",
      notesLabel: "workflow.kirana.entry.notes",
      notesPlaceholder: "workflow.kirana.entry.notesPlaceholder",
      batchRecommendation: "workflow.kirana.entry.batchNote",
      recommendBatchTracking: false,
    },
  },
  clothing: {
    title: "workflow.clothing.title",
    subtitle: "workflow.clothing.subtitle",
    actions: [
      { label: "workflow.clothing.action.1", detail: "workflow.clothing.action.1.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.clothing.action.2", detail: "workflow.clothing.action.2.detail", href: "/inventory/stock-counts", icon: "inventory" },
      { label: "workflow.clothing.action.3", detail: "workflow.clothing.action.3.detail", href: "/returns/new", icon: "billing" },
      { label: "workflow.clothing.action.4", detail: "workflow.clothing.action.4.detail", href: "/offers", icon: "reports" },
    ],
    productEntry: {
      helper: "workflow.clothing.entry.helper",
      nameLabel: "workflow.clothing.entry.name",
      namePlaceholder: "workflow.clothing.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.clothing.entry.looseNamePlaceholder",
      brandLabel: "workflow.clothing.entry.brand",
      brandPlaceholder: "workflow.clothing.entry.brandPlaceholder",
      identifierLabel: "workflow.clothing.entry.identifier",
      identifierPlaceholder: "workflow.clothing.entry.identifierPlaceholder",
      notesLabel: "workflow.clothing.entry.notes",
      notesPlaceholder: "workflow.clothing.entry.notesPlaceholder",
      batchRecommendation: "workflow.clothing.entry.batchNote",
      recommendBatchTracking: false,
    },
  },
  footwear: {
    title: "workflow.footwear.title",
    subtitle: "workflow.footwear.subtitle",
    actions: [
      { label: "workflow.footwear.action.1", detail: "workflow.footwear.action.1.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.footwear.action.2", detail: "workflow.footwear.action.2.detail", href: "/inventory/stock-counts", icon: "inventory" },
      { label: "workflow.footwear.action.3", detail: "workflow.footwear.action.3.detail", href: "/returns/new", icon: "billing" },
      { label: "workflow.footwear.action.4", detail: "workflow.footwear.action.4.detail", href: "/inventory", icon: "purchase" },
    ],
    productEntry: {
      helper: "workflow.footwear.entry.helper",
      nameLabel: "workflow.footwear.entry.name",
      namePlaceholder: "workflow.footwear.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.footwear.entry.looseNamePlaceholder",
      brandLabel: "workflow.footwear.entry.brand",
      brandPlaceholder: "workflow.footwear.entry.brandPlaceholder",
      identifierLabel: "workflow.footwear.entry.identifier",
      identifierPlaceholder: "workflow.footwear.entry.identifierPlaceholder",
      notesLabel: "workflow.footwear.entry.notes",
      notesPlaceholder: "workflow.footwear.entry.notesPlaceholder",
      batchRecommendation: "workflow.footwear.entry.batchNote",
      recommendBatchTracking: false,
    },
  },
  auto_parts: {
    title: "workflow.auto_parts.title",
    subtitle: "workflow.auto_parts.subtitle",
    actions: [
      { label: "workflow.auto_parts.action.1", detail: "workflow.auto_parts.action.1.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.auto_parts.action.2", detail: "workflow.auto_parts.action.2.detail", href: "/purchase-bills", icon: "purchase" },
      { label: "workflow.auto_parts.action.3", detail: "workflow.auto_parts.action.3.detail", href: "/inventory/stock-counts", icon: "inventory" },
      { label: "workflow.auto_parts.action.4", detail: "workflow.auto_parts.action.4.detail", href: "/udhar", icon: "payment" },
    ],
    productEntry: {
      helper: "workflow.auto_parts.entry.helper",
      nameLabel: "workflow.auto_parts.entry.name",
      namePlaceholder: "workflow.auto_parts.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.auto_parts.entry.looseNamePlaceholder",
      brandLabel: "workflow.auto_parts.entry.brand",
      brandPlaceholder: "workflow.auto_parts.entry.brandPlaceholder",
      identifierLabel: "workflow.auto_parts.entry.identifier",
      identifierPlaceholder: "workflow.auto_parts.entry.identifierPlaceholder",
      notesLabel: "workflow.auto_parts.entry.notes",
      notesPlaceholder: "workflow.auto_parts.entry.notesPlaceholder",
      batchRecommendation: "workflow.auto_parts.entry.batchNote",
      recommendBatchTracking: false,
    },
  },
  electronics: {
    title: "workflow.electronics.title",
    subtitle: "workflow.electronics.subtitle",
    actions: [
      { label: "workflow.electronics.action.1", detail: "workflow.electronics.action.1.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.electronics.action.2", detail: "workflow.electronics.action.2.detail", href: "/inventory/stock-counts", icon: "inventory" },
      { label: "workflow.electronics.action.3", detail: "workflow.electronics.action.3.detail", href: "/returns/new", icon: "billing" },
      { label: "workflow.electronics.action.4", detail: "workflow.electronics.action.4.detail", href: "/customers", icon: "payment" },
    ],
    productEntry: {
      helper: "workflow.electronics.entry.helper",
      nameLabel: "workflow.electronics.entry.name",
      namePlaceholder: "workflow.electronics.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.electronics.entry.looseNamePlaceholder",
      brandLabel: "workflow.electronics.entry.brand",
      brandPlaceholder: "workflow.electronics.entry.brandPlaceholder",
      identifierLabel: "workflow.electronics.entry.identifier",
      identifierPlaceholder: "workflow.electronics.entry.identifierPlaceholder",
      notesLabel: "workflow.electronics.entry.notes",
      notesPlaceholder: "workflow.electronics.entry.notesPlaceholder",
      batchRecommendation: "workflow.electronics.entry.batchNote",
      recommendBatchTracking: false,
    },
  },
  pharmacy: {
    title: "workflow.pharmacy.title",
    subtitle: "workflow.pharmacy.subtitle",
    actions: [
      { label: "workflow.pharmacy.action.1", detail: "workflow.pharmacy.action.1.detail", href: "/inventory/batches", icon: "inventory" },
      { label: "workflow.pharmacy.action.2", detail: "workflow.pharmacy.action.2.detail", href: "/purchase-bills", icon: "purchase" },
      { label: "workflow.pharmacy.action.3", detail: "workflow.pharmacy.action.3.detail", href: "/inventory", icon: "products" },
      { label: "workflow.pharmacy.action.4", detail: "workflow.pharmacy.action.4.detail", href: "/udhar", icon: "payment" },
    ],
    productEntry: {
      helper: "workflow.pharmacy.entry.helper",
      nameLabel: "workflow.pharmacy.entry.name",
      namePlaceholder: "workflow.pharmacy.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.pharmacy.entry.looseNamePlaceholder",
      brandLabel: "workflow.pharmacy.entry.brand",
      brandPlaceholder: "workflow.pharmacy.entry.brandPlaceholder",
      identifierLabel: "workflow.pharmacy.entry.identifier",
      identifierPlaceholder: "workflow.pharmacy.entry.identifierPlaceholder",
      notesLabel: "workflow.pharmacy.entry.notes",
      notesPlaceholder: "workflow.pharmacy.entry.notesPlaceholder",
      batchRecommendation: "workflow.pharmacy.entry.batchNote",
      recommendBatchTracking: true,
    },
  },
  stationery: {
    title: "workflow.stationery.title",
    subtitle: "workflow.stationery.subtitle",
    actions: [
      { label: "workflow.stationery.action.1", detail: "workflow.stationery.action.1.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.stationery.action.2", detail: "workflow.stationery.action.2.detail", href: "/inventory/stock-counts", icon: "inventory" },
      { label: "workflow.stationery.action.3", detail: "workflow.stationery.action.3.detail", href: "/purchase-bills", icon: "purchase" },
      { label: "workflow.stationery.action.4", detail: "workflow.stationery.action.4.detail", href: "/reports", icon: "reports" },
    ],
    productEntry: {
      helper: "workflow.stationery.entry.helper",
      nameLabel: "workflow.stationery.entry.name",
      namePlaceholder: "workflow.stationery.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.stationery.entry.looseNamePlaceholder",
      brandLabel: "workflow.stationery.entry.brand",
      brandPlaceholder: "workflow.stationery.entry.brandPlaceholder",
      identifierLabel: "workflow.stationery.entry.identifier",
      identifierPlaceholder: "workflow.stationery.entry.identifierPlaceholder",
      notesLabel: "workflow.stationery.entry.notes",
      notesPlaceholder: "workflow.stationery.entry.notesPlaceholder",
      batchRecommendation: "workflow.stationery.entry.batchNote",
      recommendBatchTracking: false,
    },
  },
  furniture: {
    title: "workflow.furniture.title",
    subtitle: "workflow.furniture.subtitle",
    actions: [
      { label: "workflow.furniture.action.1", detail: "workflow.furniture.action.1.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.furniture.action.2", detail: "workflow.furniture.action.2.detail", href: "/billing?billType=estimate", icon: "billing" },
      { label: "workflow.furniture.action.3", detail: "workflow.furniture.action.3.detail", href: "/orders-received", icon: "reports" },
      { label: "workflow.furniture.action.4", detail: "workflow.furniture.action.4.detail", href: "/udhar", icon: "payment" },
    ],
    productEntry: {
      helper: "workflow.furniture.entry.helper",
      nameLabel: "workflow.furniture.entry.name",
      namePlaceholder: "workflow.furniture.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.furniture.entry.looseNamePlaceholder",
      brandLabel: "workflow.furniture.entry.brand",
      brandPlaceholder: "workflow.furniture.entry.brandPlaceholder",
      identifierLabel: "workflow.furniture.entry.identifier",
      identifierPlaceholder: "workflow.furniture.entry.identifierPlaceholder",
      notesLabel: "workflow.furniture.entry.notes",
      notesPlaceholder: "workflow.furniture.entry.notesPlaceholder",
      batchRecommendation: "workflow.furniture.entry.batchNote",
      recommendBatchTracking: false,
    },
  },
  cosmetics: {
    title: "workflow.cosmetics.title",
    subtitle: "workflow.cosmetics.subtitle",
    actions: [
      { label: "workflow.cosmetics.action.1", detail: "workflow.cosmetics.action.1.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.cosmetics.action.2", detail: "workflow.cosmetics.action.2.detail", href: "/inventory/batches", icon: "inventory" },
      { label: "workflow.cosmetics.action.3", detail: "workflow.cosmetics.action.3.detail", href: "/offers", icon: "reports" },
      { label: "workflow.cosmetics.action.4", detail: "workflow.cosmetics.action.4.detail", href: "/loyalty", icon: "payment" },
    ],
    productEntry: {
      helper: "workflow.cosmetics.entry.helper",
      nameLabel: "workflow.cosmetics.entry.name",
      namePlaceholder: "workflow.cosmetics.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.cosmetics.entry.looseNamePlaceholder",
      brandLabel: "workflow.cosmetics.entry.brand",
      brandPlaceholder: "workflow.cosmetics.entry.brandPlaceholder",
      identifierLabel: "workflow.cosmetics.entry.identifier",
      identifierPlaceholder: "workflow.cosmetics.entry.identifierPlaceholder",
      notesLabel: "workflow.cosmetics.entry.notes",
      notesPlaceholder: "workflow.cosmetics.entry.notesPlaceholder",
      batchRecommendation: "workflow.cosmetics.entry.batchNote",
      recommendBatchTracking: true,
    },
  },
  restaurant: {
    title: "workflow.restaurant.title",
    subtitle: "workflow.restaurant.subtitle",
    actions: [
      { label: "workflow.restaurant.action.1", detail: "workflow.restaurant.action.1.detail", href: "/billing", icon: "billing" },
      { label: "workflow.restaurant.action.2", detail: "workflow.restaurant.action.2.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.restaurant.action.3", detail: "workflow.restaurant.action.3.detail", href: "/orders-received", icon: "reports" },
      { label: "workflow.restaurant.action.4", detail: "workflow.restaurant.action.4.detail", href: "/daily-closing", icon: "closing" },
    ],
    productEntry: {
      helper: "workflow.restaurant.entry.helper",
      nameLabel: "workflow.restaurant.entry.name",
      namePlaceholder: "workflow.restaurant.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.restaurant.entry.looseNamePlaceholder",
      brandLabel: "workflow.restaurant.entry.brand",
      brandPlaceholder: "workflow.restaurant.entry.brandPlaceholder",
      identifierLabel: "workflow.restaurant.entry.identifier",
      identifierPlaceholder: "workflow.restaurant.entry.identifierPlaceholder",
      notesLabel: "workflow.restaurant.entry.notes",
      notesPlaceholder: "workflow.restaurant.entry.notesPlaceholder",
      batchRecommendation: "workflow.restaurant.entry.batchNote",
      recommendBatchTracking: false,
    },
  },
  other: {
    title: "workflow.other.title",
    subtitle: "workflow.other.subtitle",
    actions: [
      { label: "workflow.other.action.1", detail: "workflow.other.action.1.detail", href: "/billing", icon: "billing" },
      { label: "workflow.other.action.2", detail: "workflow.other.action.2.detail", href: "/products?add=1", icon: "products" },
      { label: "workflow.other.action.3", detail: "workflow.other.action.3.detail", href: "/inventory", icon: "inventory" },
      { label: "workflow.other.action.4", detail: "workflow.other.action.4.detail", href: "/reports", icon: "reports" },
    ],
    productEntry: {
      helper: "workflow.other.entry.helper",
      nameLabel: "workflow.other.entry.name",
      namePlaceholder: "workflow.other.entry.namePlaceholder",
      looseNamePlaceholder: "workflow.other.entry.looseNamePlaceholder",
      brandLabel: "workflow.other.entry.brand",
      brandPlaceholder: "workflow.other.entry.brandPlaceholder",
      identifierLabel: "workflow.other.entry.identifier",
      identifierPlaceholder: "workflow.other.entry.identifierPlaceholder",
      notesLabel: "workflow.other.entry.notes",
      notesPlaceholder: "workflow.other.entry.notesPlaceholder",
      batchRecommendation: "workflow.other.entry.batchNote",
      recommendBatchTracking: false,
    },
  },
};

export function getShopWorkflow(businessType: BusinessType): ShopWorkflowDefinition {
  return SHOP_WORKFLOWS[businessType];
}
