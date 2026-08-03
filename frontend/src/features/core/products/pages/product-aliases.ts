import { requestAiProductAliases } from "@/lib/ai/ai-client";
import {
  getLocalProductAliasSuggestions,
  uniqueProductAliases,
} from "@/features/core/products/product-reliability";

export interface ProductAliasSuggestionResult {
  aliases: string[];
  source: "backend" | "fallback";
}

const PRODUCT_ALIAS_LANGUAGE_CONTEXT = ["Hindi", "Hinglish", "English", "local kirana names"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readAliases(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (isRecord(value) && Array.isArray(value.aliases)) {
    return value.aliases.filter((item): item is string => typeof item === "string");
  }
  return [];
}

export function extractJsonArrayFromText(text: string): string[] {
  const trimmed = text.trim();
  try {
    return readAliases(JSON.parse(trimmed));
  } catch {
    // Backend AI may return a short sentence; parse comma/newline list below.
  }

  const match = trimmed.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      return readAliases(JSON.parse(match[0]));
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  return trimmed
    .replace(/^aliases?:/i, "")
    .split(/[\n,]/)
    .map((item) => item.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean);
}

export async function fetchProductAliasSuggestions(name: string, category: string): Promise<ProductAliasSuggestionResult> {
  const localFallback = getLocalProductAliasSuggestions(name, category);

  try {
    const response = await requestAiProductAliases({
      name,
      category,
      languageContext: PRODUCT_ALIAS_LANGUAGE_CONTEXT,
    });
    const aliases = readAliases(response);
    if (aliases.length > 0) {
      return {
        aliases: uniqueProductAliases([...aliases, ...localFallback]).slice(0, 16),
        source: "backend",
      };
    }
  } catch {
    // Backend AI proxy is optional for offline/local use. Keep local fallback safe in the browser.
  }

  return { aliases: localFallback, source: "fallback" };
}

export async function fetchAiAliasSuggestions(name: string, category: string): Promise<string[]> {
  const result = await fetchProductAliasSuggestions(name, category);
  return result.aliases;
}


export async function fetchGroqAliasSuggestions(name: string, category: string, _unit?: string): Promise<string[]> {
  const result = await fetchProductAliasSuggestions(name, category);
  return result.aliases;
}
