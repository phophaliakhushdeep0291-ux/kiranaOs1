const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 6 * 60 * 60 * 1000;
const lookupCache = new Map();

export function normalizeKnowledgeBarcode(value) {
  const code = String(value ?? "").trim();
  if (!/^\d{8,14}$/.test(code)) return null;
  return code;
}

function cleanText(value, max = 240) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function firstText(...values) {
  return values.map((value) => cleanText(value)).find(Boolean) || "";
}

function safeImageUrl(...values) {
  for (const value of values) {
    try {
      const url = new URL(cleanText(value, 2_000));
      if (url.protocol === "https:" && (url.hostname === "openfoodfacts.org" || url.hostname.endsWith(".openfoodfacts.org"))) return url.toString();
    } catch { /* ignore incomplete or untrusted image URLs */ }
  }
  return null;
}

function parsePackSize(quantity) {
  const text = cleanText(quantity, 80).toLowerCase();
  const match = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(kg|g|mg|l|ml|cl|pcs?|pieces?|units?)(?:\s|$)/i);
  if (!match) return { packSizeValue: 1, packSizeUnit: "piece" };
  const unit = match[2].toLowerCase();
  return {
    packSizeValue: Number(match[1]),
    packSizeUnit: unit === "pc" || unit === "pcs" || unit.startsWith("piece") || unit.startsWith("unit") ? "piece" : unit,
  };
}

function categoryFrom(product) {
  const tag = Array.isArray(product?.categories_tags)
    ? product.categories_tags.find((value) => typeof value === "string" && value.trim())
    : "";
  const raw = firstText(tag, String(product?.categories || "").split(",")[0]);
  if (!raw) return "general";
  return raw.replace(/^[a-z]{2}:/i, "").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 100);
}

export function mapOpenFoodFactsProduct(barcode, body) {
  const product = body?.product;
  if (!product || typeof product !== "object") return null;
  const name = firstText(product.product_name_en, product.product_name, product.abbreviated_product_name);
  if (!name) return null;
  const pack = parsePackSize(product.quantity);
  const aliases = [product.product_name_hi, product.generic_name_en, product.generic_name]
    .map((value) => cleanText(value, 120))
    .filter((value, index, rows) => value && value.toLowerCase() !== name.toLowerCase() && rows.indexOf(value) === index)
    .slice(0, 8);
  return {
    found: true,
    barcode,
    name,
    brand: firstText(product.brands, Array.isArray(product.brands_tags) ? product.brands_tags[0] : ""),
    category: categoryFrom(product),
    unit: "packet",
    ...pack,
    aliases,
    description: firstText(product.generic_name_en, product.generic_name),
    imageUrl: safeImageUrl(product.image_front_url, product.image_url, product.image_front_small_url),
    source: "Open Food Facts",
  };
}

export function clearProductKnowledgeCache() {
  lookupCache.clear();
}

export async function lookupProductKnowledge(rawBarcode, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const barcode = normalizeKnowledgeBarcode(rawBarcode);
  if (!barcode) return { found: false, barcode: String(rawBarcode ?? "").trim(), reason: "unsupported_barcode" };
  const cached = lookupCache.get(barcode);
  if (cached && cached.expiresAt > now) return cached.value;
  if (typeof fetchImpl !== "function") return { found: false, barcode, reason: "lookup_unavailable" };

  const fields = [
    "code", "product_name", "product_name_en", "product_name_hi", "abbreviated_product_name",
    "brands", "brands_tags", "categories", "categories_tags", "quantity", "generic_name",
    "generic_name_en", "image_front_url", "image_front_small_url", "image_url",
  ].join(",");
  const endpoint = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}.json?product_type=all&fields=${encodeURIComponent(fields)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetchImpl(endpoint, {
      headers: { "user-agent": process.env.PRODUCT_KNOWLEDGE_USER_AGENT || "KiranaOS/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Product knowledge upstream returned ${response.status}`);
    const mapped = mapOpenFoodFactsProduct(barcode, await response.json());
    const value = mapped ?? { found: false, barcode, reason: "not_found" };
    lookupCache.set(barcode, { value, expiresAt: now + (mapped ? CACHE_TTL_MS : MISS_TTL_MS) });
    return value;
  } finally {
    clearTimeout(timer);
  }
}
