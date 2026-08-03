import type { Product, ProductInput } from "@/types/api";

export const COMMON_PRODUCT_ALIAS_MAP: Record<string, string[]> = {
  sugar: ["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर"],
  chini: ["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर"],
  cheeni: ["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर"],
  shakar: ["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर"],
  sakar: ["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर"],
  "चीनी": ["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर"],
  "शक्कर": ["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर"],
  atta: ["atta", "aata", "flour", "gehu atta", "आटा"],
  aata: ["atta", "aata", "flour", "gehu atta", "आटा"],
  flour: ["atta", "aata", "flour", "gehu atta", "आटा"],
  "gehu atta": ["atta", "aata", "flour", "gehu atta", "आटा"],
  "आटा": ["atta", "aata", "flour", "gehu atta", "आटा"],
  tel: ["tel", "oil", "तेल"],
  oil: ["tel", "oil", "तेल"],
  "तेल": ["tel", "oil", "तेल"],
  chawal: ["chawal", "rice", "चावल"],
  rice: ["chawal", "rice", "चावल"],
  "चावल": ["chawal", "rice", "चावल"],
  daal: ["daal", "dal", "lentil", "दाल"],
  dal: ["daal", "dal", "lentil", "दाल"],
  lentil: ["daal", "dal", "lentil", "दाल"],
  "दाल": ["daal", "dal", "lentil", "दाल"],
  namak: ["namak", "salt", "नमक"],
  salt: ["namak", "salt", "नमक"],
  "नमक": ["namak", "salt", "नमक"],
  haldi: ["haldi", "turmeric", "हल्दी"],
  turmeric: ["haldi", "turmeric", "हल्दी"],
  "हल्दी": ["haldi", "turmeric", "हल्दी"],
  mirchi: ["mirchi", "chilli", "मिर्च"],
  chilli: ["mirchi", "chilli", "मिर्च"],
  "मिर्च": ["mirchi", "chilli", "मिर्च"],
  chai: ["chai", "tea", "चाय"],
  tea: ["chai", "tea", "चाय"],
  "चाय": ["chai", "tea", "चाय"],
  sabun: ["sabun", "soap", "साबुन"],
  soap: ["sabun", "soap", "साबुन"],
  "साबुन": ["sabun", "soap", "साबुन"],
};

export const FALLBACK_PRODUCT_ALIAS_CHIPS = uniqueProductAliases(Object.values(COMMON_PRODUCT_ALIAS_MAP).flat());

type ProductSearchable = Pick<Product, "id" | "name" | "category" | "barcode" | "sku" | "unit" | "aliases"> & {
  deletedAt?: string | null;
  deleted_at?: string | null;
};

type ProductCandidate = Pick<ProductInput, "name" | "category" | "barcode" | "sku" | "unit" | "aliases">;

export type DuplicateProductReason = "barcode" | "name" | "alias" | "related_alias";

export interface DuplicateProductWarning {
  productId: string;
  productName: string;
  reason: DuplicateProductReason;
  matchedTerms: string[];
  message: string;
}

export function normaliseProductSearchTerm(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-IN")
    .normalize("NFKC")
    .replace(/[._\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseProductIdentityTerm(value: unknown): string {
  return normaliseProductSearchTerm(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normaliseProductBarcode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLocaleLowerCase("en-IN");
}

export function splitProductAliases(text: string | undefined): string[] {
  return (text ?? "")
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function uniqueProductAliases(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normaliseProductIdentityTerm(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function mergeProductAliasSuggestions(currentAliases: string[], suggestedAliases: string[]): string[] {
  return uniqueProductAliases([...currentAliases, ...suggestedAliases]);
}

export function getLocalProductAliasSuggestions(name: string, category?: string): string[] {
  const cleanName = name.trim();
  if (!cleanName) return [];
  const lower = normaliseProductSearchTerm(cleanName);
  const words = lower.split(/\s+/).filter(Boolean);
  const suggestions: string[] = [];

  suggestions.push(lower);
  if (words.length > 1) suggestions.push(words.map((word) => word[0]).join(""));
  for (const word of words) pushMappedAliases(suggestions, word);
  if (category && normaliseProductSearchTerm(category) !== "general") suggestions.push(`${lower} ${category}`);

  return uniqueProductAliases(suggestions).slice(0, 12);
}

function pushMappedAliases(target: string[], term: string) {
  target.push(...(COMMON_PRODUCT_ALIAS_MAP[term] ?? []));
  const identityTerm = normaliseProductIdentityTerm(term);
  for (const [key, aliases] of Object.entries(COMMON_PRODUCT_ALIAS_MAP)) {
    if (normaliseProductIdentityTerm(key) === identityTerm) target.push(...aliases);
  }
}

function safeStringValues(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function productTerms(product: ProductSearchable | ProductCandidate): string[] {
  return [
    product.name,
    product.category,
    product.barcode,
    product.sku,
    product.unit,
    ...(product.aliases ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normaliseProductSearchTerm(value));
}

function directIdentityTerms(product: ProductSearchable | ProductCandidate) {
  const name = normaliseProductIdentityTerm(product.name);
  const aliases = uniqueProductAliases(product.aliases ?? []).map(normaliseProductIdentityTerm).filter(Boolean);
  return { name, aliases };
}

function expandedRelatedTerms(product: ProductSearchable | ProductCandidate): string[] {
  const sourceTerms = safeStringValues([product.name, ...(product.aliases ?? [])]);
  const relatedTerms = sourceTerms.flatMap((value) => {
    const normalised = normaliseProductSearchTerm(value);
    const words = normalised.split(/\s+/).filter(Boolean);
    const mapped = words.flatMap((word) => {
      const suggestions: string[] = [];
      pushMappedAliases(suggestions, word);
      return suggestions;
    });
    return [value, ...getLocalProductAliasSuggestions(value, product.category ?? undefined), ...mapped];
  });
  return uniqueProductAliases(relatedTerms).map(normaliseProductIdentityTerm).filter(Boolean);
}

function uniqueMatchedTerms(values: string[]): string[] {
  return uniqueProductAliases(values).slice(0, 6);
}

export function buildProductSearchText(product: ProductSearchable): string {
  return productTerms(product).join(" ");
}

export function productMatchesSearch(product: ProductSearchable, query: string): boolean {
  const q = normaliseProductSearchTerm(query);
  if (!q) return true;
  return buildProductSearchText(product).includes(q);
}

function duplicateMessage(reason: DuplicateProductReason, candidateName: string, productName: string, matchedTerms: string[]): string {
  const terms = matchedTerms.length ? ` (${matchedTerms.join(", ")})` : "";
  if (reason === "barcode") return `Possible duplicate: barcode already exists on ${productName}${terms}.`;
  if (reason === "name") return `Possible duplicate: ${candidateName} has the same normalized name as ${productName}${terms}.`;
  if (reason === "alias") return `Possible duplicate: alias/name already exists on ${productName}${terms}.`;
  return `Possible duplicate: ${candidateName} looks similar to existing product ${productName}${terms}.`;
}

export function findDuplicateProductWarnings(
  candidate: ProductCandidate,
  products: ProductSearchable[],
  ignoreProductId?: string | null,
): DuplicateProductWarning[] {
  const candidateBarcode = normaliseProductBarcode(candidate.barcode || candidate.sku);
  const candidateIdentity = directIdentityTerms(candidate);
  const candidateName = candidate.name.trim();
  const candidateRelatedTerms = new Set(expandedRelatedTerms(candidate).filter((term) => term.length > 1));
  const warnings: DuplicateProductWarning[] = [];
  const seenProductReasons = new Set<string>();

  for (const product of products) {
    if (ignoreProductId && product.id === ignoreProductId) continue;
    if (product.deletedAt || product.deleted_at) continue;

    const existingBarcode = normaliseProductBarcode(product.barcode || product.sku);
    const existingIdentity = directIdentityTerms(product);
    const existingRelatedTerms = new Set(expandedRelatedTerms(product).filter((term) => term.length > 1));

    let reason: DuplicateProductReason | null = null;
    let matchedTerms: string[] = [];

    if (candidateBarcode && existingBarcode && candidateBarcode === existingBarcode) {
      reason = "barcode";
      matchedTerms = [candidateBarcode];
    } else if (candidateIdentity.name && candidateIdentity.name === existingIdentity.name) {
      reason = "name";
      matchedTerms = [candidateIdentity.name];
    } else {
      const candidateDirect = [candidateIdentity.name, ...candidateIdentity.aliases].filter(Boolean);
      const existingDirect = new Set([existingIdentity.name, ...existingIdentity.aliases].filter(Boolean));
      const aliasMatches = candidateDirect.filter((term) => existingDirect.has(term));
      if (aliasMatches.length > 0) {
        reason = "alias";
        matchedTerms = aliasMatches;
      } else {
        const relatedMatches = [...candidateRelatedTerms].filter((term) => existingRelatedTerms.has(term));
        if (relatedMatches.length > 0) {
          reason = "related_alias";
          matchedTerms = relatedMatches;
        }
      }
    }

    if (!reason) continue;
    const key = `${product.id}:${reason}`;
    if (seenProductReasons.has(key)) continue;
    seenProductReasons.add(key);
    const matched = uniqueMatchedTerms(matchedTerms);
    warnings.push({
      productId: product.id,
      productName: product.name,
      reason,
      matchedTerms: matched,
      message: duplicateMessage(reason, candidateName || "This product", product.name, matched),
    });
  }

  return warnings;
}
