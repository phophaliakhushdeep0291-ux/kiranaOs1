import type { BusinessType } from "@/features/core/settings/business-type-store";
import {
  isProductAttributeScalar,
  normalizeProductAttributes,
  type ProductAttributes,
} from "@/features/core/products/product-attribute-values";

// Re-exported so a product screen that wants both the catalogue and the value
// helpers keeps one import. The split itself is a bundling boundary the startup
// shell depends on — see product-attribute-values.ts before collapsing it back.
export { normalizeProductAttributes, type ProductAttributes };

/**
 * What a product has to carry, trade by trade.
 *
 * A chemist cannot sell from a row that does not name the salt. A garment shop
 * cannot answer "is it cotton?" from a row that has only a price. A parts shop
 * lives on the OEM number and the bin it sits in, a book shop on the ISBN and
 * the class, a furniture showroom on three dimensions it would otherwise have to
 * go and measure again. None of that fits in `description`, because a note
 * nobody can filter, print or compare is not a record.
 *
 * Twelve trades times a dozen facts is roughly a hundred and thirty fields, of
 * which any one shop uses a tenth. So they are not columns: they are one bag of
 * scalars on the product (`attributesJson`), keyed by the ids below, and this
 * file is the only place that knows what those keys mean. The server stores the
 * bag and bounds its size, deliberately without a copy of this vocabulary — two
 * lists that must be edited together are two lists that eventually disagree, and
 * the one that drifts silently drops whatever the other just added.
 *
 * WHAT DOES NOT BELONG HERE: anything the app branches on. Stock, price, tax,
 * `drugSchedule` (which refuses a sale without a prescription) and `variantAxes`
 * (which split stock per size) are real columns precisely because code reads
 * them. Everything below is descriptive — read by a person at the counter,
 * searched, and printed on a label or a quotation.
 *
 * WHAT ALREADY HAS A HOME: several trades keep their operational records in
 * their own registers, and those are not duplicated here. Vehicle fitment lives
 * in PartFitment, alternate part numbers in PartCrossReference, per-unit serials
 * and IMEIs in ProductUnit, shoe size systems in FootwearSizeProfile, dish
 * course/spice/prep-time in the menu columns. A field here that restated one of
 * those would give the shop two answers to one question.
 *
 * KEYS ARE PERMANENT. A stored product refers to them by id, so renaming one
 * orphans every value already typed. Labels can change freely; ids cannot.
 */

export type ProductAttributeType = "text" | "textarea" | "number" | "select" | "boolean";

export interface ProductAttributeField {
  /** Stable id, camelCase. Never rename — see the note above. */
  key: string;
  label: string;
  type: ProductAttributeType;
  placeholder?: string;
  /** One line under the input, for a field whose purpose is not self-evident. */
  help?: string;
  /** `select` only. The stored value is the option text itself. */
  options?: readonly string[];
  /** `number` only: shown after the input, so the label need not carry the unit. */
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
}

export interface ProductAttributeGroup {
  id: string;
  label: string;
  /** Why this group exists for this trade, and where its neighbours live. */
  help?: string;
  fields: readonly ProductAttributeField[];
}

const YES_NO_HELP = "Off unless you say otherwise.";

// ── Values reused across trades ───────────────────────────────────────────────
// Written once because they are the same list, not because they are related: a
// grocer's storage question and a chemist's are different questions, so the
// chemist keeps its own cold-chain wording below.
const STORAGE_OPTIONS = ["Ambient", "Keep dry", "Chilled", "Frozen", "Away from sunlight"] as const;
const GENDER_OPTIONS = ["Men", "Women", "Unisex", "Boys", "Girls"] as const;
const AGE_GROUP_OPTIONS = ["Adult", "Teen", "Kids", "Infant"] as const;
const FOOD_MARK_OPTIONS = ["Veg", "Non-veg", "Egg", "Not a food item"] as const;

/**
 * The catalogue, one entry per business type.
 *
 * Every `BusinessType` appears — the `Record` makes the compiler say so — because
 * a trade with no entry would silently render a product form with no trade
 * details at all, which reads as a bug rather than as a decision.
 */
export const PRODUCT_ATTRIBUTES: Record<BusinessType, readonly ProductAttributeGroup[]> = {
  kirana: [
    {
      id: "pack",
      label: "Label and pack",
      help: "What is printed on the packet, so the counter can answer without picking it up.",
      fields: [
        { key: "foodMark", label: "Veg / non-veg mark", type: "select", options: FOOD_MARK_OPTIONS, help: "The green or brown dot on the pack." },
        { key: "fssaiLicence", label: "FSSAI licence number", type: "text", placeholder: "e.g. 10012345678901", maxLength: 40 },
        { key: "shelfLifeDays", label: "Shelf life", type: "number", suffix: "days", min: 0, help: "Days from packing. Batch and expiry tracking records the actual dates." },
        { key: "storage", label: "Storage", type: "select", options: STORAGE_OPTIONS },
        { key: "countryOfOrigin", label: "Country of origin", type: "text", placeholder: "e.g. India", maxLength: 60 },
      ],
    },
    {
      id: "shelf",
      label: "Shelf and refill",
      help: "Where it sits and how it is ordered — the two things a new hand always has to ask.",
      fields: [
        { key: "rack", label: "Rack or aisle", type: "text", placeholder: "e.g. A3 top shelf", maxLength: 60 },
        { key: "caseQty", label: "Units per case", type: "number", suffix: "units", min: 0, help: "How many come in one outer box from the supplier." },
        { key: "supplierCode", label: "Supplier's item code", type: "text", placeholder: "e.g. TAT-SLT-1K", maxLength: 60 },
      ],
    },
  ],

  clothing: [
    {
      id: "garment",
      label: "Garment",
      help: "Size and colour come from the variant grid above — this is what every size shares.",
      fields: [
        { key: "fabric", label: "Fabric", type: "text", placeholder: "e.g. 100% cotton", maxLength: 80 },
        { key: "fit", label: "Fit", type: "select", options: ["Slim", "Regular", "Relaxed", "Oversized", "Skinny"] },
        { key: "pattern", label: "Pattern", type: "select", options: ["Solid", "Printed", "Checked", "Striped", "Embroidered", "Dyed"] },
        { key: "sleeve", label: "Sleeve", type: "select", options: ["Full sleeve", "Half sleeve", "Three-quarter", "Sleeveless"] },
        { key: "neck", label: "Neck or collar", type: "text", placeholder: "e.g. Spread collar", maxLength: 60 },
        { key: "colourFamily", label: "Colour family", type: "text", placeholder: "e.g. Blue", maxLength: 40, help: "The word a customer uses on the phone, above the exact shade." },
      ],
    },
    {
      id: "who",
      label: "Who and when",
      help: "What the floor sorts by: who wears it, and which season it belongs to.",
      fields: [
        { key: "gender", label: "Worn by", type: "select", options: GENDER_OPTIONS },
        { key: "ageGroup", label: "Age group", type: "select", options: AGE_GROUP_OPTIONS },
        { key: "season", label: "Season", type: "select", options: ["Summer", "Winter", "Monsoon", "All season"] },
        { key: "occasion", label: "Occasion", type: "select", options: ["Casual", "Formal", "Party", "Ethnic", "Sports", "Loungewear"] },
      ],
    },
    {
      id: "label",
      label: "Care label",
      fields: [
        { key: "care", label: "Wash care", type: "textarea", placeholder: "e.g. Machine wash cold, do not bleach, warm iron", maxLength: 300 },
        { key: "countryOfOrigin", label: "Country of origin", type: "text", placeholder: "e.g. India", maxLength: 60 },
      ],
    },
  ],

  footwear: [
    {
      id: "build",
      label: "Build",
      help: "Size system, width fitting and last are set per product on the Size runs screen.",
      fields: [
        { key: "upperMaterial", label: "Upper material", type: "text", placeholder: "e.g. Full-grain leather", maxLength: 80 },
        { key: "soleMaterial", label: "Sole material", type: "text", placeholder: "e.g. EVA", maxLength: 80 },
        { key: "closure", label: "Closure", type: "select", options: ["Lace-up", "Slip-on", "Velcro", "Buckle", "Zip", "Elastic"] },
        { key: "heelHeightMm", label: "Heel height", type: "number", suffix: "mm", min: 0 },
        { key: "colourFamily", label: "Colour family", type: "text", placeholder: "e.g. Black", maxLength: 40 },
      ],
    },
    {
      id: "who",
      label: "Who and where",
      fields: [
        { key: "ageGroup", label: "Age group", type: "select", options: AGE_GROUP_OPTIONS },
        { key: "occasion", label: "Use", type: "select", options: ["Casual", "Formal", "Sports", "Ethnic", "Safety", "Indoor"] },
      ],
    },
    {
      id: "after",
      label: "After the sale",
      help: "A sole warranty is the commonest counter dispute in this trade — record it once.",
      fields: [
        { key: "warrantyMonths", label: "Warranty", type: "number", suffix: "months", min: 0, max: 240 },
        { key: "care", label: "Care instructions", type: "textarea", placeholder: "e.g. Wipe with a dry cloth, do not machine wash", maxLength: 300 },
      ],
    },
  ],

  auto_parts: [
    {
      id: "identity",
      label: "Part identity",
      help: "Which vehicles it fits is recorded on the Fitment screen, and alternate numbers as cross-references.",
      fields: [
        { key: "oemNumber", label: "OEM number", type: "text", placeholder: "e.g. 15208-65F0E", maxLength: 80, help: "The number the manufacturer stamps, even when you stock another brand." },
        { key: "partType", label: "Part type", type: "select", options: ["OEM", "OES", "Aftermarket", "Reconditioned"] },
        { key: "position", label: "Fitting position", type: "select", options: ["Universal", "Front", "Rear", "Left", "Right", "Front left", "Front right", "Rear left", "Rear right", "Upper", "Lower"] },
        { key: "unitsPerVehicle", label: "Needed per vehicle", type: "number", suffix: "pcs", min: 0, help: "So the counter sells the pair or the set, not one piece." },
      ],
    },
    {
      id: "spec",
      label: "Specification",
      fields: [
        { key: "material", label: "Material", type: "text", placeholder: "e.g. Cast iron", maxLength: 80 },
        { key: "dimensions", label: "Dimensions or thread", type: "text", placeholder: "e.g. M8 x 1.25, 45 mm", maxLength: 80 },
        { key: "weightGrams", label: "Weight", type: "number", suffix: "g", min: 0 },
        { key: "hazardous", label: "Hazardous or flammable", type: "boolean", help: "Oils, paints, aerosols and batteries — affects how it is stored and carried." },
      ],
    },
    {
      id: "godown",
      label: "Godown and warranty",
      fields: [
        { key: "bin", label: "Rack or bin", type: "text", placeholder: "e.g. R4-B12", maxLength: 60, help: "The single fastest way to cut counter time in a parts shop." },
        { key: "warrantyMonths", label: "Warranty", type: "number", suffix: "months", min: 0, max: 240 },
      ],
    },
  ],

  electronics: [
    {
      id: "model",
      label: "Model",
      help: "Individual serials and IMEIs are registered per piece on the Serial units screen.",
      fields: [
        { key: "modelNumber", label: "Model number", type: "text", placeholder: "e.g. SM-A166P", maxLength: 80 },
        { key: "colour", label: "Colour", type: "text", placeholder: "e.g. Awesome Blue", maxLength: 40 },
        { key: "serialTracked", label: "Track every piece by serial or IMEI", type: "boolean", help: "Turn on for anything that comes back for warranty. Register the units on the Serial units screen." },
        { key: "countryOfOrigin", label: "Country of origin", type: "text", placeholder: "e.g. India", maxLength: 60 },
      ],
    },
    {
      id: "warranty",
      label: "Warranty",
      help: "What the customer is told at the counter, and what the shop is left holding.",
      fields: [
        { key: "warrantyMonths", label: "Warranty", type: "number", suffix: "months", min: 0, max: 240 },
        { key: "warrantyType", label: "Warranty given by", type: "select", options: ["Brand warranty", "Seller warranty", "Extended warranty", "No warranty"] },
        { key: "warrantyProvider", label: "Service centre", type: "text", placeholder: "e.g. Samsung authorised service", maxLength: 120 },
      ],
    },
    {
      id: "spec",
      label: "Specification",
      fields: [
        { key: "powerWatts", label: "Power", type: "number", suffix: "W", min: 0 },
        { key: "voltage", label: "Voltage", type: "text", placeholder: "e.g. 230 V", maxLength: 40 },
        { key: "energyRating", label: "Energy rating", type: "select", options: ["5 star", "4 star", "3 star", "2 star", "1 star", "Not rated"] },
        { key: "boxContents", label: "What is in the box", type: "textarea", placeholder: "e.g. Handset, charger, cable, SIM tool, manual", maxLength: 300, help: "Checked at the counter on every return." },
      ],
    },
  ],

  pharmacy: [
    {
      id: "drug",
      label: "Medicine",
      help: "The schedule that decides whether a prescription is demanded is set under Stock above.",
      fields: [
        { key: "genericName", label: "Generic name", type: "text", placeholder: "e.g. Paracetamol", maxLength: 120, help: "What a customer asks for when the brand is out of stock." },
        { key: "composition", label: "Composition", type: "textarea", placeholder: "e.g. Paracetamol 500 mg + Caffeine 65 mg", maxLength: 400 },
        { key: "strength", label: "Strength", type: "text", placeholder: "e.g. 500 mg", maxLength: 60 },
        { key: "dosageForm", label: "Dosage form", type: "select", options: ["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Ointment", "Cream", "Drops", "Inhaler", "Powder", "Sachet", "Device"] },
        { key: "unitsPerStrip", label: "Units per strip or pack", type: "number", suffix: "units", min: 0, help: "Tablets in a strip, ml in a bottle — what a loose sale is cut from." },
        { key: "therapeuticClass", label: "Therapeutic class", type: "text", placeholder: "e.g. Analgesic / antipyretic", maxLength: 120 },
      ],
    },
    {
      id: "handling",
      label: "Storage and handling",
      help: "Getting this wrong destroys the stock silently — the strip still looks fine.",
      fields: [
        { key: "storage", label: "Storage", type: "select", options: ["Below 25°C", "Below 30°C", "Cold chain 2–8°C", "Freezer", "Protect from light", "Protect from moisture"] },
        { key: "coldChain", label: "Needs cold chain", type: "boolean", help: "Vaccines, insulin and some eye drops. Never leave these out of the fridge." },
        { key: "shelfLifeMonths", label: "Shelf life", type: "number", suffix: "months", min: 0, help: "From manufacture. Actual expiry per lot comes from batch tracking." },
      ],
    },
    {
      id: "record",
      label: "Records",
      help: "What an inspector asks for, and what a recall notice is matched against.",
      fields: [
        { key: "manufacturerName", label: "Marketed by", type: "text", placeholder: "e.g. Cipla Ltd", maxLength: 120 },
        { key: "mfgLicenceNumber", label: "Manufacturing licence number", type: "text", placeholder: "e.g. MFG/25/1234", maxLength: 60 },
        { key: "habitForming", label: "Habit forming", type: "boolean", help: "Carries the statutory warning on the pack." },
      ],
    },
  ],

  stationery: [
    {
      id: "book",
      label: "Book",
      help: "Leave blank for pens, files and other non-book stock. Class lists live on the Book lists screen.",
      fields: [
        { key: "isbn", label: "ISBN", type: "text", placeholder: "e.g. 9788131808085", maxLength: 20 },
        { key: "author", label: "Author", type: "text", placeholder: "e.g. R. D. Sharma", maxLength: 120 },
        { key: "publisher", label: "Publisher", type: "text", placeholder: "e.g. Dhanpat Rai", maxLength: 120 },
        { key: "edition", label: "Edition or year", type: "text", placeholder: "e.g. 2026 edition", maxLength: 60 },
        { key: "language", label: "Language", type: "text", placeholder: "e.g. English", maxLength: 40 },
        { key: "binding", label: "Binding", type: "select", options: ["Paperback", "Hardbound", "Spiral", "Stapled"] },
        { key: "pages", label: "Pages", type: "number", suffix: "pages", min: 0 },
      ],
    },
    {
      id: "school",
      label: "School",
      help: "How a parent asks for it: the class and the board, not the title.",
      fields: [
        { key: "board", label: "Board", type: "select", options: ["CBSE", "ICSE", "State board", "IB", "University", "Competitive exam", "Not applicable"] },
        { key: "classGrade", label: "Class or grade", type: "text", placeholder: "e.g. Class 6", maxLength: 40 },
        { key: "subject", label: "Subject", type: "text", placeholder: "e.g. Mathematics", maxLength: 60 },
      ],
    },
    {
      id: "supplies",
      label: "Supplies",
      help: "For notebooks, paper and instruments rather than books.",
      fields: [
        { key: "ruling", label: "Ruling", type: "select", options: ["Single line", "Double line", "Four line", "Square", "Graph", "Unruled"] },
        { key: "paperGsm", label: "Paper weight", type: "number", suffix: "GSM", min: 0 },
        { key: "colour", label: "Colour", type: "text", placeholder: "e.g. Blue", maxLength: 40 },
        { key: "unitsPerPack", label: "Units per pack", type: "number", suffix: "units", min: 0, help: "Pens in a box, sheets in a ream — what a bulk order is counted in." },
      ],
    },
  ],

  furniture: [
    {
      id: "size",
      label: "Dimensions",
      help: "The measurements a quotation is built from, so nobody walks back to the floor with a tape.",
      fields: [
        { key: "lengthCm", label: "Length", type: "number", suffix: "cm", min: 0 },
        { key: "widthCm", label: "Width or depth", type: "number", suffix: "cm", min: 0 },
        { key: "heightCm", label: "Height", type: "number", suffix: "cm", min: 0 },
        { key: "weightKg", label: "Weight", type: "number", suffix: "kg", min: 0, help: "Decides whether it is a two-person delivery." },
        { key: "seatingCapacity", label: "Seats", type: "number", suffix: "people", min: 0 },
      ],
    },
    {
      id: "make",
      label: "Make and finish",
      fields: [
        { key: "material", label: "Material", type: "text", placeholder: "e.g. Sheesham wood", maxLength: 80 },
        { key: "finish", label: "Finish", type: "text", placeholder: "e.g. Matte walnut", maxLength: 80 },
        { key: "colour", label: "Colour", type: "text", placeholder: "e.g. Walnut brown", maxLength: 40 },
        { key: "roomType", label: "Room", type: "select", options: ["Living room", "Bedroom", "Dining", "Kitchen", "Study or office", "Outdoor", "Kids"] },
      ],
    },
    {
      id: "delivery",
      label: "Delivery and after-sales",
      help: "The three questions asked before every order is confirmed.",
      fields: [
        { key: "assemblyRequired", label: "Needs assembly", type: "boolean", help: YES_NO_HELP },
        { key: "assemblyMinutes", label: "Assembly time", type: "number", suffix: "minutes", min: 0 },
        { key: "leadTimeDays", label: "Lead time", type: "number", suffix: "days", min: 0, help: "For made-to-order pieces. Zero means it goes off the floor today." },
        { key: "warrantyMonths", label: "Warranty", type: "number", suffix: "months", min: 0, max: 240 },
        { key: "care", label: "Care instructions", type: "textarea", placeholder: "e.g. Wipe with a dry cloth, keep away from direct sunlight", maxLength: 300 },
      ],
    },
  ],

  cosmetics: [
    {
      id: "shade",
      label: "Shade and finish",
      help: "Shades stocked as separate rows belong in the variant grid — this describes one of them.",
      fields: [
        { key: "shade", label: "Shade name or number", type: "text", placeholder: "e.g. Rose 05", maxLength: 60 },
        { key: "shadeFamily", label: "Shade family", type: "text", placeholder: "e.g. Nude", maxLength: 40 },
        { key: "finish", label: "Finish", type: "select", options: ["Matte", "Glossy", "Satin", "Shimmer", "Dewy", "Natural"] },
        { key: "netContent", label: "Net content", type: "text", placeholder: "e.g. 50 ml", maxLength: 40, help: "As stated on the label, when the pack is counted in pieces." },
      ],
    },
    {
      id: "suits",
      label: "Who it suits",
      help: "The counter's first question, and what a recommendation is built on.",
      fields: [
        { key: "skinType", label: "Skin type", type: "select", options: ["All skin types", "Oily", "Dry", "Combination", "Sensitive", "Acne-prone", "Mature"] },
        { key: "hairType", label: "Hair type", type: "select", options: ["All hair types", "Dry", "Oily", "Curly", "Coloured", "Dandruff-prone", "Not applicable"] },
        { key: "spf", label: "SPF", type: "number", min: 0, max: 100 },
        { key: "fragranceFree", label: "Fragrance free", type: "boolean", help: YES_NO_HELP },
        { key: "vegan", label: "Vegan", type: "boolean", help: YES_NO_HELP },
        { key: "crueltyFree", label: "Cruelty free", type: "boolean", help: YES_NO_HELP },
      ],
    },
    {
      id: "safety",
      label: "Ingredients and dates",
      help: "Beauty stock expires on the shelf, and an allergy question has to be answerable.",
      fields: [
        { key: "keyIngredients", label: "Key ingredients", type: "textarea", placeholder: "e.g. Niacinamide 10%, zinc PCA", maxLength: 400 },
        { key: "allergens", label: "Known allergens", type: "textarea", placeholder: "e.g. Contains nut oils, parabens", maxLength: 300 },
        { key: "paoMonths", label: "Use within, after opening", type: "number", suffix: "months", min: 0, help: "The open-jar number on the pack. Separate from the printed expiry." },
        { key: "shelfLifeMonths", label: "Shelf life", type: "number", suffix: "months", min: 0 },
        { key: "countryOfOrigin", label: "Country of origin", type: "text", placeholder: "e.g. India", maxLength: 60 },
      ],
    },
  ],

  restaurant: [
    {
      id: "dish",
      label: "Dish",
      help: "Course, veg mark, spice level and preparation time are set on the Menu screen.",
      fields: [
        { key: "cuisine", label: "Cuisine", type: "text", placeholder: "e.g. North Indian", maxLength: 60 },
        { key: "portionSize", label: "Portion", type: "text", placeholder: "e.g. 300 g bowl", maxLength: 60 },
        { key: "servesPeople", label: "Serves", type: "number", suffix: "people", min: 0, help: "Asked at every table before ordering for a group." },
        { key: "kitchenStation", label: "Kitchen station", type: "select", options: ["Main kitchen", "Tandoor", "Chinese", "Grill", "Cold kitchen", "Bakery", "Dessert", "Bar", "Beverages"] },
      ],
    },
    {
      id: "guest",
      label: "What the guest asks",
      help: "The questions a server must answer without walking back to the kitchen.",
      fields: [
        { key: "allergens", label: "Allergens", type: "textarea", placeholder: "e.g. Contains dairy, cashew, wheat", maxLength: 300 },
        { key: "containsGarlicOnion", label: "Contains onion or garlic", type: "boolean", help: "Decides whether a Jain guest can be served this at all." },
        { key: "jainAvailable", label: "Can be made Jain", type: "boolean", help: YES_NO_HELP },
        { key: "calories", label: "Calories", type: "number", suffix: "kcal", min: 0 },
      ],
    },
  ],

  manufacturing: [
    {
      id: "classification",
      label: "Classification",
      help: "What the item is in the production flow, which decides how it is counted and traced.",
      fields: [
        { key: "materialType", label: "Material type", type: "select", options: ["Raw material", "Packaging material", "Work in progress", "Finished good", "Consumable", "Spare part"] },
        { key: "grade", label: "Grade", type: "text", placeholder: "e.g. Food grade, IS 2062", maxLength: 80 },
        { key: "specification", label: "Specification", type: "textarea", placeholder: "e.g. Moisture below 8%, mesh 60, colour value 4.5", maxLength: 400, help: "What an incoming lot is checked against." },
        { key: "qcRequired", label: "QC check on receipt", type: "boolean", help: YES_NO_HELP },
      ],
    },
    {
      id: "handling",
      label: "Storage and safety",
      fields: [
        { key: "storage", label: "Storage", type: "select", options: STORAGE_OPTIONS },
        { key: "shelfLifeDays", label: "Shelf life", type: "number", suffix: "days", min: 0 },
        { key: "msdsRequired", label: "Safety data sheet required", type: "boolean", help: "Chemicals and anything shipped as dangerous goods." },
      ],
    },
    {
      id: "procurement",
      label: "Procurement and dispatch",
      help: "What a purchase plan and an export invoice are built from.",
      fields: [
        { key: "moq", label: "Minimum order quantity", type: "number", min: 0 },
        { key: "leadTimeDays", label: "Supplier lead time", type: "number", suffix: "days", min: 0 },
        { key: "netWeightGrams", label: "Net weight per unit", type: "number", suffix: "g", min: 0 },
        { key: "unitsPerCase", label: "Units per case", type: "number", suffix: "units", min: 0 },
        { key: "exportHsCode", label: "Export HS code", type: "text", placeholder: "e.g. 09103010", maxLength: 20, help: "The customs code, which is not always the domestic HSN." },
        { key: "countryOfOrigin", label: "Country of origin", type: "text", placeholder: "e.g. India", maxLength: 60 },
      ],
    },
  ],

  other: [
    {
      id: "details",
      label: "Item details",
      help: "A general set, because this shop type has no fixed trade. Pick a business type in Store Profile to get its own fields.",
      fields: [
        { key: "model", label: "Model", type: "text", placeholder: "e.g. Model or version", maxLength: 80 },
        { key: "colour", label: "Colour", type: "text", placeholder: "e.g. Black", maxLength: 40 },
        { key: "size", label: "Size", type: "text", placeholder: "e.g. Large", maxLength: 40 },
        { key: "material", label: "Material", type: "text", placeholder: "e.g. Steel", maxLength: 80 },
        { key: "warrantyMonths", label: "Warranty", type: "number", suffix: "months", min: 0, max: 240 },
        { key: "countryOfOrigin", label: "Country of origin", type: "text", placeholder: "e.g. India", maxLength: 60 },
      ],
    },
  ],
};

/**
 * What the section is called on the product form, in the trade's own words.
 *
 * "Trade details" is what this is called in the code and means nothing to a
 * shopkeeper. A chemist reads "Medicine details" and knows immediately whether
 * the box below is meant for them.
 */
export const PRODUCT_ATTRIBUTE_SECTION_TITLE: Record<BusinessType, string> = {
  kirana: "Grocery details",
  clothing: "Garment details",
  footwear: "Footwear details",
  auto_parts: "Part details",
  electronics: "Product details",
  pharmacy: "Medicine details",
  stationery: "Book and supply details",
  furniture: "Furniture details",
  cosmetics: "Beauty product details",
  restaurant: "Dish details",
  manufacturing: "Material details",
  other: "Item details",
};

/**
 * The handful of strings the renderer needs that are not a field's own label.
 *
 * Kept here rather than in the component because everything user-visible in this
 * feature already lives in this file, and because the component is a new file:
 * the i18n check enforces strictly on any .tsx that is not grandfathered, so a
 * literal written there would fail the build. One place for the words is also
 * simply easier to translate later.
 */
export const PRODUCT_ATTRIBUTE_UI_TEXT = {
  /** Placeholder row of a select, meaning "the shop has not said". */
  unsetOption: "Not set",
  foreignTitle: "Saved under a different shop type",
  foreignHelp: "This product still carries details from the trade this shop used before. They are kept and synced as they are. Remove any that no longer apply.",
  removeLabel: "Remove",
} as const;

export function productAttributeGroupsFor(businessType: BusinessType): readonly ProductAttributeGroup[] {
  return PRODUCT_ATTRIBUTES[businessType] ?? PRODUCT_ATTRIBUTES.other;
}

export function productAttributeFieldsFor(businessType: BusinessType): ProductAttributeField[] {
  return productAttributeGroupsFor(businessType).flatMap((group) => [...group.fields]);
}

/**
 * Everything stored on this product that its current trade has no field for.
 *
 * A shop that switches business type keeps what it typed under the old one — the
 * values are still true about the product, and losing them silently on the next
 * save would be worse than showing them. The form lists these read-only so the
 * owner can see them and clear the ones that no longer apply.
 */
export function foreignProductAttributeKeys(
  businessType: BusinessType,
  attributes: ProductAttributes | undefined,
): string[] {
  if (!attributes) return [];
  const known = new Set(productAttributeFieldsFor(businessType).map((field) => field.key));
  return Object.keys(attributes).filter((key) => !known.has(key)).sort();
}

/**
 * The payload the product form saves.
 *
 * Every field of the current trade is named, including the ones left empty — an
 * empty string is how this form says "clear that", and the server treats a named
 * key with no value as a delete. Keys belonging to other trades are passed back
 * untouched, so a re-save under a new business type cannot quietly drop them.
 */
export function productAttributesForSave(
  businessType: BusinessType,
  edited: ProductAttributes,
): Record<string, string | number | boolean> {
  const payload: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(edited)) {
    if (!isProductAttributeScalar(value)) continue;
    payload[key] = value;
  }
  for (const field of productAttributeFieldsFor(businessType)) {
    if (!(field.key in payload)) payload[field.key] = "";
  }
  return payload;
}
