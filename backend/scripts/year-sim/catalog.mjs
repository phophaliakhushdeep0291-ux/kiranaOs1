/**
 * One-year kirana shop simulation — master data.
 *
 * Everything here is realistic Indian retail data (2025-26 pricing, real GST
 * slabs, real HSN chapters) so the reports produced at the end are meaningful
 * instead of noise.
 *
 * unit modes:
 *   "loose" → baseUnit g|ml, rateUnit kg|l  (weighed at the counter)
 *   "unit"  → baseUnit/rateUnit piece       (pre-packed MRP goods)
 */

// season tags used by the demand model
// all | summer | winter | monsoon | festive
const P = (
  name, category, brand, mode, cost, price, mrp, gst, hsn, pop, reorder, season = "all", packLabel = ""
) => ({ name, category, brand, mode, cost, price, mrp, gst, hsn, pop, reorder, season, packLabel });

export const PRODUCTS = [
  // ── Staples, loose (rate per kg) ────────────────────────────────
  P("Sona Masoori Rice (loose)", "staples", "", "loose", 46, 58, 62, 0, "1006", 95, 40000, "all"),
  P("Basmati Rice Premium (loose)", "staples", "", "loose", 92, 118, 125, 0, "1006", 35, 15000),
  P("Wheat Atta (loose)", "staples", "", "loose", 32, 42, 45, 0, "1101", 90, 40000),
  P("Toor Dal (loose)", "staples", "", "loose", 118, 148, 155, 0, "0713", 80, 15000),
  P("Chana Dal (loose)", "staples", "", "loose", 74, 92, 98, 0, "0713", 55, 12000),
  P("Moong Dal (loose)", "staples", "", "loose", 96, 122, 130, 0, "0713", 45, 10000),
  P("Urad Dal (loose)", "staples", "", "loose", 105, 132, 140, 0, "0713", 35, 8000),
  P("Rajma (loose)", "staples", "", "loose", 108, 138, 145, 0, "0713", 25, 6000),
  P("Sugar (loose)", "staples", "", "loose", 41, 48, 52, 5, "1701", 88, 30000),
  P("Poha (loose)", "staples", "", "loose", 42, 56, 60, 5, "1904", 40, 8000),
  P("Rava / Sooji (loose)", "staples", "", "loose", 36, 48, 52, 5, "1103", 38, 8000),
  P("Besan (loose)", "staples", "", "loose", 78, 96, 102, 5, "1106", 42, 8000, "festive"),
  P("Groundnut / Peanut (loose)", "staples", "", "loose", 88, 112, 120, 5, "1202", 30, 6000, "festive"),
  P("Mustard Oil (loose)", "oils", "", "loose-ml", 128, 158, 168, 5, "1514", 30, 10000),

  // ── Vegetables, loose ───────────────────────────────────────────
  P("Onion", "vegetables", "", "loose", 24, 34, 38, 0, "0703", 92, 25000),
  P("Potato", "vegetables", "", "loose", 18, 26, 30, 0, "0701", 90, 25000),
  P("Tomato", "vegetables", "", "loose", 26, 40, 46, 0, "0702", 78, 12000),
  P("Ginger", "vegetables", "", "loose", 78, 108, 118, 0, "0910", 40, 3000),
  P("Garlic", "vegetables", "", "loose", 112, 148, 160, 0, "0703", 38, 3000),
  P("Lemon", "vegetables", "", "unit", 3.2, 5, 6, 0, "0805", 45, 120, "summer", "1 pc"),

  // ── Dairy ───────────────────────────────────────────────────────
  P("Amul Taaza Milk 500ml", "dairy", "Amul", "unit", 25, 28, 28, 0, "0401", 100, 120, "all", "500 ml pouch"),
  P("Amul Gold Milk 500ml", "dairy", "Amul", "unit", 30, 34, 34, 0, "0401", 72, 90, "all", "500 ml pouch"),
  P("Amul Butter 100g", "dairy", "Amul", "unit", 54, 62, 62, 12, "0405", 55, 40, "winter", "100 g"),
  P("Amul Cheese Slices 200g", "dairy", "Amul", "unit", 122, 140, 145, 12, "0406", 25, 15, "all", "200 g"),
  P("Amul Masti Dahi 400g", "dairy", "Amul", "unit", 32, 40, 42, 5, "0403", 60, 40, "summer", "400 g"),
  P("Amul Ghee 500ml", "dairy", "Amul", "unit", 315, 355, 365, 12, "0405", 40, 24, "festive", "500 ml tin"),
  P("Mother Dairy Paneer 200g", "dairy", "Mother Dairy", "unit", 88, 105, 110, 5, "0406", 35, 20, "all", "200 g"),
  P("Farm Eggs", "dairy", "", "unit", 6.2, 8, 9, 0, "0407", 70, 180, "winter", "1 pc"),

  // ── Bakery & biscuits ───────────────────────────────────────────
  P("Britannia Brown Bread", "bakery", "Britannia", "unit", 42, 50, 50, 0, "1905", 65, 30, "all", "400 g"),
  P("Parle-G Biscuit 100g", "biscuits", "Parle", "unit", 8.3, 10, 10, 18, "1905", 96, 200, "monsoon", "100 g"),
  P("Britannia Good Day 100g", "biscuits", "Britannia", "unit", 25, 30, 30, 18, "1905", 62, 120, "monsoon", "100 g"),
  P("Britannia Marie Gold 250g", "biscuits", "Britannia", "unit", 33, 40, 40, 18, "1905", 48, 80, "monsoon", "250 g"),
  P("Sunfeast Dark Fantasy 75g", "biscuits", "ITC", "unit", 34, 40, 40, 18, "1905", 40, 60, "all", "75 g"),
  P("Oreo Biscuit 120g", "biscuits", "Cadbury", "unit", 30, 35, 35, 18, "1905", 38, 60, "all", "120 g"),

  // ── Snacks & namkeen ────────────────────────────────────────────
  P("Haldiram Bhujia 200g", "snacks", "Haldiram", "unit", 45, 55, 55, 12, "2106", 58, 60, "festive", "200 g"),
  P("Kurkure Masala Munch 70g", "snacks", "Pepsico", "unit", 16.5, 20, 20, 12, "2106", 75, 120, "monsoon", "70 g"),
  P("Lays Classic Salted 52g", "snacks", "Pepsico", "unit", 16.5, 20, 20, 12, "2106", 70, 120, "monsoon", "52 g"),
  P("Bingo Mad Angles 66g", "snacks", "ITC", "unit", 16.5, 20, 20, 12, "2106", 45, 80, "all", "66 g"),
  P("Maggi Noodles 70g", "instant", "Nestle", "unit", 11.5, 14, 14, 12, "1902", 98, 250, "monsoon", "70 g"),
  P("Maggi Noodles 8-pack", "instant", "Nestle", "unit", 92, 108, 112, 12, "1902", 42, 40, "monsoon", "560 g"),
  P("Yippee Noodles 70g", "instant", "ITC", "unit", 11, 14, 14, 12, "1902", 32, 80, "all", "70 g"),

  // ── Beverages ───────────────────────────────────────────────────
  P("Tata Tea Gold 500g", "beverages", "Tata", "unit", 265, 305, 315, 5, "0902", 62, 30, "winter", "500 g"),
  P("Red Label Tea 250g", "beverages", "HUL", "unit", 128, 150, 155, 5, "0902", 48, 30, "winter", "250 g"),
  P("Nescafe Classic 50g", "beverages", "Nestle", "unit", 168, 195, 200, 18, "2101", 30, 20, "winter", "50 g"),
  P("Bournvita 500g", "beverages", "Cadbury", "unit", 232, 265, 275, 18, "1806", 32, 20, "winter", "500 g"),
  P("Horlicks 500g", "beverages", "HUL", "unit", 245, 280, 290, 18, "1901", 26, 18, "winter", "500 g"),
  P("Coca-Cola 750ml", "beverages", "Coca-Cola", "unit", 32, 40, 40, 28, "2202", 68, 90, "summer", "750 ml"),
  P("Thums Up 750ml", "beverages", "Coca-Cola", "unit", 32, 40, 40, 28, "2202", 62, 90, "summer", "750 ml"),
  P("Sprite 750ml", "beverages", "Coca-Cola", "unit", 32, 40, 40, 28, "2202", 45, 60, "summer", "750 ml"),
  P("Frooti 200ml", "beverages", "Parle Agro", "unit", 8.5, 10, 10, 12, "2202", 80, 200, "summer", "200 ml"),
  P("Real Mixed Fruit Juice 1L", "beverages", "Dabur", "unit", 105, 125, 130, 12, "2009", 30, 24, "summer", "1 L"),
  P("Bisleri Water 1L", "beverages", "Bisleri", "unit", 13, 20, 20, 18, "2201", 72, 150, "summer", "1 L"),

  // ── Cooking oils, masala, packaged staples ──────────────────────
  P("Fortune Sunflower Oil 1L", "oils", "Fortune", "unit", 138, 158, 165, 5, "1512", 78, 60, "all", "1 L"),
  P("Saffola Gold Oil 1L", "oils", "Marico", "unit", 165, 190, 199, 5, "1512", 42, 36, "all", "1 L"),
  P("Dhara Mustard Oil 1L", "oils", "Dhara", "unit", 152, 175, 182, 5, "1514", 38, 30, "winter", "1 L"),
  P("Tata Salt 1kg", "staples", "Tata", "unit", 24, 30, 30, 0, "2501", 85, 100, "all", "1 kg"),
  P("Aashirvaad Atta 5kg", "staples", "ITC", "unit", 245, 285, 295, 5, "1101", 66, 40, "all", "5 kg"),
  P("MDH Garam Masala 100g", "masala", "MDH", "unit", 78, 92, 95, 5, "0910", 44, 40, "festive", "100 g"),
  P("Everest Turmeric 200g", "masala", "Everest", "unit", 62, 76, 80, 5, "0910", 46, 40, "all", "200 g"),
  P("Catch Red Chilli Powder 100g", "masala", "Catch", "unit", 48, 60, 62, 5, "0904", 40, 40, "all", "100 g"),
  P("Kissan Mixed Fruit Jam 200g", "packaged", "Kissan", "unit", 68, 82, 85, 12, "2007", 24, 20, "all", "200 g"),
  P("Kissan Tomato Ketchup 500g", "packaged", "Kissan", "unit", 88, 105, 110, 12, "2103", 34, 24, "all", "500 g"),

  // ── Personal care ───────────────────────────────────────────────
  P("Colgate Strong Teeth 200g", "personal-care", "Colgate", "unit", 92, 110, 115, 18, "3306", 52, 40, "all", "200 g"),
  P("Close Up Red 150g", "personal-care", "HUL", "unit", 78, 92, 95, 18, "3306", 32, 30, "all", "150 g"),
  P("Lifebuoy Soap 125g", "personal-care", "HUL", "unit", 28, 35, 36, 18, "3401", 68, 100, "all", "125 g"),
  P("Lux Soap 100g", "personal-care", "HUL", "unit", 30, 38, 40, 18, "3401", 55, 80, "all", "100 g"),
  P("Dove Soap 100g", "personal-care", "HUL", "unit", 55, 68, 70, 18, "3401", 34, 40, "all", "100 g"),
  P("Clinic Plus Shampoo 175ml", "personal-care", "HUL", "unit", 118, 140, 145, 18, "3305", 40, 30, "all", "175 ml"),
  P("Parachute Coconut Oil 200ml", "personal-care", "Marico", "unit", 82, 98, 102, 18, "3305", 46, 36, "winter", "200 ml"),
  P("Nivea Cold Cream 60ml", "personal-care", "Nivea", "unit", 108, 128, 135, 18, "3304", 22, 18, "winter", "60 ml"),
  P("Gillette Guard Razor", "personal-care", "Gillette", "unit", 28, 35, 35, 18, "8212", 26, 40, "all", "1 pc"),
  P("Whisper Ultra 15 pads", "personal-care", "P&G", "unit", 148, 175, 180, 12, "9619", 30, 24, "all", "15 pads"),

  // ── Home care ───────────────────────────────────────────────────
  P("Surf Excel Easy Wash 1kg", "home-care", "HUL", "unit", 118, 140, 145, 18, "3402", 58, 40, "all", "1 kg"),
  P("Ariel Detergent 1kg", "home-care", "P&G", "unit", 132, 155, 160, 18, "3402", 42, 30, "all", "1 kg"),
  P("Nirma Washing Powder 1kg", "home-care", "Nirma", "unit", 58, 72, 75, 18, "3402", 48, 40, "all", "1 kg"),
  P("Vim Dishwash Bar 200g", "home-care", "HUL", "unit", 16, 20, 20, 18, "3401", 72, 120, "all", "200 g"),
  P("Vim Liquid 500ml", "home-care", "HUL", "unit", 98, 118, 122, 18, "3402", 36, 30, "all", "500 ml"),
  P("Harpic Toilet Cleaner 500ml", "home-care", "Reckitt", "unit", 88, 105, 110, 18, "3402", 38, 30, "all", "500 ml"),
  P("Lizol Floor Cleaner 500ml", "home-care", "Reckitt", "unit", 105, 125, 130, 18, "3402", 30, 24, "all", "500 ml"),
  P("Dettol Antiseptic 250ml", "home-care", "Reckitt", "unit", 132, 155, 160, 18, "3808", 28, 20, "monsoon", "250 ml"),
  P("Good Knight Refill 45ml", "home-care", "Godrej", "unit", 72, 88, 92, 18, "3808", 44, 36, "monsoon", "45 ml"),
  P("Odonil Air Freshener 50g", "home-care", "Dabur", "unit", 62, 78, 80, 18, "3307", 24, 20, "all", "50 g"),

  // ── Confectionery ───────────────────────────────────────────────
  P("Dairy Milk 50g", "confectionery", "Cadbury", "unit", 34, 40, 40, 18, "1806", 65, 80, "festive", "50 g"),
  P("5 Star 25g", "confectionery", "Cadbury", "unit", 8.5, 10, 10, 18, "1806", 70, 150, "all", "25 g"),
  P("KitKat 4-finger", "confectionery", "Nestle", "unit", 17, 20, 20, 18, "1806", 55, 100, "all", "4 finger"),
  P("Center Fresh Gum (jar pc)", "confectionery", "Perfetti", "unit", 0.85, 1, 1, 18, "1704", 60, 500, "all", "1 pc"),

  // ── General / non-food ──────────────────────────────────────────
  P("Agarbatti Pack (20 sticks)", "general", "Cycle", "unit", 24, 30, 32, 12, "3307", 50, 60, "festive", "20 sticks"),
  P("Camphor 50g", "general", "", "unit", 42, 55, 58, 12, "2914", 25, 24, "festive", "50 g"),
  P("Candle Pack (6 pc)", "general", "", "unit", 32, 42, 45, 12, "3406", 28, 30, "festive", "6 pc"),
  P("Match Box", "general", "", "unit", 1.1, 2, 2, 18, "3605", 55, 300, "all", "1 box"),
  P("AA Battery (2 pc)", "general", "Eveready", "unit", 28, 36, 38, 18, "8506", 22, 40, "all", "2 pc"),
  P("LED Bulb 9W", "general", "Syska", "unit", 78, 99, 105, 12, "8539", 18, 20, "all", "1 pc"),
  P("Classmate Notebook 172pg", "stationery", "ITC", "unit", 42, 55, 58, 12, "4820", 30, 40, "all", "172 pages"),
  P("Reynolds Pen", "stationery", "Reynolds", "unit", 7, 10, 10, 12, "9608", 40, 100, "all", "1 pc"),
];

/** Products introduced mid-year (range expansion) — index into PRODUCTS is by name. */
export const LATE_LAUNCH = new Set([
  "Real Mixed Fruit Juice 1L",
  "Nivea Cold Cream 60ml",
  "Dove Soap 100g",
  "LED Bulb 9W",
  "Yippee Noodles 70g",
  "Bingo Mad Angles 66g",
  "Oreo Biscuit 120g",
  "Amul Cheese Slices 200g",
  "Whisper Ultra 15 pads",
  "Sprite 750ml",
]);

export const SUPPLIERS = [
  { name: "Shree Balaji Wholesale", mobile: "9822014455", address: "APMC Market, Gate 3, Pune", cats: ["staples", "oils", "masala"] },
  { name: "Amul Distributor - Krishna Agency", mobile: "9822033214", address: "Dairy Depot, Shivaji Nagar", cats: ["dairy"] },
  { name: "Ganesh Traders (FMCG)", mobile: "9860112233", address: "Wholesale Lane, Camp", cats: ["personal-care", "home-care"] },
  { name: "Pepsi-ITC Stockist Nandi", mobile: "9890044556", address: "Depot Road, Hadapsar", cats: ["snacks", "biscuits", "instant", "confectionery"] },
  { name: "Coca-Cola Route Van", mobile: "9011223344", address: "Bottling Plant Route 4", cats: ["beverages"] },
  { name: "Mahalaxmi Vegetable Mandi", mobile: "9765443322", address: "Market Yard Block B", cats: ["vegetables"] },
  { name: "Sai General Suppliers", mobile: "9922553311", address: "Old Bazaar Street", cats: ["general", "stationery", "packaged", "bakery"] },
  { name: "Nutan Provision Depot", mobile: "9767881122", address: "Ring Road Godown 9", cats: ["staples", "beverages"] },
];

const FIRST = ["Rakesh", "Sunita", "Mahesh", "Anita", "Sanjay", "Pooja", "Vikram", "Kavita", "Nitin", "Sneha", "Ramesh", "Meena", "Amit", "Rekha", "Deepak", "Jyoti", "Suresh", "Manisha", "Prakash", "Shalini", "Ganesh", "Vaishali", "Rohit", "Priya", "Ashok", "Neha", "Kiran", "Swati", "Arun", "Madhuri", "Sachin", "Trupti", "Yogesh", "Ashwini", "Nilesh", "Smita", "Balaji", "Archana", "Dattatray", "Harshada", "Imran", "Farida", "Salim", "Nasreen", "Joseph", "Maria", "Gurpreet", "Simran", "Vijay", "Lata"];
const LAST = ["Patil", "Sharma", "Deshmukh", "Joshi", "Kulkarni", "Shinde", "Jadhav", "Gupta", "Verma", "Pawar", "More", "Bhosale", "Chavan", "Kadam", "Salunkhe", "Shaikh", "Khan", "Dsouza", "Singh", "Rane"];

export function buildCustomers(rng, count) {
  const used = new Set();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const name = `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`;
    let mobile;
    do {
      mobile = `9${String(Math.floor(rng() * 900000000) + 100000000)}`;
    } while (used.has(mobile));
    used.add(mobile);
    // ~30% keep a khata (udhar) with the shop
    const type = rng() < 0.3 ? "udhar" : "regular";
    out.push({
      name,
      mobile,
      type,
      address: `${Math.floor(rng() * 200) + 1}, ${["Shivaji Nagar", "Gandhi Chowk", "Nehru Colony", "Ganesh Peth", "Sai Nagar", "Bhagat Lane"][Math.floor(rng() * 6)]}`,
      // spend appetite multiplier
      weight: 0.4 + rng() * 2.2,
    });
  }
  // a few GST-registered buyers (kirana sells to small hotels/canteens)
  out[0] = { ...out[0], name: "Annapurna Mess & Canteen", gstNumber: "27AAFCA1234H1Z1", stateCode: "27", type: "udhar", weight: 6 };
  out[1] = { ...out[1], name: "Sai Snacks Corner", gstNumber: "27AAECS4567L1ZT", stateCode: "27", type: "udhar", weight: 5 };
  out[2] = { ...out[2], name: "Hotel Green Leaf", gstNumber: "27AABCH7788M1ZS", stateCode: "27", type: "udhar", weight: 5.5 };
  return out;
}

/** Monthly fixed / semi-fixed operating expenses. */
export const MONTHLY_EXPENSES = [
  { title: "Shop rent", category: "rent", amount: 18000, mode: "bank", vendor: "Landlord - Mr. Deshpande", day: 3, recurring: "monthly" },
  { title: "Staff salary - Ravi (counter)", category: "salary", amount: 14000, mode: "cash", vendor: "Ravi Kamble", day: 5, recurring: "monthly" },
  { title: "Staff salary - Sunil (delivery)", category: "salary", amount: 11000, mode: "cash", vendor: "Sunil Waghmare", day: 5, recurring: "monthly" },
  { title: "Electricity bill", category: "utilities", amount: 0, mode: "upi", vendor: "MSEDCL", day: 12, recurring: "monthly" },
  { title: "Broadband + POS internet", category: "utilities", amount: 799, mode: "upi", vendor: "Jio Fiber", day: 8, recurring: "monthly" },
  { title: "Shop cleaning & maintenance", category: "maintenance", amount: 1200, mode: "cash", vendor: "Local help", day: 20, recurring: "monthly" },
  { title: "Carry bags & packaging", category: "packaging", amount: 1650, mode: "cash", vendor: "Poly Pack Traders", day: 15, recurring: "monthly" },
  { title: "Transport / tempo charges", category: "transport", amount: 2400, mode: "cash", vendor: "Tempo Union", day: 22, recurring: "monthly" },
  { title: "Municipal / trade licence instalment", category: "compliance", amount: 900, mode: "bank", vendor: "PMC", day: 25, recurring: "monthly" },
];

export const AD_HOC_EXPENSES = [
  { title: "Tea & refreshments", category: "misc", amount: [60, 180], mode: "cash" },
  { title: "Auto fare for stock pickup", category: "transport", amount: [120, 400], mode: "cash" },
  { title: "Bill book / stationery", category: "misc", amount: [80, 350], mode: "cash" },
  { title: "Weighing scale calibration", category: "maintenance", amount: [250, 700], mode: "cash" },
  { title: "Mobile recharge (shop number)", category: "utilities", amount: [199, 599], mode: "upi" },
  { title: "Pest control", category: "maintenance", amount: [600, 1400], mode: "upi" },
];

/**
 * Festival calendar for the simulated year (2025-07-26 → 2026-07-25).
 * boost = footfall multiplier on the day; ramp days before also lift.
 */
export const FESTIVALS = [
  { date: "2025-08-09", name: "Raksha Bandhan", boost: 1.35, ramp: 2 },
  { date: "2025-08-16", name: "Janmashtami", boost: 1.25, ramp: 1 },
  { date: "2025-08-27", name: "Ganesh Chaturthi", boost: 1.6, ramp: 3 },
  { date: "2025-09-06", name: "Anant Chaturdashi", boost: 1.3, ramp: 1 },
  { date: "2025-10-02", name: "Dussehra", boost: 1.45, ramp: 2 },
  { date: "2025-10-20", name: "Diwali (Lakshmi Pujan)", boost: 2.1, ramp: 5 },
  { date: "2025-10-22", name: "Bhaubeej", boost: 1.4, ramp: 1 },
  { date: "2025-11-05", name: "Tulsi Vivah", boost: 1.15, ramp: 1 },
  { date: "2025-12-25", name: "Christmas", boost: 1.25, ramp: 2 },
  { date: "2026-01-01", name: "New Year", boost: 1.3, ramp: 1 },
  { date: "2026-01-14", name: "Makar Sankranti", boost: 1.35, ramp: 2 },
  { date: "2026-02-15", name: "Mahashivratri", boost: 1.2, ramp: 1 },
  { date: "2026-03-03", name: "Holi", boost: 1.55, ramp: 3 },
  { date: "2026-03-20", name: "Gudi Padwa", boost: 1.4, ramp: 2 },
  { date: "2026-03-21", name: "Eid-ul-Fitr", boost: 1.35, ramp: 2 },
  { date: "2026-04-14", name: "Ambedkar Jayanti", boost: 1.15, ramp: 1 },
  { date: "2026-05-28", name: "Eid-ul-Adha", boost: 1.25, ramp: 2 },
  { date: "2026-07-16", name: "Ashadhi Ekadashi", boost: 1.2, ramp: 1 },
];

/** Coupons run through the year (created + expired on schedule). */
export const OFFER_PLAN = [
  { code: "GANESH50", title: "Ganesh Utsav ₹50 off", type: "flat", value: 50, minBillAmount: 600, from: "2025-08-24", to: "2025-09-07", usageLimit: 400 },
  { code: "DIWALI10", title: "Diwali 10% off", type: "percentage", value: 10, minBillAmount: 500, maxDiscount: 150, from: "2025-10-12", to: "2025-10-25", usageLimit: 800 },
  { code: "NEWYEAR75", title: "New Year ₹75 off", type: "flat", value: 75, minBillAmount: 800, from: "2025-12-28", to: "2026-01-05", usageLimit: 300 },
  { code: "HOLI15", title: "Holi 15% off snacks", type: "percentage", value: 15, minBillAmount: 400, maxDiscount: 120, from: "2026-02-26", to: "2026-03-06", usageLimit: 500 },
  { code: "SUMMER25", title: "Summer cool ₹25 off", type: "flat", value: 25, minBillAmount: 300, from: "2026-04-15", to: "2026-06-15", usageLimit: 900 },
];
