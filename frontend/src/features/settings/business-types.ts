import { useCallback, useEffect, useState } from "react";
import { offlineDB } from "@/lib/offline/db";

export type BusinessType =
  | "kirana"
  | "clothing"
  | "footwear"
  | "auto_parts"
  | "electronics"
  | "pharmacy"
  | "stationery"
  | "furniture"
  | "cosmetics"
  | "restaurant"
  | "other";

export interface BusinessTypeDefinition {
  label: string;
  emoji: string;
  description: string;
  /** Product categories shown as quick-picks in the product form */
  categories: string[];
  /** Units shown at the top of the unit dropdown for this shop type */
  primaryUnits: string[];
  /** Example product for the voice fill hint in the product form */
  voiceExample: string;
}

export const BUSINESS_TYPE_DEFS: Record<BusinessType, BusinessTypeDefinition> = {
  kirana: {
    label: "Kirana / General Store",
    emoji: "🛒",
    description: "Grocery, FMCG, daily essentials",
    categories: ["grocery", "dairy", "beverages", "snacks", "household", "personal_care", "stationery", "other"],
    primaryUnits: ["piece", "kg", "gram", "litre", "ml", "packet", "box", "dozen"],
    voiceExample: "name aata, cost 40, selling 45, stock 10 kg, category grocery",
  },
  clothing: {
    label: "Clothing & Fashion",
    emoji: "👕",
    description: "Garments, sarees, fabric, readymade",
    categories: ["men", "women", "kids", "sarees", "fabric", "accessories", "innerwear", "other"],
    primaryUnits: ["piece", "meter", "yard", "set", "dozen", "roll", "bundle"],
    voiceExample: "name cotton shirt, cost 200, selling 350, stock 20 piece, category men",
  },
  footwear: {
    label: "Footwear & Shoes",
    emoji: "👟",
    description: "Shoes, sandals, chappals, sports",
    categories: ["mens", "womens", "kids", "sandals", "sports", "formal", "casual", "other"],
    primaryUnits: ["pair", "piece", "dozen", "box", "set"],
    voiceExample: "name sports shoes, cost 400, selling 650, stock 10 pair, category sports",
  },
  auto_parts: {
    label: "Auto Parts & Hardware",
    emoji: "🔧",
    description: "Tractor parts, spare parts, tools, hardware",
    categories: ["engine_parts", "filters", "electrical", "body_parts", "tools", "lubricants", "hardware", "fasteners", "other"],
    primaryUnits: ["piece", "set", "box", "litre", "kg", "dozen", "bundle", "sheet"],
    voiceExample: "name oil filter, cost 120, selling 180, stock 15 piece, category filters",
  },
  electronics: {
    label: "Electronics & Mobiles",
    emoji: "📱",
    description: "Phones, appliances, accessories, cables",
    categories: ["mobiles", "accessories", "appliances", "computers", "cables", "batteries", "networking", "other"],
    primaryUnits: ["piece", "set", "box", "dozen"],
    voiceExample: "name earphones, cost 300, selling 550, stock 8 piece, category accessories",
  },
  pharmacy: {
    label: "Pharmacy & Medical",
    emoji: "💊",
    description: "Medicines, medical equipment, health products",
    categories: ["tablets", "syrups", "injections", "equipment", "vitamins", "topical", "surgical", "other"],
    primaryUnits: ["strip", "tablet", "bottle", "tube", "piece", "box", "ml", "gram"],
    voiceExample: "name paracetamol, cost 12, selling 15, stock 50 strip, category tablets",
  },
  stationery: {
    label: "Stationery & Books",
    emoji: "📚",
    description: "Books, pens, notebooks, office supplies",
    categories: ["books", "pens", "notebooks", "art_supplies", "office", "files", "other"],
    primaryUnits: ["piece", "box", "dozen", "packet", "roll", "bundle"],
    voiceExample: "name ball pen, cost 5, selling 10, stock 100 dozen, category pens",
  },
  furniture: {
    label: "Furniture & Home",
    emoji: "🪑",
    description: "Furniture, décor, home furnishings",
    categories: ["bedroom", "living_room", "kitchen", "decor", "lighting", "bedding", "storage", "other"],
    primaryUnits: ["piece", "set", "pair", "box"],
    voiceExample: "name study chair, cost 2500, selling 3800, stock 5 piece, category bedroom",
  },
  cosmetics: {
    label: "Beauty & Cosmetics",
    emoji: "💄",
    description: "Skincare, makeup, haircare, salon",
    categories: ["skincare", "makeup", "haircare", "fragrances", "nailcare", "grooming", "other"],
    primaryUnits: ["piece", "bottle", "tube", "ml", "gram", "box", "set"],
    voiceExample: "name face cream, cost 80, selling 150, stock 20 piece, category skincare",
  },
  restaurant: {
    label: "Restaurant & Café",
    emoji: "🍽️",
    description: "Food, snacks, beverages, quick service",
    categories: ["starters", "main_course", "beverages", "snacks", "desserts", "thali", "other"],
    primaryUnits: ["piece", "plate", "glass", "bottle", "kg", "litre"],
    voiceExample: "name dal makhani, cost 60, selling 120, stock 10 kg, category main_course",
  },
  other: {
    label: "Other / Custom",
    emoji: "🏪",
    description: "Any other type of retail business",
    categories: ["general", "category_a", "category_b", "other"],
    primaryUnits: ["piece", "box", "set", "bundle", "dozen"],
    voiceExample: "name product, cost 100, selling 150, stock 10 piece, category general",
  },
};

const BT_KEY = "ui:business-type:v1";

export function useBusinessType() {
  const [businessType, setBusinessTypeState] = useState<BusinessType>("kirana");

  useEffect(() => {
    void offlineDB.getSetting<BusinessType>(BT_KEY).then((saved) => {
      if (saved) setBusinessTypeState(saved);
    });
  }, []);

  const setBusinessType = useCallback(async (bt: BusinessType) => {
    setBusinessTypeState(bt);
    await offlineDB.setSetting(BT_KEY, bt);
  }, []);

  return { businessType, setBusinessType, def: BUSINESS_TYPE_DEFS[businessType] };
}
