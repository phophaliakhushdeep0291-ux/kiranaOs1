import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Mail, MessageCircle, Pencil, Plus, Printer, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import { buildPrintableBillSnapshot, openPrintableBill } from "@/features/core/bills/print";
import { cancelBillWithOwnerPinLocalFirst, restoreBillWithOwnerPinLocalFirst, softDeleteBillWithOwnerPinLocalFirst } from "@/features/core/bills/local-actions";
import { EditBillDialog } from "@/features/core/bills/components/EditBillDialog";
import { ReturnDialog, type ReturnLineInput } from "@/features/core/returns/components/ReturnDialog";
import type { Bill, Customer } from "@/types/api";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { usePermission } from "@/features/core/staff/permissions";
import { calculateLedgerBalance, dedupeLedgerEntries, type CustomerLedgerEntry } from "@/features/core/ledger/accounting";
import { dedupeBillItemsForDisplay, dedupeBillsForDisplay, dedupePaymentsForDisplay } from "@/features/core/sync/bill-reconciliation";
import { useAuth } from "@/features/core/auth/useAuth";
import { billRecordToShareInput, resolveBillCustomerMobile, shareBillOnWhatsapp } from "@/features/core/bills/share";
import { LoadingSkeleton } from "@/components/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api/http";
import { ACTIVITY_EVENTS, trackEvent } from "@/lib/activity";
import { getPrinterConfigSync } from "@/features/core/settings/printer-config";
import { deliverBillWhatsapp, type BillWhatsappState } from "@/features/core/bills/whatsapp-delivery";
import { billItemAddons } from "@/features/core/bills/bill-item-options";

interface BillRecord extends Bill, Record<string, unknown> {}
type AnyRow = Record<string, unknown>;
type PinAction = "cancel" | "delete" | "restore";

function asIdSet(bill: BillRecord) {
  return new Set([
    bill.id,
    bill.local_id,
    bill.localId,
    bill.server_id,
    bill.serverId,
    bill.billNo,
    bill.billNumber,
    bill.localBillId,
    bill.local_bill_id,
    bill.clientBillId,
    bill.client_bill_id,
    bill.serverBillId,
    bill.server_bill_id,
  ].filter((value): value is string => typeof value === "string" && value.length > 0));
}

function readNumber(value: unknown, fallback = 0) {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

function money(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function billNo(bill: BillRecord) {
  return String(bill.billNumber ?? bill.billNo ?? bill.id);
}

function billDate(bill: BillRecord) {
  return String(bill.businessDate ?? bill.business_date ?? bill.createdAt ?? bill.created_at ?? "");
}

function billTotal(bill: BillRecord) {
  return readNumber(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount, 0);
}

function isDeleted(bill: BillRecord) {
  return typeof bill.deleted_at === "string" || typeof bill.deletedAt === "string";
}

function rowDate(row: AnyRow) {
  return String(row.createdAt ?? row.created_at ?? row.entry_at ?? row.paid_at ?? "");
}

function itemTotal(row: AnyRow) {
  const quantity = readNumber(row.quantity, 0);
  const rate = readNumber(row.ratePerRateUnit ?? row.rate_per_rate_unit ?? row.rate, 0);
  return readNumber(row.line_total, quantity * rate);
}

function paymentStatus(bill: BillRecord, payments: AnyRow[]) {
  if (bill.status === "cancelled") return "Cancelled";
  if (bill.billType === "estimate") return "Rough/Estimate";
  const paidFromRows = payments.reduce((sum, row) => String(row.mode ?? "") === "credit" ? sum : sum + readNumber(row.amount, 0), 0);
  const paid = Math.max(readNumber(bill.paidAmount ?? bill.buyerPaidAmount, 0), paidFromRows);
  const credit = readNumber(bill.creditAmount, Math.max(0, billTotal(bill) - paid));
  if (credit > 0 && paid > 0) return "Partial";
  if (credit > 0) return "Udhar";
  if (paid >= billTotal(bill) && billTotal(bill) > 0) return "Paid";
  return "Pending";
}

async function loadBillDetail(id: string) {
  const bills = await offlineDB.getAll<BillRecord>("bills").catch(() => []);
  const cached = readInstantCache<BillRecord[]>("bills", []);
  const allBills = dedupeBillsForDisplay([...cached, ...bills]) as BillRecord[];
  const bill = allBills.find((row) => row.id === id || row.local_id === id || row.server_id === id || row.billNo === id || row.billNumber === id);
  if (!bill) return null;
  const ids = asIdSet(bill);
  const itemExpectedTotal = readNumber(bill.subtotal ?? bill.subtotalAmount ?? bill.subtotal_amount, billTotal(bill) + readNumber(bill.discount, 0));
  const items = dedupeBillItemsForDisplay(
    (await offlineDB.getAll<AnyRow>("bill_items").catch(() => []))
      .filter((row) => ids.has(String(row.bill_id ?? row.billId ?? ""))),
    itemExpectedTotal,
  );
  const payments = dedupePaymentsForDisplay((await offlineDB.getAll<AnyRow>("payments").catch(() => []))
    .filter((row) => ids.has(String(row.bill_id ?? row.billId ?? row.localBillId ?? row.local_bill_id ?? ""))));
  const allLedger = await offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []);
  const ledger = dedupeLedgerEntries(allLedger
    .filter((row) => ids.has(String(row.bill_id ?? row.billId ?? row.localBillId ?? row.local_bill_id ?? row.source_id ?? row.sourceId ?? ""))));
  const audit = (await offlineDB.getAll<AnyRow>("local_audit_logs").catch(() => []))
    .filter((row) => ids.has(String(row.entity_id ?? row.bill_id ?? "")) || String(row.summary ?? "").includes(billNo(bill)));
  const customers = await offlineDB.getAll<Customer & AnyRow>("customers").catch(() => []);
  const customer = customers.find((row) => row.id === bill.customerId || row.local_id === bill.customerId || row.server_id === bill.customerId) ?? null;
  const customerIds = new Set([customer?.id, customer?.local_id, customer?.localId, customer?.server_id, customer?.serverId, bill.customerId, bill.customer_id].filter((value): value is string => typeof value === "string" && value.length > 0));
  const customerLedger = dedupeLedgerEntries(allLedger.filter((row) => {
    const customerId = row.customerId ?? row.customer_id;
    return typeof customerId === "string" && customerIds.has(customerId);
  }));
  const customerLedgerBalance = Math.max(0, calculateLedgerBalance(customerLedger));
  return { bill, items, payments, ledger, audit, customer, customerLedgerBalance };
}

function useBillDetail(id: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["bill-detail", id] });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [id, queryClient]);
  return useQuery({ queryKey: ["bill-detail", id], queryFn: () => loadBillDetail(id), enabled: id.length > 0, staleTime: 2_000 });
}

export default function BillDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const { toast } = useToast();
  const cancelPermission = usePermission("cancel_bill");
  const { data, isLoading, refetch } = useBillDetail(id);
  const { shop } = useAuth();
  const [pinAction, setPinAction] = useState<PinAction | null>(null);
  const [editMode, setEditMode] = useState<"edit" | "addon" | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [whatsappState, setWhatsappState] = useState<BillWhatsappState>("not_sent");

  const bill = data?.bill;
  const embeddedItems = useMemo(() => Array.isArray(bill?.items) ? bill.items as AnyRow[] : [], [bill]);
  const visibleItems = data?.items && data.items.length > 0 ? data.items : embeddedItems;
  const visiblePayments = data?.payments ?? [];
  const total = bill ? billTotal(bill) : 0;
  const paidFromRows = visiblePayments.reduce((sum, row) => String(row.mode ?? "") === "credit" ? sum : sum + readNumber(row.amount, 0), 0);
  const explicitCredit = readNumber(bill?.creditAmount, Number.NaN);
  const billLevelPaid = Number.isFinite(explicitCredit)
    ? Math.max(0, total - explicitCredit)
    : readNumber(bill?.paidAmount ?? bill?.buyerPaidAmount, 0);
  const paid = visiblePayments.length > 0 ? paidFromRows : billLevelPaid;
  const credit = Math.max(0, readNumber(bill?.creditAmount, total - paid));

  const billTypeStr = String(bill?.billType ?? "normal_sale");
  const isCancelled = String(bill?.status ?? "").toLowerCase() === "cancelled";
  const canReturn = Boolean(bill) && bill?.status !== "cancelled" && billTypeStr !== "sales_return";
  const returnLines: ReturnLineInput[] = useMemo(() => visibleItems.map((item) => ({
    billItemId: String(item.id ?? "") || undefined,
    productId: (item.productId ?? item.product_id) as string | undefined,
    sellingUnitId: String(item.sellingUnitId ?? item.selling_unit_id ?? "") || undefined,
    sellingUnitCode: String(item.sellingUnitCode ?? item.selling_unit_code ?? "") || undefined,
    sellingUnitLabel: String(item.sellingUnitLabel ?? item.selling_unit_label ?? "") || undefined,
    conversionToBase: readNumber(item.conversionToBase ?? item.conversion_to_base, 0) || undefined,
    name: String(item.name ?? item.productName ?? "Item"),
    soldQty: Math.abs(readNumber(item.quantity, 0)),
    enteredUnit: String(item.enteredUnit ?? item.entered_unit ?? "piece"),
    ratePerRateUnit: readNumber(item.ratePerRateUnit ?? item.rate_per_rate_unit ?? item.rate, 0),
    costPerRateUnit: readNumber(item.costPerRateUnit ?? item.cost_per_rate_unit, 0) || undefined,
    originalUnitPrice: readNumber(item.originalUnitPrice ?? item.original_unit_price, 0) || undefined,
    gstRate: readNumber(item.gstRate ?? item.gst_rate, 0),
    hsn: String(item.hsn ?? "") || undefined,
    lineDiscount: readNumber(item.lineDiscount ?? item.line_discount, 0),
    soldLineTotal: Math.abs(readNumber(item.lineTotal ?? item.line_total, 0)),
  })), [visibleItems]);

  function printBill() {
    if (!bill) return;
    const ok = openPrintableBill(buildPrintableBillSnapshot(bill, visibleItems, visiblePayments, {
      name: shop?.name, address: shop?.address, city: shop?.city, phone: shop?.phone, gstNumber: shop?.gstNumber,
    }));
    if (!ok) toast({ title: "Print blocked", description: "Allow pop-ups to print or save PDF.", variant: "destructive" });
  }

  async function shareOnWhatsapp() {
    if (!bill) return;
    const customerMobile = await resolveBillCustomerMobile(bill as AnyRow);
    const shareInput = billRecordToShareInput(bill as AnyRow, {
      items: visibleItems,
      payments: visiblePayments,
      shopName: shop?.name,
      shopLocation: [shop?.city, shop?.address].filter(Boolean)[0] as string | undefined,
      total,
      paid,
      credit,
      customerMobile,
      previousUdhar: Math.max(0, data.customerLedgerBalance - credit),
      gst: readNumber((bill as AnyRow).gst, 0),
      showPreviousUdhar: getPrinterConfigSync().showPreviousUdhar,
      showGst: getPrinterConfigSync().showGstBreakup,
    });
    const serverId = String((bill as AnyRow).server_id ?? (bill as AnyRow).serverId ?? bill.id);
    const printer = getPrinterConfigSync();
    const result = await deliverBillWhatsapp({ billId: serverId, idempotencyKey: crypto.randomUUID(), input: shareInput, showGst: printer.showGstBreakup, showPreviousUdhar: printer.showPreviousUdhar });
    setWhatsappState(result.state);
    const targetedCustomer = Boolean(shareInput.customerMobile);
    toast({
      title: "Opening WhatsApp…",
      description: result.queued ? "Queued until this device reconnects." : result.state === "sent_via_api" ? "Sent via the configured provider." : targetedCustomer ? "Opened for the customer's number." : "Pick a chat to send this bill.",
    });
  }

  function requestPinAction(action: PinAction) {
    if (action === "cancel" && !cancelPermission.allowed) {
      toast({ title: "Permission denied", description: cancelPermission.reason, variant: "destructive" });
      return;
    }
    setPinAction(action);
  }

  // Editing voids the original (cancelBill), so it needs the same permission as cancel.
  function startEdit() {
    if (!cancelPermission.allowed) {
      toast({ title: "Permission denied", description: cancelPermission.reason, variant: "destructive" });
      return;
    }
    setEditMode("edit");
  }

  async function runPinAction(ownerPin: string, reason: string) {
    if (!bill || !pinAction) return;
    setIsSaving(true);
    try {
      if (pinAction === "cancel") await cancelBillWithOwnerPinLocalFirst(bill.id, ownerPin, reason);
      if (pinAction === "delete") await softDeleteBillWithOwnerPinLocalFirst(bill.id, ownerPin, reason);
      if (pinAction === "restore") await restoreBillWithOwnerPinLocalFirst(bill.id, ownerPin, reason);
      if (pinAction === "cancel" || pinAction === "delete") {
        // The reason is an owner-typed free-text field, so it is recorded as the
        // shape of the cancellation ("which bills get cancelled, and why") — the
        // text itself is redacted server-side like every other typed field.
        trackEvent(ACTIVITY_EVENTS.BILL_CANCELLED, {
          billId: bill.id,
          action: pinAction,
          reason,
          productIds: visibleItems.map((item) => item.productId).filter(Boolean),
        });
      }
      toast({ title: "Saved locally", description: "Data safe locally. Cloud backup will happen automatically when sync is available." });
      setPinAction(null);
      await refetch();
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : "Please check owner PIN and try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <LoadingSkeleton variant="detail" rows={4} className="mx-auto max-w-5xl p-5" />;
  }

  async function sendEmailReceipt() {
    if (!bill || !receiptEmail.trim()) return;
    setEmailSending(true);
    setEmailError("");
    try {
      const serverId = String(bill.server_id ?? bill.serverId ?? bill.id);
      await apiRequest(`/bills/${encodeURIComponent(serverId)}/email`, { method: "POST", body: JSON.stringify({ email: receiptEmail.trim() }) });
      setEmailOpen(false);
      toast({ title: "Receipt emailed", description: `Delivery was accepted for ${receiptEmail.trim()}.` });
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "Could not email this receipt.");
    } finally {
      setEmailSending(false);
    }
  }

  if (!bill) {
    return (
      <div className="p-6 space-y-4">
        <Link href="/bills"><Button variant="outline"><ArrowLeft size={15} className="mr-1" />Back to bills</Button></Link>
        <Card><CardContent className="py-10 text-center text-muted-foreground">Bill not found in local records.</CardContent></Card>
      </div>
    );
  }

  const explicitServerId = String(bill.server_id ?? bill.serverId ?? "").trim();
  const syncState = String(bill.sync_status ?? "").toLowerCase();
  const cloudRecordId = explicitServerId || (syncState === "synced" ? bill.id : "");
  const localRecordId = String(bill.local_id ?? bill.localId ?? "").trim();
  const cancellationReason = String(bill.cancelledReason ?? bill.cancelReason ?? "Owner-authorized cancellation");

  return (
    <div className="space-y-4 p-4 pb-28 md:space-y-5 md:p-6 md:pb-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <Link href="/bills"><Button variant="outline" size="sm"><ArrowLeft size={15} className="mr-1" />Back</Button></Link>
          <div>
            <h1 className="text-2xl font-bold">{billNo(bill)}</h1>
            <p className="text-sm text-muted-foreground">Duplicate copy, audit trail, ledger impact, and sync status.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button className="h-11 w-full sm:w-auto" onClick={() => void shareOnWhatsapp()}><MessageCircle size={15} className="mr-1" />WhatsApp</Button>
          <Button className="h-11 w-full sm:w-auto" variant="outline" onClick={printBill}><Printer size={15} className="mr-1" />Print duplicate</Button>
          <span className="self-center text-xs text-muted-foreground">{whatsappState === "sent_via_api" ? "Sent via API" : whatsappState === "opened_share_sheet" ? "Opened in WhatsApp" : whatsappState === "failed" ? "Delivery failed" : "Not sent"}</span>
          <Button className="h-11 w-full sm:w-auto" variant="outline" onClick={() => { setEmailError(""); setEmailOpen(true); }}><Mail size={15} className="mr-1" />Email receipt</Button>
          {isDeleted(bill) ? (
            <Button onClick={() => requestPinAction("restore")}><RotateCcw size={15} className="mr-1" />Restore</Button>
          ) : (
            <>
              {bill.status !== "cancelled" && (
                <>
                  <Button variant="outline" onClick={startEdit}><Pencil size={15} className="mr-1" />Edit bill</Button>
                  <Button variant="outline" onClick={() => setEditMode("addon")}><Plus size={15} className="mr-1" />Add items</Button>
                </>
              )}
              {canReturn && <Button variant="outline" onClick={() => setReturnOpen(true)}><RotateCcw size={15} className="mr-1" />Return items</Button>}
              {bill.status !== "cancelled" && <Button variant="outline" onClick={() => requestPinAction("cancel")}><ShieldCheck size={15} className="mr-1" />Cancel with PIN</Button>}
              <Button className="h-11 w-full sm:w-auto" variant="outline" onClick={() => requestPinAction("delete")}><Trash2 size={15} className="mr-1" />Recycle bin</Button>
            </>
          )}
        </div>
      </div>

      {isCancelled && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-emerald-950 shadow-sm dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-100">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white"><CheckCircle2 size={18} /></span>
          <div className="min-w-0">
            <p className="font-bold">Cancellation confirmed</p>
            <p className="mt-0.5 text-sm text-emerald-800 dark:text-emerald-200">Stock and customer balance were reversed. {syncState === "synced" ? "Cloud backup is confirmed." : "Cloud backup is still pending."}</p>
            <p className="mt-1 break-words text-xs text-emerald-700 dark:text-emerald-300">Reason: {cancellationReason}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardHeader className="p-4 pb-1"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Total</CardTitle></CardHeader><CardContent className="px-4 pb-4 text-xl font-bold">{money(total)}</CardContent></Card>
        <Card><CardHeader className="p-4 pb-1"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Paid</CardTitle></CardHeader><CardContent className="px-4 pb-4 text-xl font-bold text-emerald-600">{money(paid)}</CardContent></Card>
        <Card><CardHeader className="p-4 pb-1"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">{isCancelled ? "Reversed Udhar" : "Udhar"}</CardTitle></CardHeader><CardContent className={`px-4 pb-4 text-xl font-bold ${isCancelled ? "text-emerald-600" : "text-orange-600"}`}>{money(credit)}</CardContent></Card>
        <Card><CardHeader className="p-4 pb-1"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Status</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-1.5 px-4 pb-4"><Badge>{paymentStatus(bill, visiblePayments)}</Badge><Badge variant="outline">{String(bill.sync_status ?? bill.status ?? "synced").replaceAll("_", " ")}</Badge></CardContent></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>Bill summary</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            <div><div className="text-muted-foreground">Date</div><div>{billDate(bill) ? new Date(billDate(bill)).toLocaleString("en-IN") : "No date"}</div></div>
            <div><div className="text-muted-foreground">Bill type</div><div>{String(bill.billType ?? "normal_sale").replaceAll("_", " ")}</div></div>
            <div><div className="text-muted-foreground">Subtotal</div><div>{money(readNumber(bill.subtotal, total + readNumber(bill.discount, 0)))}</div></div>
            <div><div className="text-muted-foreground">Discount</div><div>{money(readNumber(bill.discount, 0))}</div></div>
            <div><div className="text-muted-foreground">Deleted</div><div>{isDeleted(bill) ? "In recycle bin" : "No"}</div></div>
            <div className="sm:col-span-2"><div className="text-muted-foreground">Record identity</div><div className="mt-1 grid gap-1 text-xs sm:grid-cols-2"><span className="break-all rounded-lg bg-muted/60 px-2 py-1.5">Device: {localRecordId || "Merged after backup"}</span><span className="break-all rounded-lg bg-muted/60 px-2 py-1.5">Cloud: {cloudRecordId || "Waiting for backup"}</span></div></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Customer details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Name: </span>{bill.customerName || data.customer?.name || "Walk-in"}</div>
            <div><span className="text-muted-foreground">Mobile: </span>{bill.customerMobile || data.customer?.mobile || "Not available"}</div>
            <div><span className="text-muted-foreground">Current udhar: </span>{money(data.customerLedgerBalance)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Items</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-muted-foreground"><tr><th className="px-4 py-3 text-left">Item</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Rate</th><th className="px-4 py-3 text-right">Total</th></tr></thead>
            <tbody>{visibleItems.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No item rows found.</td></tr> : visibleItems.map((item, index) => {
              const addons = billItemAddons(item);
              const variation = String(item.sellingUnitLabel ?? item.selling_unit_label ?? "").trim();
              const note = String(item.note ?? "").trim();
              return <tr className="border-t align-top" key={String(item.id ?? index)}>
                <td className="px-4 py-3">
                  <div className="font-medium">{String(item.name ?? item.productName ?? "Item")}</div>
                  {variation ? <div className="mt-1 text-xs font-semibold text-muted-foreground">Portion: {variation}</div> : null}
                  {addons.length > 0 ? <div className="mt-2 flex max-w-[28rem] flex-wrap gap-1.5" aria-label="Selected add-ons">
                    {addons.map((addon, addonIndex) => <span className="inline-flex min-h-7 items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-950" key={`${addon.optionId ?? addon.name}-${addonIndex}`}>
                      {addon.groupName ? <span className="mr-1 text-amber-700">{addon.groupName}:</span> : null}
                      {addon.quantity > 1 ? `${addon.quantity}× ` : ""}{addon.name}
                      {addon.price > 0 ? <span className="ml-1 text-amber-800">+{money(addon.price * addon.quantity)}</span> : null}
                    </span>)}
                  </div> : null}
                  {note ? <div className="mt-1.5 text-xs text-muted-foreground">{note}</div> : null}
                </td>
                <td className="px-4 py-3 text-right">{readNumber(item.quantity, 0)} {String(item.enteredUnit ?? item.entered_unit ?? "")}</td>
                <td className="px-4 py-3 text-right">{money(readNumber(item.ratePerRateUnit ?? item.rate_per_rate_unit ?? item.rate, 0))}</td>
                <td className="px-4 py-3 text-right font-semibold">{money(itemTotal(item))}</td>
              </tr>;
            })}</tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Payment details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {visiblePayments.length === 0 ? <div className="text-muted-foreground">No separate payment rows found. Using bill-level paid/udhar values.</div> : visiblePayments.map((payment, index) => <div key={String(payment.id ?? index)} className="flex justify-between border-b pb-2"><span>{String(payment.mode ?? "payment").toUpperCase()}</span><span className="font-semibold">{money(readNumber(payment.amount, 0))}</span></div>)}
            <div className="pt-2 flex justify-between"><span>Total paid</span><span className="font-bold">{money(paid)}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Customer ledger impact</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.ledger.length === 0 ? <div className="text-muted-foreground">No ledger rows found for this bill.</div> : data.ledger.map((entry, index) => <div key={String(entry.id ?? index)} className="border-b pb-2"><div className="flex justify-between"><span>{String(entry.type ?? "entry").replaceAll("_", " ")}</span><span className="font-semibold">{money(readNumber(entry.amount, 0))}</span></div><div className="text-xs text-muted-foreground">{rowDate(entry) ? new Date(rowDate(entry)).toLocaleString("en-IN") : "No date"}</div></div>)}
            {credit > 0 && (isCancelled
              ? <div className="rounded-md bg-emerald-50 p-2 text-emerald-700">Cancellation reversed this bill&apos;s {money(credit)} Udhar impact.</div>
              : <div className="rounded-md bg-orange-50 p-2 text-orange-700">This bill adds {money(credit)} to customer Udhar.</div>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Audit trail</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm max-h-72 overflow-y-auto">
            {data.audit.length === 0 ? <div className="text-muted-foreground">No local audit actions yet.</div> : data.audit.sort((a, b) => rowDate(b).localeCompare(rowDate(a))).map((entry, index) => <div key={String(entry.id ?? index)} className="border-b pb-2"><div className="font-medium">{String(entry.action ?? "audit").replaceAll("_", " ")}</div><div className="text-xs text-muted-foreground">{rowDate(entry) ? new Date(rowDate(entry)).toLocaleString("en-IN") : "No date"}</div><div className="text-xs">{String(entry.reason ?? entry.summary ?? "")}</div></div>)}
          </CardContent>
        </Card>
      </div>

      <ReturnDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        lines={returnLines}
        customerId={(bill.customerId as string | undefined) ?? undefined}
        customerName={(bill.customerName as string | undefined) ?? undefined}
        originalBillId={bill.id}
        gstMode={(bill.gstMode as "inclusive" | "exclusive" | "none" | undefined) ?? "inclusive"}
        onDone={() => { void refetch(); }}
      />

      <Dialog open={emailOpen} onOpenChange={(open) => { if (!emailSending) setEmailOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Email receipt</DialogTitle><DialogDescription>Send a server-rendered copy of {billNo(bill)}. This requires internet and a configured email provider.</DialogDescription></DialogHeader>
          <div className="space-y-2 py-3">
            <Label htmlFor="receipt-email">Customer email</Label>
            <Input id="receipt-email" type="email" inputMode="email" autoComplete="email" value={receiptEmail} onChange={(event) => { setReceiptEmail(event.target.value); setEmailError(""); }} placeholder="customer@example.com" aria-invalid={Boolean(emailError) || undefined} aria-describedby={emailError ? "receipt-email-error" : undefined} />
            {emailError && <p id="receipt-email-error" role="alert" className="text-xs font-semibold text-destructive">{emailError}</p>}
          </div>
          <DialogFooter><Button className="h-11" variant="outline" disabled={emailSending} onClick={() => setEmailOpen(false)}>Cancel</Button><Button className="h-11" disabled={emailSending || !receiptEmail.trim()} onClick={() => void sendEmailReceipt()}>{emailSending ? "Sending…" : "Send receipt"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <OwnerPinModal
        open={!!pinAction}
        onCancel={() => setPinAction(null)}
        title={pinAction === "restore" ? "Restore bill" : pinAction === "cancel" ? "Cancel bill" : "Move bill to recycle bin"}
        description="Owner PIN is required. Financial records are preserved locally and synced later."
        confirmLabel={pinAction === "restore" ? "Restore" : pinAction === "cancel" ? "Cancel bill" : "Move to recycle bin"}
        reasonRequired={pinAction === "cancel" || pinAction === "delete"}
        loading={isSaving}
        onConfirm={({ ownerPin, reason }) => runPinAction(ownerPin, reason)}
      />

      <EditBillDialog
        open={editMode !== null}
        mode={editMode ?? "edit"}
        bill={bill}
        itemRows={visibleItems}
        onClose={() => setEditMode(null)}
        onDone={() => { void refetch(); }}
      />
    </div>
  );
}
