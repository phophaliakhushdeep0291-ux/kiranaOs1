// Counts only — the catalog itself is loaded with a dynamic import when the shop taps
// the action. Importing the data module here would put 560 rows in the settings chunk.
import { KIRANA_STARTER_CATALOG_COUNT } from "@/features/core/products/starter-catalog/kirana-catalog-summary.generated";

export const MERCHANT_SETUP_KEY = "onboarding:merchant-setup:v1";

export type MerchantSetupStepId =
  | "store-profile"
  | "taxes"
  | "billing"
  | "printer"
  | "products"
  | "customers"
  | "suppliers"
  | "first-bill";

export interface MerchantSetupState {
  version: 1;
  confirmed: Partial<Record<MerchantSetupStepId, boolean>>;
  skipped: Partial<Record<MerchantSetupStepId, boolean>>;
  lastStepId?: MerchantSetupStepId;
  updatedAt: string;
}

export interface MerchantSetupFacts {
  storeProfileReady: boolean;
  productCount: number;
  customerCount: number;
  supplierCount: number;
  billCount: number;
  /** Which trade this shop is. Only `kirana` is offered the built-in kirana catalog. */
  businessTypeKey?: string;
}

/**
 * A one-tap alternative to the step's normal "go and do it yourself" link.
 *
 * The step still links to the products screen; this is the shortcut for the one case
 * where the app already knows what the shop is about to type in by hand.
 */
export interface MerchantSetupQuickAction {
  id: "load-starter-catalog";
  label: string;
  hint: string;
}

export interface MerchantSetupStep {
  id: MerchantSetupStepId;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  required: boolean;
  complete: boolean;
  skipped: boolean;
  detail: string;
  confirmable?: boolean;
  skippable?: boolean;
  quickAction?: MerchantSetupQuickAction;
}

export interface MerchantSetupProgress {
  steps: MerchantSetupStep[];
  completedCount: number;
  totalCount: number;
  percent: number;
  requiredComplete: boolean;
  nextStep?: MerchantSetupStep;
}

export function createMerchantSetupState(): MerchantSetupState {
  return {
    version: 1,
    confirmed: {},
    skipped: {},
    updatedAt: new Date().toISOString(),
  };
}

export function normaliseMerchantSetupState(value: unknown): MerchantSetupState {
  if (!value || typeof value !== "object") return createMerchantSetupState();
  const raw = value as Partial<MerchantSetupState>;
  return {
    version: 1,
    confirmed: raw.confirmed && typeof raw.confirmed === "object" ? raw.confirmed : {},
    skipped: raw.skipped && typeof raw.skipped === "object" ? raw.skipped : {},
    lastStepId: raw.lastStepId,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Offered to a kirana shop that has no products yet, and to nobody else.
 *
 * A chemist or a garage would have to delete all 560 rows, so the offer would cost them
 * time rather than save it. A shop that already has products has already made its own
 * decisions about names and prices, and the catalog's starting prices are not better
 * information than the ones the shop typed in.
 */
function starterCatalogQuickAction(facts: MerchantSetupFacts): MerchantSetupQuickAction | undefined {
  if (facts.businessTypeKey !== "kirana" || facts.productCount !== 0) return undefined;
  return {
    id: "load-starter-catalog",
    label: `Load ${KIRANA_STARTER_CATALOG_COUNT} common kirana items`,
    hint: "You can delete what you don't sell.",
  };
}

export function buildMerchantSetupProgress(
  facts: MerchantSetupFacts,
  state: MerchantSetupState,
): MerchantSetupProgress {
  const confirmed = state.confirmed ?? {};
  const skipped = state.skipped ?? {};

  const steps: MerchantSetupStep[] = [
    {
      id: "store-profile",
      title: "Store profile",
      description: "Shop name, mobile number, city, and address used on bills and customer QR ordering.",
      href: "/settings/store-profile",
      actionLabel: "Open profile",
      required: true,
      complete: facts.storeProfileReady,
      skipped: false,
      detail: facts.storeProfileReady ? "Required business details are present" : "Add shop name, phone, and address",
    },
    {
      id: "taxes",
      title: "Tax and bill rules",
      description: "GST mode, invoice naming, round-off, and kacha/estimate bill behavior.",
      href: "/settings/taxes",
      actionLabel: "Open tax settings",
      required: true,
      confirmable: true,
      complete: Boolean(confirmed.taxes),
      skipped: false,
      detail: confirmed.taxes ? "Owner confirmed tax settings" : "Review once and mark ready",
    },
    {
      id: "billing",
      title: "Billing preferences",
      description: "Receipt defaults, payment modes, print preview, and owner approval rules.",
      href: "/settings/billing",
      actionLabel: "Open billing",
      required: true,
      confirmable: true,
      complete: Boolean(confirmed.billing),
      skipped: false,
      detail: confirmed.billing ? "Owner confirmed billing behavior" : "Review payment and bill defaults",
    },
    {
      id: "printer",
      title: "Printer setup",
      description: "Thermal receipt format, test print, and print-after-bill behavior.",
      href: "/settings/printer",
      actionLabel: "Open printer",
      required: true,
      confirmable: true,
      complete: Boolean(confirmed.printer),
      skipped: false,
      detail: confirmed.printer ? "Printer flow confirmed" : "Connect or confirm manual printing",
    },
    {
      id: "products",
      title: "Products and stock",
      description: "Import or add sellable products with price, unit, pack size, and stock.",
      href: "/products?import=1",
      actionLabel: "Import products",
      required: true,
      complete: facts.productCount > 0,
      skipped: false,
      detail: facts.productCount > 0 ? countLabel(facts.productCount, "product") : "No products added yet",
      quickAction: starterCatalogQuickAction(facts),
    },
    {
      id: "customers",
      title: "Customers and udhar",
      description: "Add frequent customers before using credit, reminders, and statements.",
      href: "/customers",
      actionLabel: "Open customers",
      required: false,
      skippable: true,
      complete: facts.customerCount > 0 || Boolean(skipped.customers),
      skipped: Boolean(skipped.customers),
      detail: facts.customerCount > 0 ? countLabel(facts.customerCount, "customer") : "Optional before first sale",
    },
    {
      id: "suppliers",
      title: "Suppliers and purchases",
      description: "Add main suppliers before tracking purchase dues and stock-in purchase history.",
      href: "/suppliers",
      actionLabel: "Open suppliers",
      required: false,
      skippable: true,
      complete: facts.supplierCount > 0 || Boolean(skipped.suppliers),
      skipped: Boolean(skipped.suppliers),
      detail: facts.supplierCount > 0 ? countLabel(facts.supplierCount, "supplier") : "Optional before first sale",
    },
    {
      id: "first-bill",
      title: "First test bill",
      description: "Create one real or test bill and confirm totals, stock, udhar, and receipt output.",
      href: "/billing",
      actionLabel: "Open billing",
      required: false,
      complete: facts.billCount > 0,
      skipped: false,
      detail: facts.billCount > 0 ? countLabel(facts.billCount, "bill") : "Run after products are ready",
    },
  ];

  const completedCount = steps.filter((step) => step.complete).length;
  const totalCount = steps.length;
  const requiredComplete = steps.filter((step) => step.required).every((step) => step.complete);
  const nextStep = steps.find((step) => step.required && !step.complete) ?? steps.find((step) => !step.complete);

  return {
    steps,
    completedCount,
    totalCount,
    percent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
    requiredComplete,
    nextStep,
  };
}
