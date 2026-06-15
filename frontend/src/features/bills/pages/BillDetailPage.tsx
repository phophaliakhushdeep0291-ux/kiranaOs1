import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Pencil, Plus, Printer, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import { buildPrintableBillSnapshot, openPrintableBill } from "@/features/bills/print";
import { cancelBillWithOwnerPinLocalFirst, restoreBillWithOwnerPinLocalFirst, softDeleteBillWithOwnerPinLocalFirst } from "@/features/bills/local-actions";
import { EditBillDialog } from "@/features/bills/components/EditBillDialog";
import type { Bill, Customer } from "@/types/api";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { usePermission } from "@/features/staff/permissions";
import { calculateLedgerBalance, dedupeLedgerEntries, type CustomerLedgerEntry } from "@/features/ledger/accounting";
import { dedupeBillItemsForDisplay, dedupeBillsForDisplay, dedupePaymentsForDisplay } from "@/features/sync/bill-reconciliation";

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
  return String(bill.createdAt ?? bill.created_at ?? "");
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
  const [pinAction, setPinAction] = useState<PinAction | null>(null);
  const [editMode, setEditMode] = useState<"edit" | "addon" | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  function printBill() {
    if (!bill) return;
    const ok = openPrintableBill(buildPrintableBillSnapshot(bill, visibleItems, visiblePayments));
    if (!ok) toast({ title: "Print blocked", description: "Allow pop-ups to print or save PDF.", variant: "destructive" });
  }

  function sharePdfArchitecture() {
    toast({ title: "PDF/share architecture ready", description: "Use the same bill snapshot to generate a PDF blob and share through WhatsApp/email after adding the PDF service." });
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
    return <div className="p-6 text-muted-foreground">Loading bill from local records...</div>;
  }

  if (!bill) {
    return (
      <div className="p-6 space-y-4">
        <Link href="/bills"><Button variant="outline"><ArrowLeft size={15} className="mr-1" />Back to bills</Button></Link>
        <Card><CardContent className="py-10 text-center text-muted-foreground">Bill not found in local records.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <Link href="/bills"><Button variant="outline" size="sm"><ArrowLeft size={15} className="mr-1" />Back</Button></Link>
          <div>
            <h1 className="text-2xl font-bold">{billNo(bill)}</h1>
            <p className="text-sm text-muted-foreground">Duplicate copy, audit trail, ledger impact, and sync status.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={printBill}><Printer size={15} className="mr-1" />Print duplicate</Button>
          <Button variant="outline" onClick={sharePdfArchitecture}><FileText size={15} className="mr-1" />Share PDF</Button>
          {isDeleted(bill) ? (
            <Button onClick={() => requestPinAction("restore")}><RotateCcw size={15} className="mr-1" />Restore</Button>
          ) : (
            <>
              {bill.status !== "cancelled" && String(bill.billType ?? "normal_sale") !== "estimate" && (
                <>
                  <Button variant="outline" onClick={startEdit}><Pencil size={15} className="mr-1" />Edit bill</Button>
                  <Button variant="outline" onClick={() => setEditMode("addon")}><Plus size={15} className="mr-1" />Add items</Button>
                </>
              )}
              {bill.status !== "cancelled" && <Button variant="outline" onClick={() => requestPinAction("cancel")}><ShieldCheck size={15} className="mr-1" />Cancel with PIN</Button>}
              <Button variant="outline" onClick={() => requestPinAction("delete")}><Trash2 size={15} className="mr-1" />Move to recycle bin</Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{money(total)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Paid</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-emerald-600">{money(paid)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Udhar</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-orange-600">{money(credit)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Status</CardTitle></CardHeader><CardContent className="space-y-2"><Badge>{paymentStatus(bill, visiblePayments)}</Badge><Badge variant="outline">{String(bill.sync_status ?? bill.status ?? "synced").replaceAll("_", " ")}</Badge></CardContent></Card>
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
            <div><div className="text-muted-foreground">Local/server</div><div className="break-all">{String(bill.local_id ?? bill.id)} / {String(bill.server_id ?? "not backed up yet")}</div></div>
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
            <tbody>{visibleItems.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No item rows found.</td></tr> : visibleItems.map((item, index) => <tr className="border-t" key={String(item.id ?? index)}><td className="px-4 py-3 font-medium">{String(item.name ?? item.productName ?? "Item")}</td><td className="px-4 py-3 text-right">{readNumber(item.quantity, 0)} {String(item.enteredUnit ?? item.entered_unit ?? "")}</td><td className="px-4 py-3 text-right">{money(readNumber(item.ratePerRateUnit ?? item.rate_per_rate_unit ?? item.rate, 0))}</td><td className="px-4 py-3 text-right font-semibold">{money(itemTotal(item))}</td></tr>)}</tbody>
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
            {credit > 0 && <div className="rounded-md bg-orange-50 p-2 text-orange-700">This bill adds {money(credit)} to customer udhar unless cancelled.</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Audit trail</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm max-h-72 overflow-y-auto">
            {data.audit.length === 0 ? <div className="text-muted-foreground">No local audit actions yet.</div> : data.audit.sort((a, b) => rowDate(b).localeCompare(rowDate(a))).map((entry, index) => <div key={String(entry.id ?? index)} className="border-b pb-2"><div className="font-medium">{String(entry.action ?? "audit").replaceAll("_", " ")}</div><div className="text-xs text-muted-foreground">{rowDate(entry) ? new Date(rowDate(entry)).toLocaleString("en-IN") : "No date"}</div><div className="text-xs">{String(entry.reason ?? entry.summary ?? "")}</div></div>)}
          </CardContent>
        </Card>
      </div>

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
