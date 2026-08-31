import { BillInputBillType, BillPaymentMode, type Product, type ProductSellingUnit } from "@/lib/api/client";
import type { SellableBatch } from "@/features/core/inventory/inventory-lots-api";

export interface CartItem {
  product: Product;
  quantity: number;
  rate: number;
  unit: string;
  sellingUnit?: ProductSellingUnit;
  isCustom?: boolean;
  manualRate?: boolean;
  /** Server-priced QR snapshot: keep different quotes/instructions apart. */
  guestSnapshot?: boolean;
  guestOrderId?: string;
  guestOrderLineId?: string;
  /** Flat rupee discount for this whole line (not per unit). */
  lineDiscount?: number;
  /** Free-text callout for this line ("no bag", weight callout) — printed on the receipt. */
  note?: string;
  /** Smart Adaptive Pricing — why this rate was chosen (for the cart chip). */
  pricing?: LinePricingMeta;
  /**
   * The batch this line dispenses from, when the operator picked one. Left unset
   * the till takes the nearest expiry (FEFO), which is the default and the right
   * answer almost always. Setting it fixes both the stock that leaves the shelf
   * and the MRP the line is capped at.
   */
  batch?: SellableBatch;
  /**
   * "Extra cheese", "no onion" — what the guest asked for on top of the dish.
   *
   * Kept on the line rather than folded into `rate` so the dish's own price stays
   * the price the MRP ceiling and the pricing engine reasoned about. The add-on
   * money is added at the boundary where a cart line becomes a bill line.
   */
  addons?: SelectedAddon[];
}

/** One chosen add-on, already priced, as the cart carries it. */
export interface SelectedAddon {
  optionId: string;
  groupName: string;
  name: string;
  /** Per unit of the dish. Two burgers with cheese are charged for two lots. */
  price: number;
  quantity?: number;
}

/**
 * What the add-ons add to ONE unit of the dish.
 *
 * Per unit, not per line: the caller multiplies by quantity exactly once, and
 * returning a per-line figure here is the shape that makes that easy to do twice.
 */
export function addonUnitPrice(addons?: SelectedAddon[]): number {
  if (!addons?.length) return 0;
  return addons.reduce((sum, addon) => {
    const price = Number(addon.price ?? 0);
    const quantity = Number(addon.quantity ?? 1);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return sum;
    return sum + price * quantity;
  }, 0);
}

/** Human-readable kitchen/receipt line, without changing the free-text note. */
export function addonSummary(addons?: SelectedAddon[]): string {
  if (!addons?.length) return "";
  return addons.map((addon) => `${addon.quantity && addon.quantity > 1 ? `${addon.quantity}× ` : ""}${addon.name}`).join(", ");
}

/**
 * A stable fingerprint of what was chosen, for the cart-line identity below.
 *
 * Sorted, because "cheese then jalapeño" and "jalapeño then cheese" are the same
 * burger and must land on one line rather than two the waiter has to explain.
 */
export function addonFingerprint(addons?: SelectedAddon[]): string {
  if (!addons?.length) return "plain";
  return addons
    .map((addon) => `${addon.optionId}x${addon.quantity ?? 1}`)
    .sort()
    .join(",");
}

/**
 * A product can be sold in more than one configured pack (for example 500 g
 * and 1 kg). Product id alone is therefore not a cart-line identity.
 *
 * Nor is product+pack: two batches of the same medicine can carry different
 * printed MRPs, so merging them onto one line would bill both at one rate under
 * one ceiling. A chosen batch is part of the line's identity.
 */
export function cartItemKey(item: CartItem): string {
  const unitKey = item.sellingUnit?.id ?? item.sellingUnit?.unitCode ?? item.unit ?? "default";
  const batchKey = item.batch?.id ?? "fefo";
  // Nor is product+pack+batch, once a dish can be ordered with extras: a burger
  // with cheese and one without cost different amounts and are cooked
  // differently, so merging them would bill both at one rate and send the
  // kitchen one ticket that cannot be made.
  const addonKey = addonFingerprint(item.addons);
  const isGuestLine = Boolean(item.guestSnapshot || item.guestOrderId || item.guestOrderLineId);
  const guestKey = isGuestLine ? `::guest:${JSON.stringify([item.guestOrderId, item.guestOrderLineId, item.rate, addonUnitPrice(item.addons), item.note ?? ""])}` : "";
  return `${item.product.id}::${unitKey}::${batchKey}::${addonKey}::${item.isCustom ? "custom" : "catalog"}${guestKey}`;
}

export interface LinePricingMeta {
  explanation: string;
  appliedRuleType: string;
  originalUnitPrice: number;
  requiresApproval: boolean;
  confidence: number;
  appliedRuleId?: string | null;
  calculationVersion?: string;
  minimumAllowedPrice?: number;
  maximumAllowedPrice?: number | null;
}

export const SPLIT_PAYMENT = "split" as const;
export type PaymentSelection = typeof BillPaymentMode[keyof typeof BillPaymentMode] | typeof SPLIT_PAYMENT;
export type BillTypeSelection = typeof BillInputBillType[keyof typeof BillInputBillType];
export type BillingSensitiveAction = "large_discount" | "selling_below_minimum_price" | "loyalty_redemption";

export interface AppliedOffer {
  id: string;
  code: string;
  discount: number;
  subtotal: number;
}

export interface BillingDraft {
  /** Stable id of the bill currently in the workspace (for the open-bills switcher). */
  activeBillId?: string;
  /**
   * The table this bill is the running tab for, when it is one.
   *
   * A table's tab is not a bill standing at the counter: it belongs to the floor
   * screen until somebody asks to settle it, so the open-bills strip leaves seated
   * tables out. Billing itself never interprets this — it only has to carry it
   * through parking, switching and restoring, because the floor screen reads it
   * back. It lives on the draft rather than only on HeldBill because the workspace
   * is rebuilt field by field on every save, which is where it used to be lost.
   */
  tableId?: string;
  /** When this bill was loaded from a customer QR order, its id — so finalizing marks it fulfilled. */
  sourceOrderId?: string;
  /** Canonical product/quantity signature of the online order imported into this draft. */
  sourceOrderFingerprint?: string;
  cart?: CartItem[];
  discount?: number;
  discountReason?: string;
  appliedOffer?: AppliedOffer | null;
  paymentMode?: PaymentSelection;
  billType?: BillTypeSelection;
  selectedCustomerId?: string;
  customerName?: string;
  customerMobile?: string;
  paidAmount?: number | "";
  splitCashAmount?: number | "";
  splitUpiAmount?: number | "";
  /** Optional UTR/reference for a manually confirmed payment to the shop's own UPI QR. */
  upiReference?: string;
  allowAdvancePayment?: boolean;
}

export interface HeldBill extends BillingDraft {
  id: string;
  label: string;
  createdAt: string;
}

export interface PrintableBill {
  billId?: string;
  billNo: string;
  createdAt: string;
  customerName: string;
  customerMobile?: string;
  buyerGstin?: string;
  buyerStateCode?: string;
  buyerAddress?: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  /** Signed nearest-rupee adjustment (payable − raw); 0 when round-off is off. */
  roundOff?: number;
  total: number;
  paid: number;
  credit: number;
  /** Customer ledger balance immediately before this bill. */
  previousUdhar?: number;
  paymentMode: PaymentSelection;
  billType: BillTypeSelection;
  payments?: Array<{ mode: string; amount: number; label?: string | null }>;
  shop?: {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
    gstNumber?: string | null;
    cashierName?: string | null;
  };
  copyLabel?: string;
}

export interface VoiceParsedLine {
  product: Product;
  quantity: number;
  unit: string;
  rate: number;
  source: string;
}

/**
 * An item the counter named that the catalogue has never heard of.
 *
 * A shop sells things before it lists them — a new biscuit, a one-off carton — and the
 * bill is the moment that shows up. The command carried a price ("parle biscuit forty
 * rupees"), which is the whole of what billing needs, so the item is offered as a product
 * to create rather than dropped with "no saved product matched". Everything else about
 * it (cost, pack size, HSN) is filled in later, away from the queue.
 */
export interface VoiceNewProductLine {
  /** Spoken name, with the quantity and price words taken out. */
  name: string;
  sellingPrice: number;
  quantity: number;
  unit: string;
  source: string;
}

export interface VoiceParsedDraft {
  customerName?: string;
  udharAmount?: number;
  paymentMode?: PaymentSelection;
  billType?: BillTypeSelection;
  paidAmount?: number;
  cashAmount?: number;
  upiAmount?: number;
  lines: VoiceParsedLine[];
  /** Unlisted items the command priced; empty unless the shop asked to add one. */
  newProducts: VoiceNewProductLine[];
  warnings: string[];
  sourceCommand: string;
  fingerprint: string;
  requiresConfirmation: true;
}

export type SpeechRecognitionResultLike = {
  0?: { transcript?: string };
  isFinal?: boolean;
};

export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop?: () => void;
  abort?: () => void;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex?: number; results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export const UNIT_OPTIONS = [
  "piece", "dozen", "set", "pair", "bundle", "roll", "sheet",
  "kg", "gram", "g", "litre", "ml",
  "meter", "yard",
  "packet", "box",
  "strip", "tablet", "bottle", "tube",
  "plate", "glass",
  "custom",
] as const;
