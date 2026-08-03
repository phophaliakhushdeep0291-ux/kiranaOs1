import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMock = vi.hoisted(() => ({
  requestAiProductAliases: vi.fn(),
}));

vi.mock("@/lib/ai/ai-client", () => ({
  requestAiProductAliases: aiMock.requestAiProductAliases,
}));

import { requestAiProductAliases } from "@/lib/ai/ai-client";
import { fetchProductAliasSuggestions } from "@/features/core/products/pages/product-aliases";
import {
  FALLBACK_PRODUCT_ALIAS_CHIPS,
  getLocalProductAliasSuggestions,
  mergeProductAliasSuggestions,
} from "@/features/core/products/product-reliability";

const mockedRequestAiProductAliases = vi.mocked(requestAiProductAliases);

describe("product alias suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls backend AI proxy and merges successful aliases without duplicates", async () => {
    mockedRequestAiProductAliases.mockResolvedValueOnce({
      aliases: ["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर", "sugar"],
    });

    const result = await fetchProductAliasSuggestions("chini", "grocery");

    expect(mockedRequestAiProductAliases).toHaveBeenCalledWith({
      name: "chini",
      category: "grocery",
      languageContext: ["Hindi", "Hinglish", "English", "local kirana names"],
    });
    expect(result.source).toBe("backend");
    expect(result.aliases).toEqual(["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर", "chini grocery"]);
  });

  it("falls back to local dictionary when backend proxy fails", async () => {
    mockedRequestAiProductAliases.mockRejectedValueOnce(new Error("backend unavailable"));

    const result = await fetchProductAliasSuggestions("atta", "grocery");

    expect(result.source).toBe("fallback");
    expect(result.aliases).toEqual(expect.arrayContaining(["atta", "aata", "flour", "gehu atta", "आटा"]));
  });

  it("fallback dictionary includes common kirana Hindi/Hinglish/English names", () => {
    expect(FALLBACK_PRODUCT_ALIAS_CHIPS).toEqual(expect.arrayContaining([
      "sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर",
      "atta", "aata", "flour", "gehu atta", "आटा",
      "tel", "oil", "तेल",
      "chawal", "rice", "चावल",
      "daal", "dal", "lentil", "दाल",
      "namak", "salt", "नमक",
      "haldi", "turmeric", "हल्दी",
      "mirchi", "chilli", "मिर्च",
      "chai", "tea", "चाय",
      "sabun", "soap", "साबुन",
    ]));
  });

  it("local sugar/chini fallback includes Hindi, Hinglish and English aliases", () => {
    expect(getLocalProductAliasSuggestions("cheeni", "grocery")).toEqual(expect.arrayContaining([
      "sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर",
    ]));
  });

  it("merges accepted aliases without duplicates", () => {
    expect(mergeProductAliasSuggestions(
      ["sugar", "Chini", "चीनी"],
      ["chini", "cheeni", "Sugar", "चीनी", "शक्कर"],
    )).toEqual(["sugar", "Chini", "चीनी", "cheeni", "शक्कर"]);
  });
});
