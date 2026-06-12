import type { Customer } from "@/types/api";

export type LedgerEntryType = "BILL" | "PAYMENT" | "ADJUSTMENT" | "REFUND" | "CORRECTION" | "CANCELLED_BILL";

export interface CustomerLedgerEntry extends Record<string, unknown> {
  id: string;
  customerId?: string | null;
  customer_id?: string | null;
  type: LedgerEntryType | string;
  amount: number;
  balance_after?: number;
  note?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  billId?: string | null;
  bill_id?: string | null;
  paymentId?: string | null;
  payment_id?: string | null;
  entry_at?: string;
  createdAt?: string;
  created_at?: string;
  reversed_at?: string | null;
  deleted_at?: string | null;
  deletedAt?: string | null;
  sync_status?: string;
}

export interface LedgerStatementRow extends CustomerLedgerEntry {
  signed_amount: number;
  running_balance: number;
  display_type: LedgerEntryType;
  display_date: string;
}

export interface UdharAgeingBuckets {
  zeroToSeven: number;
  sevenToThirty: number;
  thirtyPlus: number;
  total: number;
}

export interface LedgerMetrics {
  balance: number;
  ageing: UdharAgeingBuckets;
  lastPaymentAt?: string;
  lastBillAt?: string;
  paymentCount: number;
  billCount: number;
  trustScore: number;
  isBadCustomer: boolean;
  warning: string | null;
}

function readNumber(value: unknown, fallback = 0): number {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getLedgerCustomerId(entry: Partial<CustomerLedgerEntry>): string | null {
  const id = entry.customerId ?? entry.customer_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function getLedgerDate(entry: Partial<CustomerLedgerEntry>): string {
  const raw = entry.entry_at ?? entry.createdAt ?? entry.created_at;
  return typeof raw === "string" && raw.length > 0 ? raw : new Date(0).toISOString();
}

export function normaliseLedgerType(type: unknown, sourceType?: unknown): LedgerEntryType {
  const raw = String(type ?? "").trim().toUpperCase();
  const source = String(sourceType ?? "").trim().toUpperCase();
  if (raw === "CANCELLED_BILL" || raw === "BILL_CANCEL_CORRECTION") return "CANCELLED_BILL";
  if (raw === "CORRECTION" || raw === "PAYMENT_REVERSAL") return "CORRECTION";
  // Backend stores udhar bill entries as `debit` because debt is debited to the customer.
  // For our local statement sign rules, debit/credit bill debt must increase udhar.
  if (raw === "BILL" || raw === "CREDIT" || raw === "DEBIT" || source === "BILL") return "BILL";
  if (raw === "PAYMENT" || source === "PAYMENT") return "PAYMENT";
  if (raw === "ADJUSTMENT" || raw === "MANUAL_ADJUSTMENT") return "ADJUSTMENT";
  if (raw === "REFUND") return "REFUND";
  return "ADJUSTMENT";
}

export function ledgerSignedAmount(entry: Partial<CustomerLedgerEntry>): number {
  const amount = Math.abs(readNumber(entry.amount, 0));
  const rawAmount = readNumber(entry.amount, 0);
  const type = normaliseLedgerType(entry.type, entry.source_type);
  if (type === "BILL") return amount;
  if (type === "PAYMENT") return -amount;
  if (type === "CANCELLED_BILL") return -amount;
  if (type === "REFUND") return amount;
  if (type === "CORRECTION" || type === "ADJUSTMENT") return rawAmount;
  return rawAmount;
}


function getStringField(row: Partial<CustomerLedgerEntry>, keys: string[]): string | null {
  const record = row as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function ledgerBusinessKey(entry: Partial<CustomerLedgerEntry>): string {
  const sourceType = String(entry.source_type ?? "").trim().toLowerCase();
  const type = normaliseLedgerType(entry.type, entry.source_type);
  const sourceId = getStringField(entry, [
    "source_id",
    "sourceId",
    "bill_id",
    "billId",
    "payment_id",
    "paymentId",
    "local_bill_id",
    "localBillId",
  ]);
  const customerId = getLedgerCustomerId(entry) ?? "";
  const amount = Math.abs(readNumber(entry.amount, 0)).toFixed(2);
  if (sourceId) return [type, sourceType, sourceId, customerId, amount].join("|");
  const explicitId = getStringField(entry, [
    "ledger_unique_id",
    "ledgerUniqueId",
    "clientLedgerId",
    "client_ledger_id",
    "localLedgerId",
    "local_ledger_id",
    "localLedgerEntryId",
    "local_ledger_entry_id",
    "server_id",
    "serverId",
    "id",
  ]);
  if (explicitId) return `id|${explicitId}`;
  return [type, sourceType, customerId, amount, getLedgerDate(entry).slice(0, 19)].join("|");
}

function ledgerSyncPriority(entry: Partial<CustomerLedgerEntry>): number {
  const record = entry as Record<string, unknown>;
  if (entry.deleted_at != null || entry.deletedAt != null) return -100;
  const status = String(entry.sync_status ?? "").toLowerCase();
  let priority = 0;
  if (status === "synced") priority += 20;
  if (status === "failed" || status === "conflict") priority += 8;
  if (typeof record.server_id === "string" || typeof record.serverId === "string") priority += 15;
  const id = String(record.id ?? "");
  if (id && !id.startsWith("ledger_") && !id.startsWith("local_") && !id.includes("pending")) priority += 5;
  if (typeof record.merged_into_id === "string" || typeof record.mergedIntoId === "string") priority -= 25;
  return priority;
}

const LOCAL_LEDGER_ID_PREFIXES = ["ledger_", "local_", "bill_", "payment_", "tmp_", "temp_"];

function isLocalLikeId(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const normalized = value.toLowerCase();
  return LOCAL_LEDGER_ID_PREFIXES.some((prefix) => normalized.startsWith(prefix)) || normalized.includes("pending");
}

function isBillLedger(entry: Partial<CustomerLedgerEntry>): boolean {
  return normaliseLedgerType(entry.type, entry.source_type) === "BILL";
}

function isPaymentLedger(entry: Partial<CustomerLedgerEntry>): boolean {
  return normaliseLedgerType(entry.type, entry.source_type) === "PAYMENT";
}

function isEchoDedupableLedger(entry: Partial<CustomerLedgerEntry>): boolean {
  return isBillLedger(entry) || isPaymentLedger(entry);
}

function isLocalPendingLedgerEcho(entry: Partial<CustomerLedgerEntry>): boolean {
  const record = entry as Record<string, unknown>;
  const status = String(entry.sync_status ?? record.status ?? "").toLowerCase();
  if (["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(status)) return true;
  if (isLocalLikeId(record.id) || isLocalLikeId(record.local_id) || isLocalLikeId(record.localId)) return true;
  if (isLocalLikeId(record.source_id) || isLocalLikeId(record.sourceId) || isLocalLikeId(record.bill_id) || isLocalLikeId(record.billId)) return true;
  const note = String(entry.note ?? "").toLowerCase();
  return note.includes("pending-") || note.includes("pending_");
}

function isServerLedgerEcho(entry: Partial<CustomerLedgerEntry>): boolean {
  const record = entry as Record<string, unknown>;
  const status = String(entry.sync_status ?? record.status ?? "").toLowerCase();
  if (status === "synced") return true;
  if (typeof record.server_id === "string" || typeof record.serverId === "string") return true;
  const id = String(record.id ?? "");
  return id.length > 0 && !isLocalLikeId(id);
}

function ledgerEchoTimeBucket(entry: Partial<CustomerLedgerEntry>): string {
  const time = new Date(getLedgerDate(entry)).getTime();
  if (!Number.isFinite(time)) return getLedgerDate(entry).slice(0, 16);
  const type = normaliseLedgerType(entry.type, entry.source_type);
  // Bills and udhar payments can briefly exist twice: once as the local pending
  // row and once as the server row returned by push/pull. A 15-minute bucket is
  // intentionally only used as an echo detector and is collapsed only when one
  // row is local/pending and the other has server proof. Two normal server rows
  // with the same amount are still kept.
  const bucketMs = type === "PAYMENT" ? 15 * 60 * 1000 : 15 * 60 * 1000;
  return String(Math.floor(time / bucketMs));
}

function ledgerEchoSignature(entry: Partial<CustomerLedgerEntry>): string | null {
  if (!isEchoDedupableLedger(entry)) return null;
  const customerId = getLedgerCustomerId(entry);
  if (!customerId) return null;
  const amount = Math.abs(readNumber(entry.amount, 0));
  if (amount <= 0) return null;
  const type = normaliseLedgerType(entry.type, entry.source_type).toLowerCase();
  return [type, customerId, amount.toFixed(2), ledgerEchoTimeBucket(entry)].join("|");
}

function shouldCollapseLedgerEcho(previous: Partial<CustomerLedgerEntry>, current: Partial<CustomerLedgerEntry>): boolean {
  const previousType = normaliseLedgerType(previous.type, previous.source_type);
  const currentType = normaliseLedgerType(current.type, current.source_type);
  if (previousType !== currentType) return false;
  if (!isEchoDedupableLedger(previous) || !isEchoDedupableLedger(current)) return false;
  const oneLocal = isLocalPendingLedgerEcho(previous) || isLocalPendingLedgerEcho(current);
  const oneServer = isServerLedgerEcho(previous) || isServerLedgerEcho(current);
  return oneLocal && oneServer;
}

export function dedupeLedgerEntries<T extends CustomerLedgerEntry>(entries: T[]): T[] {
  const pickedByBusinessKey = new Map<string, T>();
  const pickedByEchoSignature = new Map<string, T>();
  const sorted = entries
    .filter((row) => row.deleted_at == null && row.deletedAt == null)
    .sort((a, b) => ledgerSyncPriority(b) - ledgerSyncPriority(a));

  for (const entry of sorted) {
    const businessKey = ledgerBusinessKey(entry);
    const previousByBusinessKey = pickedByBusinessKey.get(businessKey);
    if (previousByBusinessKey && ledgerSyncPriority(previousByBusinessKey) >= ledgerSyncPriority(entry)) continue;

    const echoSignature = ledgerEchoSignature(entry);
    const previousByEcho = echoSignature ? pickedByEchoSignature.get(echoSignature) : undefined;
    if (previousByEcho && shouldCollapseLedgerEcho(previousByEcho, entry)) continue;

    pickedByBusinessKey.set(businessKey, entry);
    if (echoSignature) pickedByEchoSignature.set(echoSignature, entry);
  }

  return Array.from(pickedByBusinessKey.values());
}

export function sortLedgerEntries<T extends Partial<CustomerLedgerEntry>>(entries: T[]): T[] {
  return [...entries].sort((a, b) => getLedgerDate(a).localeCompare(getLedgerDate(b)) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

export function calculateLedgerBalance(entries: Partial<CustomerLedgerEntry>[]): number {
  return roundMoney(sortLedgerEntries(entries).reduce((sum, entry) => sum + ledgerSignedAmount(entry), 0));
}

export function buildLedgerStatement(entries: CustomerLedgerEntry[]): LedgerStatementRow[] {
  let running = 0;
  return sortLedgerEntries(entries).map((entry) => {
    const signed = ledgerSignedAmount(entry);
    running = roundMoney(running + signed);
    const displayedRunning = Math.max(0, running);
    return {
      ...entry,
      signed_amount: signed,
      running_balance: displayedRunning,
      balance_after: displayedRunning,
      display_type: normaliseLedgerType(entry.type, entry.source_type),
      display_date: getLedgerDate(entry),
    };
  }).reverse();
}

interface DebtBucket {
  date: string;
  remaining: number;
}

export function calculateUdharAgeing(entries: CustomerLedgerEntry[], now = new Date()): UdharAgeingBuckets {
  const debts: DebtBucket[] = [];
  let creditPool = 0;
  for (const entry of sortLedgerEntries(entries)) {
    const signed = ledgerSignedAmount(entry);
    if (signed > 0) debts.push({ date: getLedgerDate(entry), remaining: signed });
    if (signed < 0) creditPool += Math.abs(signed);
    while (creditPool > 0 && debts.length > 0) {
      const first = debts[0];
      const applied = Math.min(first.remaining, creditPool);
      first.remaining = roundMoney(first.remaining - applied);
      creditPool = roundMoney(creditPool - applied);
      if (first.remaining <= 0.009) debts.shift();
    }
  }

  const buckets: UdharAgeingBuckets = { zeroToSeven: 0, sevenToThirty: 0, thirtyPlus: 0, total: 0 };
  for (const debt of debts) {
    const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(debt.date).getTime()) / 86_400_000));
    if (ageDays <= 7) buckets.zeroToSeven += debt.remaining;
    else if (ageDays <= 30) buckets.sevenToThirty += debt.remaining;
    else buckets.thirtyPlus += debt.remaining;
  }
  buckets.zeroToSeven = roundMoney(buckets.zeroToSeven);
  buckets.sevenToThirty = roundMoney(buckets.sevenToThirty);
  buckets.thirtyPlus = roundMoney(buckets.thirtyPlus);
  buckets.total = roundMoney(buckets.zeroToSeven + buckets.sevenToThirty + buckets.thirtyPlus);
  return buckets;
}

export function calculateTrustScore(customer: Partial<Customer>, entries: CustomerLedgerEntry[]): LedgerMetrics {
  // Outstanding udhar is debt, so the user-facing balance must not become
  // negative if a stale/duplicate payment row exists locally before the matching
  // bill/debit row arrives from sync.
  const balance = Math.max(0, calculateLedgerBalance(entries));
  const ageing = calculateUdharAgeing(entries);
  const sorted = sortLedgerEntries(entries);
  const payments = sorted.filter((entry) => normaliseLedgerType(entry.type, entry.source_type) === "PAYMENT");
  const bills = sorted.filter((entry) => normaliseLedgerType(entry.type, entry.source_type) === "BILL");
  const limit = readNumber((customer as Record<string, unknown>).udharLimit, 0);
  let score = 80;
  if (balance <= 0) score += 10;
  if (balance > 0) score -= Math.min(25, Math.floor(balance / 1000) * 2);
  if (limit > 0 && balance > limit) score -= 25;
  if (ageing.thirtyPlus > 0) score -= 25;
  if (ageing.sevenToThirty > 0) score -= 8;
  if (payments.length >= 3) score += 5;
  const trustScore = Math.max(0, Math.min(100, score));
  const isBadCustomer = trustScore < 45 || ageing.thirtyPlus > 0 || (limit > 0 && balance > limit);
  const warning = isBadCustomer
    ? ageing.thirtyPlus > 0
      ? "30+ days udhar pending. Take payment before more credit."
      : limit > 0 && balance > limit
        ? "Udhar limit crossed. Owner approval recommended."
        : "Low trust score. Be careful with new udhar."
    : null;
  return {
    balance,
    ageing,
    lastPaymentAt: payments.length ? getLedgerDate(payments[payments.length - 1]) : undefined,
    lastBillAt: bills.length ? getLedgerDate(bills[bills.length - 1]) : undefined,
    paymentCount: payments.length,
    billCount: bills.length,
    trustScore,
    isBadCustomer,
    warning,
  };
}

export function ledgerEntryLabel(type: LedgerEntryType): string {
  if (type === "BILL") return "Bill added";
  if (type === "PAYMENT") return "Payment received";
  if (type === "ADJUSTMENT") return "Manual adjustment";
  if (type === "REFUND") return "Refund";
  if (type === "CORRECTION") return "Correction";
  if (type === "CANCELLED_BILL") return "Cancelled bill correction";
  return "Ledger entry";
}
