import type { BusinessType } from "@/features/core/settings/business-type-store";
import type { StarterCatalogItem } from "./starter-catalog";

type Seed = readonly [name: string, category: string, price: number, unit?: string, restaurantItemType?: "prepared" | "packaged" | "ingredient"];

const SEEDS: Record<Exclude<BusinessType, "kirana">, readonly Seed[]> = {
  restaurant: [
    ["Tea", "Beverages", 20], ["Coffee", "Beverages", 40], ["Mineral Water", "Beverages", 20, "piece", "packaged"],
    ["Fresh Lime Soda", "Beverages", 80], ["Veg Sandwich", "Snacks", 100], ["French Fries", "Snacks", 120],
    ["Veg Thali", "Main Course", 180], ["Dal Fry", "Main Course", 140], ["Jeera Rice", "Main Course", 120],
    ["Paneer Butter Masala", "Main Course", 220], ["Tandoori Roti", "Breads", 20], ["Gulab Jamun", "Desserts", 50],
  ],
  pharmacy: [
    ["Paracetamol 500 mg", "Fever and Pain", 20, "strip"], ["ORS Sachet", "Hydration", 25, "sachet"],
    ["Antacid Tablets", "Digestive Care", 60, "strip"], ["Cough Syrup 100 ml", "Cold and Cough", 95, "bottle"],
    ["Vitamin C Tablets", "Vitamins", 80, "strip"], ["Adhesive Bandage", "First Aid", 5],
    ["Cotton Roll 100 g", "First Aid", 55, "pack"], ["Antiseptic Liquid 100 ml", "First Aid", 75, "bottle"],
    ["Digital Thermometer", "Devices", 180], ["Face Mask", "Personal Care", 10],
  ],
  auto_parts: [
    ["Engine Oil 1 L", "Lubricants", 450, "bottle"], ["Coolant 1 L", "Lubricants", 220, "bottle"],
    ["Oil Filter", "Filters", 180], ["Air Filter", "Filters", 280], ["Spark Plug", "Ignition", 120],
    ["Brake Pad Set", "Brakes", 650, "set"], ["Headlight Bulb", "Electrical", 180],
    ["Wiper Blade", "Body Parts", 250], ["Clutch Cable", "Cables", 220], ["Horn 12V", "Electrical", 350],
  ],
  electronics: [
    ["USB-C Charging Cable", "Accessories", 199], ["Lightning Charging Cable", "Accessories", 299],
    ["20W USB Charger", "Chargers", 599], ["Power Bank 10000 mAh", "Power Banks", 1299],
    ["Wired Earphones", "Audio", 399], ["Bluetooth Neckband", "Audio", 999],
    ["Tempered Glass", "Screen Protection", 149], ["Mobile Back Cover", "Cases", 249],
    ["32 GB Memory Card", "Storage", 499], ["Wireless Mouse", "Computer Accessories", 599],
  ],
  clothing: [
    ["Men's Cotton T-Shirt", "Men", 499], ["Men's Casual Shirt", "Men", 799], ["Men's Jeans", "Men", 1199],
    ["Women's Kurti", "Women", 799], ["Women's Leggings", "Women", 399], ["Saree", "Women", 1299],
    ["Kids T-Shirt", "Kids", 299], ["Kids Shorts", "Kids", 349], ["Dupatta", "Accessories", 299],
    ["School Uniform Shirt", "Uniforms", 399], ["School Uniform Trousers", "Uniforms", 499],
  ],
  footwear: [
    ["Men's Formal Shoes", "Men", 1499, "pair"], ["Men's Sports Shoes", "Men", 1799, "pair"],
    ["Men's Slippers", "Men", 399, "pair"], ["Women's Sandals", "Women", 999, "pair"],
    ["Women's Flats", "Women", 699, "pair"], ["Women's Slippers", "Women", 349, "pair"],
    ["Kids School Shoes", "Kids", 799, "pair"], ["Kids Sandals", "Kids", 599, "pair"],
    ["Shoe Polish", "Care", 99], ["Insole Pair", "Accessories", 149, "pair"],
  ],
  cosmetics: [
    ["Face Wash 100 ml", "Skin Care", 199, "tube"], ["Moisturiser 100 ml", "Skin Care", 249, "bottle"],
    ["Sunscreen 50 g", "Skin Care", 349, "tube"], ["Shampoo 180 ml", "Hair Care", 199, "bottle"],
    ["Hair Oil 200 ml", "Hair Care", 149, "bottle"], ["Lipstick", "Makeup", 299],
    ["Kajal", "Makeup", 149], ["Nail Polish", "Makeup", 99], ["Deodorant 150 ml", "Fragrance", 249, "bottle"],
    ["Bath Soap", "Personal Care", 55],
  ],
  stationery: [
    ["A4 Notebook 160 Pages", "Notebooks", 80], ["Long Notebook 200 Pages", "Notebooks", 110],
    ["Blue Ball Pen", "Writing", 10], ["Black Ball Pen", "Writing", 10], ["Pencil", "Writing", 5],
    ["Eraser", "Writing", 5], ["Sharpener", "Writing", 5], ["Geometry Box", "School Supplies", 120],
    ["A4 Paper Ream", "Paper", 320, "pack"], ["Glue Stick", "Craft", 40], ["Drawing Book", "Art", 60],
  ],
  furniture: [
    ["Plastic Chair", "Chairs", 699], ["Office Chair", "Chairs", 3499], ["Dining Chair", "Chairs", 1999],
    ["Dining Table 4 Seater", "Tables", 8999], ["Study Table", "Tables", 3999], ["Coffee Table", "Tables", 2999],
    ["Single Bed", "Beds", 9999], ["Double Bed", "Beds", 15999], ["Two Door Wardrobe", "Storage", 12999],
    ["Three Seater Sofa", "Sofas", 17999],
  ],
  manufacturing: [
    ["Raw Material", "Raw Materials", 1, "kg"], ["Packaging Material", "Packaging", 1],
    ["Finished Product", "Finished Goods", 1], ["Work in Progress", "Work in Progress", 1],
    ["Scrap Material", "Scrap", 1, "kg"], ["Labour Charge", "Services", 1, "custom"],
    ["Machine Hour", "Services", 1, "custom"], ["Freight Charge", "Services", 1, "custom"],
  ],
  other: [
    ["Standard Product", "Products", 1], ["Premium Product", "Products", 1],
    ["Small Service", "Services", 1, "custom"], ["Standard Service", "Services", 1, "custom"],
    ["Delivery Charge", "Charges", 1, "custom"], ["Installation Charge", "Charges", 1, "custom"],
  ],
};

function item([name, category, price, unit = "piece", restaurantItemType]: Seed, businessType: Exclude<BusinessType, "kirana">): StarterCatalogItem {
  return {
    name, category, unit, skuBarcode: "", mrp: price, costPrice: 0, sellingPrice: price,
    gstRate: 0, stockQuantity: 0, lowStockAlert: 0, reorderLevel: 0, hsn: "", brand: "",
    aliases: [], description: "Starter item — review price, tax and stock before first sale.",
    packSizeValue: 1, packSizeUnit: unit, isLooseItem: false, isActive: true,
    ...(businessType === "restaurant" ? { restaurantItemType: restaurantItemType ?? "prepared" } : {}),
  };
}

export function tradeStarterCatalog(businessType: Exclude<BusinessType, "kirana">): readonly StarterCatalogItem[] {
  return SEEDS[businessType].map((seed) => item(seed, businessType));
}
