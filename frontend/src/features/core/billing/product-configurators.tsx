import type { ComponentType } from "react";
import type { Product } from "@/types/api";
import type { SelectedAddon } from "./pages/billing-types";

/** A vertical-owned choice dialog that runs before a product becomes a cart line. */
export interface ProductConfiguratorProps {
  product: Product;
  data: unknown;
  onConfirm: (result: { addons?: SelectedAddon[] }) => void;
  onCancel: () => void;
}

export interface ProductConfigurator {
  id: string;
  appliesTo: (product: Product) => boolean;
  /** Null means this product has no choices and should be added immediately. */
  load: (product: Product) => Promise<unknown | null>;
  Component: ComponentType<ProductConfiguratorProps>;
}

const configurators: ProductConfigurator[] = [];

export function registerProductConfigurator(configurator: ProductConfigurator) {
  if (!configurator?.id || typeof configurator.load !== "function" || typeof configurator.Component !== "function") {
    throw new TypeError("A product configurator needs an id, loader and component");
  }
  if (configurators.some((current) => current.id === configurator.id)) return;
  configurators.push(configurator);
}

export function productConfiguratorFor(product: Product): ProductConfigurator | null {
  return configurators.find((configurator) => configurator.appliesTo(product)) ?? null;
}

export function resetProductConfigurators() {
  configurators.length = 0;
}
