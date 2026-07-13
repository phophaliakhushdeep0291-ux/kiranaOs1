import { BillInputBillType, BillPaymentMode, type Product, type ProductSellingUnit } from "@/lib/api/client";

export interface CartItem {
  product: Product;
  quantity: number;
  rate: number;
  unit: string;
  sellingUnit?: ProductSellingUnit;
  isCustom?: boolean;
  manualRate?: boolean;
  /** Smart Adaptive Pricing — why this rate was chosen (for the cart chip). */
  pricing?: LinePricingMeta;
}

/**
 * A product can be sold in more than one configured pack (for example 500 g
 * and 1 kg). Product id alone is therefore not a cart-line identity.
 */
export function cartItemKey(item: CartItem): string {
  const unitKey = item.sellingUnit?.id ?? item.sellingUnit?.unitCode ?? item.unit ?? "default";
  return `${item.product.id}::${unitKey}::${item.isCustom ? "custom" : "catalog"}`;
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

export interface BillingDraft {
  /** Stable id of the bill currently in the workspace (for the open-bills switcher). */
  activeBillId?: string;
  /** When this bill was loaded from a customer QR order, its id — so finalizing marks it fulfilled. */
  sourceOrderId?: string;
  cart?: CartItem[];
  discount?: number;
  paymentMode?: PaymentSelection;
  billType?: BillTypeSelection;
  selectedCustomerId?: string;
  customerName?: string;
  customerMobile?: string;
  paidAmount?: number | "";
  splitCashAmount?: number | "";
  splitUpiAmount?: number | "";
  allowAdvancePayment?: boolean;
}

export interface HeldBill extends BillingDraft {
  id: string;
  label: string;
  createdAt: string;
}

export interface PrintableBill {
  billNo: string;
  createdAt: string;
  customerName: string;
  customerMobile?: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  credit: number;
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

export interface VoiceParsedDraft {
  customerName?: string;
  udharAmount?: number;
  paymentMode?: PaymentSelection;
  billType?: BillTypeSelection;
  paidAmount?: number;
  cashAmount?: number;
  upiAmount?: number;
  lines: VoiceParsedLine[];
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
