import { formatDateInTimeZone } from "../../../utils/dates.js";

const MAX_ROWS = 5;
const text = (en, hi, language) => language === "en" ? en : hi;
const unavailable = (language) => text("unavailable", "उपलब्ध नहीं", language);
const label = (value) => JSON.stringify(String(value ?? "").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").slice(0, 120));
const scalar = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "bigint") return String(value);
  return typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value) ? value : null;
};

/** Format exact paise, including values larger than Number.MAX_SAFE_INTEGER. */
export function evidenceMoney(value, inPaise = true) {
  const raw = scalar(value);
  if (raw === null || (inPaise && typeof value === "number" && !Number.isSafeInteger(value))) return null;
  const match = raw.match(inPaise ? /^(-?)(\d+)$/ : /^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const amount = inPaise ? BigInt(match[2]) : BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  const fraction = String(amount % 100n).padStart(2, "0");
  return `${match[1]}₹${(amount / 100n).toLocaleString("en-IN")}${fraction === "00" ? "" : `.${fraction}`}`;
}

function date(value, timeZone) {
  if (value instanceof Date) value = Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  try { return formatDateInTimeZone(value, timeZone); } catch { return null; }
}

function fields(row, specs, language) {
  return specs.flatMap(([key, en, hi, kind = "number"]) => {
    if (!Object.hasOwn(row ?? {}, key)) return [];
    const value = kind === "paise" || kind === "rupees"
      ? evidenceMoney(row[key], kind === "paise")
      : scalar(row[key]);
    return [`${text(en, hi, language)}: ${value ?? unavailable(language)}`];
  });
}

function rows(values, render, language, total = values.length) {
  const shown = values.slice(0, MAX_ROWS).map(render).filter(Boolean);
  if (total > shown.length) shown.push(text(`Showing ${shown.length} of ${total} records.`, `${total} में से ${shown.length} रिकॉर्ड दिखाए गए हैं।`, language));
  return shown;
}

function product(row, language) {
  const stock = scalar(row.stock);
  const unit = row.stockUnit ?? row.unit;
  const parts = [label(row.name)];
  if (row.tracksStock === false) parts.push(text("stock is not tracked", "स्टॉक ट्रैक नहीं किया जाता", language));
  else parts.push(`${text("stock", "स्टॉक", language)}: ${stock ?? unavailable(language)}${unit ? ` ${label(unit)}` : ""}`);
  const price = evidenceMoney(row.price, false);
  if (Object.hasOwn(row, "price")) parts.push(`${text("price", "रेट", language)}: ${price ?? unavailable(language)}${row.priceUnit ? ` / ${label(row.priceUnit)}` : ""}`);
  if (row.tracksStock !== false && stock !== null && Number(stock) < 0) parts.push(text("oversold", "दर्ज स्टॉक से ज़्यादा बिका", language));
  else if (row.tracksStock !== false && row.isLow === true) parts.push(text("at or below the stock alert level", "स्टॉक अलर्ट सीमा पर या उससे कम", language));
  return parts.join("; ");
}

const SALES = [
  ["totalSalesPaise", "Sales", "बिक्री", "paise"], ["totalBills", "Bills", "बिल"],
  ["grossProfitPaise", "Gross profit", "सकल मुनाफ़ा", "paise"],
  ["cashSalesPaise", "Cash sales", "नकद बिक्री", "paise"], ["upiSalesPaise", "UPI sales", "UPI बिक्री", "paise"],
  ["bankSalesPaise", "Bank sales", "बैंक बिक्री", "paise"], ["udharSalesPaise", "Credit sales", "उधार बिक्री", "paise"],
];
const CLOSING = [
  ["totalSalesPaise", "Sales", "बिक्री", "paise"], ["totalBills", "Bills", "बिल"],
  ["cashReceivedPaise", "Cash received", "नकद प्राप्त", "paise"], ["upiReceivedPaise", "UPI received", "UPI प्राप्त", "paise"],
  ["bankReceivedPaise", "Bank received", "बैंक में प्राप्त", "paise"], ["udharGivenPaise", "Credit given", "दिया गया उधार", "paise"],
  ["expectedCashPaise", "Expected cash", "अपेक्षित नकद", "paise"],
];

// Domain summaries expose only these named business values. New response fields
// (notes, identifiers, credentials, or provider-written prose) are never copied.
const WORKFLOW_FIELDS = [
  ["pending", "Pending", "लंबित"], ["dispensedToday", "Dispensed today", "आज दवा दी गई"],
  ["thisMonth", "Prescriptions this month", "इस महीने के पर्चे"], ["regulatedThisMonth", "Regulated prescriptions this month", "इस महीने के नियंत्रित दवा पर्चे"],
  ["refillable", "Prescriptions with refills remaining", "रिफिल बाकी वाले पर्चे"], ["stale", "Old pending prescriptions", "पुराने लंबित पर्चे"], ["staleAfterDays", "Old-pending threshold in days", "पुराना लंबित मानने की दिन सीमा"],
  ["inStock", "Units in stock", "स्टॉक में यूनिट"], ["openBox", "Open-box or refurbished units", "ओपन बॉक्स या रीफर्बिश्ड यूनिट"],
  ["soldToday", "Units sold today", "आज बिकी यूनिट"], ["soldThisMonth", "Units sold this month", "इस महीने बिकी यूनिट"],
  ["atService", "Units at service", "सर्विस में यूनिट"], ["warrantyExpiringSoon", "Warranties expiring soon", "जल्द खत्म होने वाली वारंटी"], ["warrantySoonDays", "Warranty window in days", "वारंटी की दिन सीमा"],
  ["outNow", "Rentals out now", "अभी बाहर किराये के ऑर्डर"], ["dueToday", "Returns due today", "आज की वापसी"],
  ["overdue", "Overdue", "तारीख निकल चुकी"], ["upcoming", "Upcoming rentals", "आने वाले किराये"], ["activeToday", "Active rentals today", "आज सक्रिय किराये"],
  ["depositHeld", "Deposits held", "जमा रकम", "rupees"], ["pendingCollection", "Still to collect", "वसूली बाकी", "rupees"],
  ["styles", "Styles", "स्टाइल"], ["totalPairs", "Pairs in stock", "स्टॉक में जोड़ी"], ["brokenRuns", "Incomplete size runs", "अधूरी साइज़ रेंज"],
  ["emptyRuns", "Empty size runs", "खाली साइज़ रेंज"], ["unprofiledStyles", "Styles without a size profile", "साइज़ प्रोफाइल बिना स्टाइल"], ["missingSizes", "Missing sizes", "कम साइज़"],
  ["fitments", "Fitment records", "फिटमेंट रिकॉर्ड"], ["references", "Alternative part references", "वैकल्पिक पार्ट संदर्भ"], ["mappedParts", "Parts with fitment", "फिटमेंट वाले पार्ट"],
  ["catalogueSize", "Products in catalogue", "कैटलॉग में सामान"], ["unmappedParts", "Parts without fitment", "फिटमेंट बिना पार्ट"], ["makes", "Vehicle makes", "वाहन ब्रांड"],
  ["lists", "Book lists", "किताबों की सूचियाँ"], ["completeLists", "Complete lists", "पूरी सूचियाँ"], ["shortLists", "Lists with shortages", "कमी वाली सूचियाँ"],
  ["itemsToOrder", "Distinct items to order", "मंगाने वाले अलग सामान"], ["unitsToOrder", "Units to order", "मंगाने की मात्रा"], ["schools", "Schools", "स्कूल"],
  ["openOrders", "Open orders", "खुले ऑर्डर"], ["quotes", "Quotations", "कोटेशन"], ["inProduction", "Orders in production", "बन रहे ऑर्डर"],
  ["readyToDeliver", "Ready to deliver", "डिलीवरी को तैयार"], ["dueSoon", "Due soon", "जल्द देय"], ["advancesHeld", "Advances held", "रखा हुआ अग्रिम", "rupees"],
  ["orderBookValue", "Open order value", "खुले ऑर्डर की रकम", "rupees"], ["reservedProducts", "Reserved products", "आरक्षित सामान"],
  ["openTesters", "Open testers", "खुले टेस्टर"], ["dueNow", "Testers due for replacement", "बदलने वाले टेस्टर"],
  ["valueOnCounter", "Tester value on counter", "काउंटर पर टेस्टर की लागत", "rupees"], ["openedThisMonth", "Testers opened this month", "इस महीने खुले टेस्टर"],
  ["costThisMonth", "Tester cost this month", "इस महीने टेस्टर की लागत", "rupees"], ["dueSoonDays", "Replacement window in days", "बदलने की दिन सीमा"],
  ["activeBoms", "Active bills of materials", "सक्रिय सामग्री सूचियाँ"], ["plannedRuns", "Planned production runs", "नियोजित उत्पादन"],
  ["inProgressRuns", "Production runs in progress", "चल रहा उत्पादन"], ["quarantinedLots", "Quarantined or recalled lots", "रोके गए या वापस बुलाए गए बैच"],
];
const WORKFLOW_TITLES = {
  pharmacy_workflow_summary: ["Prescription register", "पर्चा रजिस्टर"], electronics_workflow_summary: ["Device register", "डिवाइस रजिस्टर"],
  clothing_workflow_summary: ["Rental register", "किराया रजिस्टर"], footwear_workflow_summary: ["Footwear stock", "जूते का स्टॉक"],
  auto_parts_workflow_summary: ["Vehicle fitment", "वाहन फिटमेंट"], stationery_workflow_summary: ["School book lists", "स्कूल किताब सूचियाँ"],
  furniture_workflow_summary: ["Furniture orders", "फर्नीचर ऑर्डर"], cosmetics_workflow_summary: ["Counter testers", "काउंटर टेस्टर"],
  manufacturing_workflow_summary: ["Production overview", "उत्पादन विवरण"],
};

/** A human-readable snapshot composed exclusively from a successful tool result. */
export function renderToolEvidence({ tool, result }, language = "hi", timeZone = "Asia/Kolkata") {
  if (!result || typeof result !== "object" || result.error || result.ok === false || result.success === false) return null;
  let title;
  let lines = [];
  const customer = (row) => `${label(row.name)}; ${text("outstanding credit", "बकाया उधार", language)}: ${evidenceMoney(row.udharAmountPaise ?? row.udharBalance ?? row.udharAmount, row.udharAmountPaise != null) ?? unavailable(language)}${row.udharBalanceNeedsRepair ? `; ${text("balance needs review", "बैलेंस की जाँच ज़रूरी", language)}` : ""}`;
  switch (tool) {
    case "search_products":
      if (!Array.isArray(result.products)) return null;
      title = text("Matching products", "मिले हुए सामान", language);
      lines = result.products.length ? rows(result.products, (row) => product(row, language), language, result.matchCount ?? result.products.length) : [text("No matching products returned.", "कोई मिलता सामान नहीं मिला।", language)];
      break;
    case "get_product_detail": {
      title = text("Product details", "सामान की जानकारी", language);
      if (result.found === false) { lines = [text("Product not found.", "सामान नहीं मिला।", language)]; break; }
      const p = result.product;
      if (!p || result.found !== true) return null;
      lines = [product({ name: p.name, stock: p.stockBaseQty, stockUnit: p.baseUnit, price: p.defaultPricePerRateUnit, priceUnit: p.rateUnit, tracksStock: p.stockTrackingEnabled }, language),
        ...fields(p, [["mrp", "MRP", "MRP", "rupees"], ["gstRate", "GST rate (%)", "GST दर (%)"], ["costPerRateUnit", "Cost per rate unit", "रेट यूनिट की लागत", "rupees"]], language)];
      if (p.hsn) lines.push(`HSN: ${label(p.hsn)}`);
      if (Array.isArray(p.sellingUnits) && p.sellingUnits.length) {
        lines.push(text("Pack options:", "पैक विकल्प:", language), ...rows(p.sellingUnits, (unit) => [
          label(unit.name), `${text("price per pack", "प्रति पैक रेट", language)}: ${evidenceMoney(unit.defaultPricePaise ?? unit.defaultPrice, unit.defaultPricePaise != null) ?? unavailable(language)}`,
          ...(p.packagingMode === "per_pack" ? fields(unit, [["onHandQty", "Packs in stock", "स्टॉक में पैक"]], language) : []),
        ].join("; "), language));
      }
      break;
    }
    case "find_customer":
      if (!Array.isArray(result.customers)) return null;
      title = text("Matching customers", "मिले हुए ग्राहक", language);
      lines = result.customers.length ? rows(result.customers, customer, language, result.matchCount ?? result.customers.length) : [text("No matching customers returned.", "कोई मिलता ग्राहक नहीं मिला।", language)];
      break;
    case "get_customer_khata":
      title = text("Customer credit account", "ग्राहक का खाता", language);
      if (result.found === false) lines = [text("Customer not found.", "ग्राहक नहीं मिला।", language)];
      else if (result.customer) {
        lines = [customer(result.customer)];
        if (Array.isArray(result.entries) && result.entries.length) {
          lines.push(text("Recent entries:", "हाल की एंट्री:", language), ...rows([...result.entries].reverse(), (entry) => [
            date(entry.businessDate, timeZone) ?? unavailable(language),
            entry.type === "payment" ? text("payment", "भुगतान", language) : entry.type === "debit" ? text("credit added", "उधार जोड़ा", language) : label(entry.type),
            evidenceMoney(entry.amountPaise ?? entry.amount, entry.amountPaise != null) ?? unavailable(language),
            ...(entry.mode ? [label(entry.mode)] : []),
            ...(entry.reversedAt ? [text("reversed", "वापस की गई एंट्री", language)] : []),
          ].join("; "), language, result.entryCount ?? result.entries.length));
        }
      }
      break;
    case "get_udhar_summary":
      title = text("Outstanding credit", "बकाया उधार", language);
      lines = fields(result, [["totalOutstanding", "Total outstanding", "कुल बकाया", "rupees"]], language);
      if (Array.isArray(result.customers)) lines.push(...rows(result.customers, customer, language));
      break;
    case "get_sales_summary":
      title = text("Sales summary", "बिक्री विवरण", language);
      if (date(result.from, timeZone) && date(result.to, timeZone)) title += ` (${date(result.from, timeZone)} – ${date(result.to, timeZone)})`;
      lines = fields(result, SALES, language);
      break;
    case "get_daily_closing":
      title = text("Daily closing", "दिन का हिसाब", language);
      if (date(result.date, timeZone)) title += ` (${date(result.date, timeZone)})`;
      lines = fields(result, CLOSING, language);
      break;
    case "get_top_products": {
      const products = Array.isArray(result) ? result : result.products;
      if (!Array.isArray(products)) return null;
      title = text("Top products by sales value", "बिक्री रकम के हिसाब से शीर्ष सामान", language);
      if (date(result.from, timeZone) && date(result.to, timeZone)) title += ` (${date(result.from, timeZone)} – ${date(result.to, timeZone)})`;
      lines = products.length ? rows(products, (row) => [label(row.productName), ...fields(row, [["revenuePaise", "Sales", "बिक्री", "paise"], ["grossProfitPaise", "Gross profit", "सकल मुनाफ़ा", "paise"], ["quantitySoldBase", "Quantity in stock unit", "स्टॉक यूनिट में मात्रा"]], language)].join("; "), language) : [text("No sales returned for this period.", "इस अवधि में बिक्री नहीं मिली।", language)];
      break;
    }
    case "get_inventory_health":
      title = text("Stock health", "स्टॉक की स्थिति", language);
      lines = fields(result, [["windowDays", "Movement window in days", "बिक्री देखने के दिन"], ["lowStockCount", "Low-stock products", "कम स्टॉक वाले सामान"], ["negativeStockCount", "Oversold products", "दर्ज स्टॉक से ज़्यादा बिके सामान"], ["notSellingCount", "Products with no sales in the window", "इस अवधि में नहीं बिके सामान"]], language);
      for (const [key, en, hi] of [["negativeStock", "Oversold", "दर्ज स्टॉक से ज़्यादा बिका"], ["lowStock", "Low stock", "कम स्टॉक"], ["notSelling", "No sales in this window", "इस अवधि में बिक्री नहीं"]]) {
        if (Array.isArray(result[key]) && result[key].length) lines.push(`${text(en, hi, language)}:`, ...rows(result[key], (row) => `${label(row.name)}: ${scalar(row.stock) ?? unavailable(language)}${row.unit ? ` ${label(row.unit)}` : ""}`, language, result[`${key}Count`] ?? result[key].length));
      }
      break;
    case "restaurant_list_tables":
      title = text("Restaurant tables", "रेस्टोरेंट टेबल", language);
      lines = fields(result, [["tableCount", "Tables", "टेबल"]], language);
      if (Array.isArray(result.tables)) lines.push(...rows(result.tables, (row) => [label(row.name ?? row.code), `${text("status", "स्थिति", language)}: ${label(row.status)}`, ...fields(row, [["seats", "Seats", "सीट"], ["runningTotal", "Running total", "अभी का बिल", "rupees"]], language)].join("; "), language, result.tableCount));
      break;
    case "restaurant_kitchen_tickets":
      title = text("Kitchen tickets", "किचन टिकट", language);
      lines = fields(result, [["ticketCount", "Tickets", "टिकट"]], language);
      if (Array.isArray(result.tickets)) lines.push(...rows(result.tickets, (row) => `${label(row.number ?? row.id)}; ${text("status", "स्थिति", language)}: ${label(row.status)}${row.table ? `; ${text("table", "टेबल", language)}: ${label(row.table)}` : ""}`, language, result.ticketCount));
      break;
    case "restaurant_menu_board":
      if (!Array.isArray(result.courses)) return null;
      title = text("Menu", "मेनू", language);
      lines = result.courses.length ? result.courses.slice(0, 5).flatMap((course) => [label(course.course), ...rows(course.dishes ?? [], (dish) => `${label(dish.name)}: ${evidenceMoney(dish.price, false) ?? unavailable(language)}; ${dish.available === true ? text("available", "उपलब्ध", language) : text("unavailable", "उपलब्ध नहीं", language)}`, language)]) : [text("No menu items returned.", "मेनू में सामान नहीं मिला।", language)];
      break;
    default: {
      const titles = WORKFLOW_TITLES[tool];
      if (!titles) return null;
      title = text(titles[0], titles[1], language);
      if (date(result.today, timeZone)) title += ` (${date(result.today, timeZone)})`;
      lines = fields(result.summary ?? result, WORKFLOW_FIELDS, language);
    }
  }
  return lines.length ? `${title}\n${lines.join("\n")}` : null;
}
