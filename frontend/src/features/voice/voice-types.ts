export type SpeechRecognitionResultLike = {
  isFinal?: boolean;
  0?: { transcript?: string };
};

export type SpeechRecognitionEventLike = {
  resultIndex?: number;
  results: SpeechRecognitionResultLike[];
};

export type SpeechRecognitionErrorEventLike = {
  error?: string;
};

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export type ProductDraft = {
  mode?: "create" | "edit";
  name?: string;
  productName?: string;
  category?: string;
  unit?: string;
  barcode?: string;
  aliases?: string[];
  costPrice?: number;
  sellingPrice?: number;
  minimumSellingPrice?: number;
  retailPrice?: number;
  wholesalePrice?: number;
  retailFromQuantity?: number;
  wholesaleFromQuantity?: number;
  stockQuantity?: number;
  lowStockAlert?: number;
};

export type CustomerDraft = {
  mode?: "create" | "edit";
  name?: string;
  mobile?: string;
  address?: string;
  type?: "regular" | "udhar";
  udharLimit?: number;
  dueDate?: string;
  promiseToPayDate?: string;
  notes?: string;
};

export type InventoryDraft = {
  movementType?: "purchase" | "sale" | "damage" | "correction";
  productName?: string;
  quantity?: number;
  unit?: string;
  supplierName?: string;
  billAmount?: number;
  costPrice?: number;
  minPrice?: number;
  sellingPrice?: number;
  minMarginPercent?: number;
  sellingMarginPercent?: number;
  reason?: string;
};

export type PaymentDraft = {
  customerName?: string;
  mobile?: string;
  amount?: number;
  mode?: "cash" | "upi";
  note?: string;
};

export type VoiceSearchTarget = "product" | "customer" | "bill" | "udhar" | "global";

export type VoiceSearchIntent = {
  target: VoiceSearchTarget;
  query: string;
};

export type VoiceIntent = {
  action:
    | "navigate"
    | "billing_command"
    | "product_draft"
    | "customer_draft"
    | "inventory_draft"
    | "payment_draft"
    | "search"
    | "dashboard_summary"
    | "sync_count"
    | "noop";
  route?: string;
  billingCommand?: string;
  product?: ProductDraft;
  customer?: CustomerDraft;
  inventory?: InventoryDraft;
  payment?: PaymentDraft;
  search?: VoiceSearchIntent;
  message?: string;
  requiresConfirmation?: boolean;
  requiresOwnerPin?: boolean;
  auditable?: boolean;
};

export type VoiceRoute = {
  route: string;
  words: string[];
  label: string;
};

export type VoiceToastPayload = {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
};
