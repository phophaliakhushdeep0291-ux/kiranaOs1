import type { BusinessType, QuickActionIconKey } from "./business-types";

export interface ShopWorkflowAction {
  label: string;
  detail: string;
  href: string;
  icon: QuickActionIconKey;
}

export interface ShopProductEntryConfig {
  helper: string;
  nameLabel: string;
  namePlaceholder: string;
  looseNamePlaceholder: string;
  brandLabel: string;
  brandPlaceholder: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  notesLabel: string;
  notesPlaceholder: string;
  batchRecommendation: string;
  recommendBatchTracking: boolean;
}

export interface ShopWorkflowDefinition {
  title: string;
  subtitle: string;
  actions: [ShopWorkflowAction, ShopWorkflowAction, ShopWorkflowAction, ShopWorkflowAction];
  productEntry: ShopProductEntryConfig;
}

export const SHOP_WORKFLOWS: Record<BusinessType, ShopWorkflowDefinition> = {
  kirana: {
    title: "Kirana daily workflow",
    subtitle: "Bill faster, manage loose and packed stock, refill shelves, and serve repeat customers.",
    actions: [
      { label: "Fast counter billing", detail: "Scan items or sell loose quantity", href: "/billing", icon: "billing" },
      { label: "Refill stock", detail: "Receive supplier purchase bills", href: "/purchase-bills", icon: "purchase" },
      { label: "Pack and loose setup", detail: "Add packets, kg, litre, and pieces", href: "/products?add=1", icon: "products" },
      { label: "Customer orders", detail: "Review orders received from your link", href: "/orders-received", icon: "reports" },
    ],
    productEntry: {
      helper: "Set the pack size, selling unit, barcode, and reorder level once so billing and stock stay automatic.",
      nameLabel: "Product name",
      namePlaceholder: "e.g. Tata Salt 1 kg",
      looseNamePlaceholder: "e.g. Sugar loose",
      brandLabel: "Brand",
      brandPlaceholder: "e.g. Tata",
      identifierLabel: "Barcode / SKU (optional)",
      identifierPlaceholder: "Scan packet barcode",
      notesLabel: "Pack or supplier notes (optional)",
      notesPlaceholder: "Pack details, preferred supplier, storage note...",
      batchRecommendation: "Useful for dated food, dairy, cosmetics, and other expiring stock.",
      recommendBatchTracking: false,
    },
  },
  clothing: {
    title: "Fashion retail workflow",
    subtitle: "Keep one sellable SKU per size and colour, count stock accurately, and handle exchanges quickly.",
    actions: [
      { label: "Size-colour catalogue", detail: "Create one SKU for every sellable variant", href: "/products?add=1", icon: "products" },
      { label: "Physical stock count", detail: "Reconcile shelf and godown quantity", href: "/inventory/stock-counts", icon: "inventory" },
      { label: "Returns and exchanges", detail: "Trace the original bill and reverse stock", href: "/returns/new", icon: "billing" },
      { label: "Offers and loyalty", detail: "Run seasonal offers for repeat buyers", href: "/offers", icon: "reports" },
    ],
    productEntry: {
      helper: "Create a separate SKU for each size and colour so availability and returns remain exact.",
      nameLabel: "Style / garment name",
      namePlaceholder: "e.g. Cotton Shirt Blue XL",
      looseNamePlaceholder: "e.g. Cotton fabric loose",
      brandLabel: "Brand / label",
      brandPlaceholder: "e.g. Allen Solly",
      identifierLabel: "Style SKU / barcode",
      identifierPlaceholder: "e.g. SHIRT-BLU-XL",
      notesLabel: "Fabric and fit notes (optional)",
      notesPlaceholder: "Fabric, fit, sleeve, gender, season...",
      batchRecommendation: "Usually unnecessary for garments; use individual SKUs for size and colour instead.",
      recommendBatchTracking: false,
    },
  },
  footwear: {
    title: "Footwear retail workflow",
    subtitle: "Track every size as its own SKU, keep pair counts correct, and speed up exchanges.",
    actions: [
      { label: "Size-wise catalogue", detail: "Create one SKU for each model and size", href: "/products?add=1", icon: "products" },
      { label: "Pair stock count", detail: "Find missing sizes before customers ask", href: "/inventory/stock-counts", icon: "inventory" },
      { label: "Exchange a pair", detail: "Return against the original bill", href: "/returns/new", icon: "billing" },
      { label: "Reorder fast sellers", detail: "Review low stock and purchase needs", href: "/inventory", icon: "purchase" },
    ],
    productEntry: {
      helper: "Use one SKU per model, colour, and size; stock is then counted in pairs without guesswork.",
      nameLabel: "Model / footwear name",
      namePlaceholder: "e.g. Runner Black UK 9",
      looseNamePlaceholder: "e.g. Shoe lace loose",
      brandLabel: "Brand",
      brandPlaceholder: "e.g. Campus",
      identifierLabel: "Model-size SKU / barcode",
      identifierPlaceholder: "e.g. RUN-BLK-UK9",
      notesLabel: "Material and fit notes (optional)",
      notesPlaceholder: "Upper material, sole, fit, colour...",
      batchRecommendation: "Usually unnecessary for footwear; size-wise SKUs are more important.",
      recommendBatchTracking: false,
    },
  },
  auto_parts: {
    title: "Parts and hardware workflow",
    subtitle: "Find parts by number, remember compatibility, refill from suppliers, and control party khata.",
    actions: [
      { label: "Part-number catalogue", detail: "Store maker, part number, and fitment notes", href: "/products?add=1", icon: "products" },
      { label: "Supplier purchasing", detail: "Receive parts and update weighted cost", href: "/purchase-bills", icon: "purchase" },
      { label: "Godown stock count", detail: "Reconcile bins, shelves, and fasteners", href: "/inventory/stock-counts", icon: "inventory" },
      { label: "Party khata", detail: "Track workshop and mechanic balances", href: "/customers?filter=udhar", icon: "payment" },
    ],
    productEntry: {
      helper: "Put the manufacturer part number in SKU and vehicle or machine compatibility in notes for faster lookup.",
      nameLabel: "Part / hardware name",
      namePlaceholder: "e.g. Oil Filter Swift Diesel",
      looseNamePlaceholder: "e.g. M8 bolt loose",
      brandLabel: "Manufacturer",
      brandPlaceholder: "e.g. Bosch",
      identifierLabel: "Part number / barcode",
      identifierPlaceholder: "e.g. OF-0986-AF",
      notesLabel: "Compatibility notes (optional)",
      notesPlaceholder: "Vehicle model, year, engine, dimensions, bin...",
      batchRecommendation: "Useful for lubricants, adhesives, paint, and other dated chemicals.",
      recommendBatchTracking: false,
    },
  },
  electronics: {
    title: "Electronics retail workflow",
    subtitle: "Keep model-wise stock clear, capture warranty context, and make bill-linked returns easy.",
    actions: [
      { label: "Model catalogue", detail: "Record model, brand, price, and warranty", href: "/products?add=1", icon: "products" },
      { label: "Stock verification", detail: "Count high-value items regularly", href: "/inventory/stock-counts", icon: "inventory" },
      { label: "Warranty return", detail: "Open the original sale before return", href: "/returns/new", icon: "billing" },
      { label: "Customer history", detail: "Find buyer dues and past bills", href: "/customers", icon: "payment" },
    ],
    productEntry: {
      helper: "Use the exact model code as SKU and record warranty policy in notes; unit-level serial tracking is a planned next step.",
      nameLabel: "Product / model name",
      namePlaceholder: "e.g. Samsung A16 128 GB Blue",
      looseNamePlaceholder: "e.g. LAN cable loose",
      brandLabel: "Brand",
      brandPlaceholder: "e.g. Samsung",
      identifierLabel: "Model SKU / barcode",
      identifierPlaceholder: "e.g. SM-A166P-BLU",
      notesLabel: "Warranty and specification notes",
      notesPlaceholder: "Warranty period, RAM, storage, colour, model...",
      batchRecommendation: "Usually unnecessary for devices; use it only for dated batteries or chemicals.",
      recommendBatchTracking: false,
    },
  },
  pharmacy: {
    title: "Pharmacy safety workflow",
    subtitle: "Receive medicines by batch, sell earliest-expiry stock first, and isolate recalled or expired lots.",
    actions: [
      { label: "Batch and expiry", detail: "Review expiry, quarantine, and recall", href: "/inventory/batches", icon: "inventory" },
      { label: "Receive medicines", detail: "Capture purchase and lot details", href: "/purchase-bills", icon: "purchase" },
      { label: "Low-stock medicines", detail: "Prevent missed prescriptions", href: "/inventory", icon: "products" },
      { label: "Patient accounts", detail: "Collect and review pending balances", href: "/customers?filter=udhar", icon: "payment" },
    ],
    productEntry: {
      helper: "Enable batch and expiry for medicines that require lot control; checkout will consume saleable stock by earliest expiry.",
      nameLabel: "Medicine name and strength",
      namePlaceholder: "e.g. Paracetamol 500 mg",
      looseNamePlaceholder: "e.g. Cotton roll loose",
      brandLabel: "Manufacturer",
      brandPlaceholder: "e.g. Cipla",
      identifierLabel: "Drug barcode / SKU",
      identifierPlaceholder: "Scan medicine barcode",
      notesLabel: "Composition and storage notes",
      notesPlaceholder: "Composition, schedule, storage, prescription note...",
      batchRecommendation: "Recommended for medicines and medical stock carrying batch and expiry information.",
      recommendBatchTracking: true,
    },
  },
  stationery: {
    title: "Stationery and books workflow",
    subtitle: "Use barcodes or ISBNs, maintain fast-moving stock, and support retail and bulk prices.",
    actions: [
      { label: "Barcode catalogue", detail: "Add books, pens, and supplies quickly", href: "/products?add=1", icon: "products" },
      { label: "Bulk stock count", detail: "Count pieces, boxes, and dozens", href: "/inventory/stock-counts", icon: "inventory" },
      { label: "Supplier refill", detail: "Receive school and office stock", href: "/purchase-bills", icon: "purchase" },
      { label: "Sales reports", detail: "Identify seasonal and fast sellers", href: "/reports", icon: "reports" },
    ],
    productEntry: {
      helper: "Use ISBN or barcode where available and configure wholesale quantity pricing for schools and offices.",
      nameLabel: "Book / item name",
      namePlaceholder: "e.g. Classmate Notebook A4 200 pages",
      looseNamePlaceholder: "e.g. Chart paper loose",
      brandLabel: "Publisher / brand",
      brandPlaceholder: "e.g. Classmate",
      identifierLabel: "ISBN / barcode / SKU",
      identifierPlaceholder: "Scan ISBN or item barcode",
      notesLabel: "Class, subject, or pack notes",
      notesPlaceholder: "Class, edition, subject, colour, pack...",
      batchRecommendation: "Normally unnecessary except for dated art materials, adhesives, or chemicals.",
      recommendBatchTracking: false,
    },
  },
  furniture: {
    title: "Furniture showroom workflow",
    subtitle: "Build a visual catalogue, issue estimates, track customer dues, and organize order fulfilment.",
    actions: [
      { label: "Showroom catalogue", detail: "Add dimensions, material, and images", href: "/products?add=1", icon: "products" },
      { label: "Create estimate", detail: "Quote before confirming the sale", href: "/billing?billType=estimate", icon: "billing" },
      { label: "Customer orders", detail: "Review placed orders and fulfilment", href: "/orders-received", icon: "reports" },
      { label: "Collect balance", detail: "Track advances and pending dues", href: "/customers?filter=udhar", icon: "payment" },
    ],
    productEntry: {
      helper: "Add a clear image and dimensions in notes so staff can quote the correct model without measuring again.",
      nameLabel: "Furniture / model name",
      namePlaceholder: "e.g. Teak Study Table 4 ft",
      looseNamePlaceholder: "e.g. Upholstery fabric loose",
      brandLabel: "Maker / collection",
      brandPlaceholder: "e.g. In-house",
      identifierLabel: "Model code / SKU",
      identifierPlaceholder: "e.g. TBL-TEAK-4FT",
      notesLabel: "Dimensions and delivery notes",
      notesPlaceholder: "Length, width, height, material, assembly...",
      batchRecommendation: "Usually unnecessary except for dated coatings, adhesives, or consumables.",
      recommendBatchTracking: false,
    },
  },
  cosmetics: {
    title: "Beauty retail workflow",
    subtitle: "Track shades as separate SKUs, watch dated stock, and bring customers back with offers.",
    actions: [
      { label: "Shade-wise catalogue", detail: "Create one SKU per shade or size", href: "/products?add=1", icon: "products" },
      { label: "Batch and expiry", detail: "Review dated beauty stock", href: "/inventory/batches", icon: "inventory" },
      { label: "Offers", detail: "Create seasonal and bundle promotions", href: "/offers", icon: "reports" },
      { label: "Loyalty", detail: "Reward repeat beauty customers", href: "/loyalty", icon: "payment" },
    ],
    productEntry: {
      helper: "Create one SKU per shade and enable batch tracking for products carrying expiry or lot information.",
      nameLabel: "Product and shade name",
      namePlaceholder: "e.g. Matte Lipstick Rose 05",
      looseNamePlaceholder: "e.g. Salon wax loose",
      brandLabel: "Brand",
      brandPlaceholder: "e.g. Lakme",
      identifierLabel: "Shade SKU / barcode",
      identifierPlaceholder: "e.g. LIP-ROSE-05",
      notesLabel: "Shade, skin type, and usage notes",
      notesPlaceholder: "Shade, finish, skin type, size...",
      batchRecommendation: "Recommended when the label carries a batch number, use-before date, or expiry.",
      recommendBatchTracking: true,
    },
  },
  restaurant: {
    title: "Restaurant service workflow",
    subtitle: "Open orders quickly, keep the menu current, receive online orders, and close the day cleanly.",
    actions: [
      { label: "New order", detail: "Start counter or table billing", href: "/billing", icon: "billing" },
      { label: "Menu setup", detail: "Add dishes, modifiers as notes, and prices", href: "/products?add=1", icon: "products" },
      { label: "Incoming orders", detail: "Review customer-link orders", href: "/orders-received", icon: "reports" },
      { label: "Close day", detail: "Reconcile sales and collections", href: "/daily-closing", icon: "closing" },
    ],
    productEntry: {
      helper: "Use categories for menu sections and notes for ingredients, dietary flags, or preparation choices.",
      nameLabel: "Dish / menu item",
      namePlaceholder: "e.g. Paneer Butter Masala",
      looseNamePlaceholder: "e.g. Rice by weight",
      brandLabel: "Kitchen / brand",
      brandPlaceholder: "e.g. House special",
      identifierLabel: "Menu code / barcode",
      identifierPlaceholder: "e.g. MAIN-PBM",
      notesLabel: "Ingredients and preparation notes",
      notesPlaceholder: "Veg/non-veg, allergens, spice level, preparation...",
      batchRecommendation: "Use batch tracking for packaged or dated ingredients, not prepared menu items.",
      recommendBatchTracking: false,
    },
  },
  other: {
    title: "Retail workflow",
    subtitle: "Set up products clearly, maintain stock, serve customers, and review performance.",
    actions: [
      { label: "New bill", detail: "Start a sale", href: "/billing", icon: "billing" },
      { label: "Add products", detail: "Create a clear sellable catalogue", href: "/products?add=1", icon: "products" },
      { label: "Check stock", detail: "Review availability and reorder needs", href: "/inventory", icon: "inventory" },
      { label: "Reports", detail: "Review sales, profit, and collections", href: "/reports", icon: "reports" },
    ],
    productEntry: {
      helper: "Use a unique SKU, accurate selling unit, opening stock, and reorder level for every sellable item.",
      nameLabel: "Product / service name",
      namePlaceholder: "e.g. Product name and model",
      looseNamePlaceholder: "e.g. Loose item name",
      brandLabel: "Brand / maker",
      brandPlaceholder: "e.g. Brand name",
      identifierLabel: "SKU / barcode (optional)",
      identifierPlaceholder: "Scan or enter a unique code",
      notesLabel: "Product notes (optional)",
      notesPlaceholder: "Specification, handling, or supplier notes...",
      batchRecommendation: "Enable only for stock that needs batch, expiry, quarantine, or recall control.",
      recommendBatchTracking: false,
    },
  },
};

export function getShopWorkflow(businessType: BusinessType): ShopWorkflowDefinition {
  return SHOP_WORKFLOWS[businessType];
}
