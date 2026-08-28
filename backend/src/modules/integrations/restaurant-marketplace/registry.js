import { AppError } from "../../../middleware/error.js";

// Neither a saved outlet id nor a KiranaOS developer key proves marketplace
// access. Real adapters are registered in code only after their official wire
// contracts, authentication and end-to-end fulfilment path are implemented.
export const RESTAURANT_MARKETPLACE_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "zomato", name: "Zomato", implemented: false, fulfilmentReady: false, adapterVersion: null,
    docsUrl: "https://www.zomato.com/developer/integration/docs/getting-started/forms/",
    blocker: "PARTNER_CONTRACT_REQUIRED",
  }),
  Object.freeze({
    id: "swiggy", name: "Swiggy", implemented: false, fulfilmentReady: false, adapterVersion: null,
    docsUrl: "https://partner.swiggy.com/",
    blocker: "MERCHANT_POS_CONTRACT_REQUIRED",
  }),
]);

export function marketplaceProvider(provider) {
  const value = RESTAURANT_MARKETPLACE_PROVIDERS.find((row) => row.id === provider);
  if (!value) throw new AppError("Restaurant marketplace is not supported", 400, "MARKETPLACE_PROVIDER_UNSUPPORTED");
  return value;
}

export function requireMarketplaceAdapter(provider) {
  marketplaceProvider(provider);
  // Intentionally no environment flag or user-supplied URL can bypass this.
  // Consumer food-ordering APIs are not merchant order-ingestion contracts.
  throw new AppError("Official POS partner contract and a certified adapter are required before live connection", 503, "MARKETPLACE_ADAPTER_REQUIRED");
}

export function marketplaceInboxEnabled(connections) {
  return connections.some((row) => row.status === "verified" && row.enabled
    && row.environment === "live" && row.verifiedAt && row.verificationReference
    && row.adapterVersion && RESTAURANT_MARKETPLACE_PROVIDERS.some((provider) => provider.id === row.provider
      && provider.implemented && provider.fulfilmentReady && provider.adapterVersion === row.adapterVersion));
}

export function withMarketplaceNavigation(bootstrap, connections) {
  if (bootstrap.shop.businessType !== "restaurant") return bootstrap;
  const navigation = bootstrap.navigation.filter((id) => id !== "orders");
  if (marketplaceInboxEnabled(connections)) navigation.push("orders");
  return { ...bootstrap, navigation };
}
