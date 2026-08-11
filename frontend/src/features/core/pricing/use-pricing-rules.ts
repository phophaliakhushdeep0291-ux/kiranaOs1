import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPricingRule, deletePricingRule, listPricingRules, updatePricingRule, type ApiPricingRule } from "./api";
import { refreshPricingRulesCache } from "./pricing-rules-cache";

const KEY = ["pricing-rules"] as const;

/** All non-archived rules (owner editor). Billing uses the cached ACTIVE subset. */
export function usePricingRules(ownerPin: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => (await listPricingRules("")).rules,
    staleTime: 30_000,
  });

  // Any mutation invalidates the editor list AND refreshes the offline billing
  // cache so the counter prices with the new rule immediately.
  const afterWrite = async () => {
    await qc.invalidateQueries({ queryKey: KEY });
    await refreshPricingRulesCache().catch(() => undefined);
  };

  const create = useMutation({ mutationFn: (body: Partial<ApiPricingRule> & { name: string; ruleType: string }) => createPricingRule(body, ownerPin), onSuccess: afterWrite });
  const update = useMutation({ mutationFn: (v: { id: string; body: Partial<ApiPricingRule> }) => updatePricingRule(v.id, v.body, ownerPin), onSuccess: afterWrite });
  const remove = useMutation({ mutationFn: (id: string) => deletePricingRule(id, ownerPin), onSuccess: afterWrite });

  return { query, create, update, remove };
}

/** Split a product's rules into the editor's three sections. */
export function partitionProductRules(rules: ApiPricingRule[], productId: string) {
  const forProduct = rules.filter((r) => r.productId === productId);
  return {
    quantitySlabs: forProduct.filter((r) => r.ruleType === "PRODUCT_QUANTITY_PRICE").sort((a, b) => (a.minQuantity ?? 0) - (b.minQuantity ?? 0)),
    groupPrices: forProduct.filter((r) => r.ruleType === "CUSTOMER_GROUP_PRICE"),
    customerPrices: forProduct.filter((r) => r.ruleType === "CUSTOMER_FIXED_PRICE"),
  };
}
