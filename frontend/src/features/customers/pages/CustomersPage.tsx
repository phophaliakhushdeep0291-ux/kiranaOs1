import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  FileText,
  MapPin,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  Trash2,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { CHIP_TONES } from "@/lib/chip-tones";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { createCustomerLocalFirst, deleteCustomerLocalFirst, updateCustomerLocalFirst } from "@/features/customers/local-actions";
import { recordPaymentLocalFirst } from "@/features/payments/local-actions";
import {
  loadCustomerDetail,
  loadCustomersWithLedger,
  formatShortDate,
  type CustomerWithLedger,
} from "@/features/customers/customer-ledger-data";
import type { CustomerInput } from "@/types/api";
import { cn } from "@/lib/utils";

interface CustomerFormState {
  name: string;
  mobile: string;
  address: string;
  type: "regular" | "udhar";
  dueDate: string;
  promiseToPayDate: string;
  udharLimit: string;
  notes: string;
}

interface PaymentFormState {
  customerId: string;
  amount: string;
  mode: "cash" | "upi";
  note: string;
}

function blankCustomerForm(): CustomerFormState {
  return { name: "", mobile: "", address: "", type: "regular", dueDate: "", promiseToPayDate: "", udharLimit: "", notes: "" };
}

function useCustomersLedgerList() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["customers-ledger-list"] });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [queryClient]);
  return useQuery({ queryKey: ["customers-ledger-list"], queryFn: loadCustomersWithLedger, staleTime: 1_500 });
}

function money(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function fmtMoney(value: unknown) {
  return `₹${money(value).toLocaleString("en-IN")}`;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "CU";
}

function customerDedupeKey(customer: CustomerWithLedger) {
  const mobile = String(customer.mobile ?? "").replace(/\D/g, "");
  if (mobile) return `mobile:${mobile}`;
  return `name:${customer.name.trim().toLowerCase()}|address:${String(customer.address ?? "").trim().toLowerCase()}`;
}

function chooseBestCustomer(current: CustomerWithLedger, candidate: CustomerWithLedger) {
  const candidateSynced = !String(candidate.id).startsWith("local_") && candidate.sync_status !== "pending_sync";
  const currentSynced = !String(current.id).startsWith("local_") && current.sync_status !== "pending_sync";
  if (candidateSynced !== currentSynced) return candidateSynced ? candidate : current;
  if (Math.abs(candidate.ledgerBalance) !== Math.abs(current.ledgerBalance)) return Math.abs(candidate.ledgerBalance) > Math.abs(current.ledgerBalance) ? candidate : current;
  const candidateTime = new Date(candidate.updatedAt ?? candidate.createdAt ?? 0).getTime();
  const currentTime = new Date(current.updatedAt ?? current.createdAt ?? 0).getTime();
  return candidateTime >= currentTime ? candidate : current;
}

function riskInfo(customer: CustomerWithLedger) {
  const balance = Math.max(0, customer.ledgerBalance);
  const limit = Number(customer.udharLimit ?? 0);
  if (balance <= 0) return { label: "No Due", cls: "bg-[#eef2f8] text-[#52627e]", dot: "bg-[#94a3b8]" };
  // With a limit: risk scales by utilisation. Without one: by absolute exposure.
  const ratio = limit > 0 ? balance / limit : balance / 10_000;
  if (customer.ledgerMetrics.isBadCustomer || ratio > 0.8) {
    return { label: "High Risk", cls: "bg-rose-50 text-rose-600 ring-rose-100", dot: "bg-rose-500" };
  }
  if (ratio > 0.35) return { label: "Medium Risk", cls: "bg-amber-50 text-amber-700 ring-amber-100", dot: "bg-amber-500" };
  return { label: "Low Risk", cls: "bg-emerald-50 text-emerald-700 ring-emerald-100", dot: "bg-emerald-500" };
}

function trustBadge(customer: CustomerWithLedger) {
  const score = customer.ledgerMetrics.trustScore;
  if (score >= 75) return { label: `Trusted ${score}`, cls: "bg-emerald-50 text-emerald-700" };
  if (score >= 45) return { label: `Watch ${score}`, cls: "bg-amber-50 text-amber-700" };
  return { label: `Risk ${score}`, cls: "bg-rose-50 text-rose-700" };
}

function getAmount(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(row[key] ?? 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function getDate(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

export default function CustomersPage() {
  const { toast } = useToast();
  const { data: customers = [], isLoading, refetch } = useCustomersLedgerList();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "udhar" | "bad" | "due" | "promise">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerWithLedger | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(blankCustomerForm());
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>({ customerId: "", amount: "", mode: "cash", note: "" });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomerWithLedger | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"ledger" | "transactions" | "payments" | "notes">("ledger");

  const dedupedCustomers = useMemo(() => {
    const map = new Map<string, CustomerWithLedger>();
    for (const customer of customers) {
      if (customer.deletedAt || (customer as { deleted_at?: unknown }).deleted_at) continue;
      const key = customerDedupeKey(customer);
      const existing = map.get(key);
      map.set(key, existing ? chooseBestCustomer(existing, customer) : customer);
    }
    return Array.from(map.values()).sort((a, b) => b.ledgerBalance - a.ledgerBalance || a.name.localeCompare(b.name));
  }, [customers]);

  const totals = useMemo(() => {
    const totalUdhar = dedupedCustomers.reduce((sum, customer) => sum + Math.max(0, customer.ledgerBalance), 0);
    return {
      customers: dedupedCustomers.length,
      active: dedupedCustomers.filter((customer) => customer.ledgerBalance > 0).length,
      totalUdhar,
      bad: dedupedCustomers.filter((customer) => customer.ledgerMetrics.isBadCustomer).length,
      dueSoon: dedupedCustomers.filter((customer) => Boolean(customer.dueDate || customer.promiseToPayDate)).length,
    };
  }, [dedupedCustomers]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dedupedCustomers.filter((customer) => {
      const matchesSearch = !q
        || customer.name.toLowerCase().includes(q)
        || String(customer.mobile ?? "").includes(q)
        || String(customer.address ?? "").toLowerCase().includes(q);
      const matchesFilter =
        filter === "all" ? true :
        filter === "udhar" ? customer.ledgerBalance > 0 :
        filter === "bad" ? customer.ledgerMetrics.isBadCustomer :
        filter === "due" ? Boolean(customer.dueDate) :
        filter === "promise" ? Boolean(customer.promiseToPayDate) : true;
      return matchesSearch && matchesFilter;
    });
  }, [dedupedCustomers, filter, search]);

  useEffect(() => {
    if (filteredCustomers.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredCustomers.some((customer) => customer.id === selectedId)) {
      setSelectedId(filteredCustomers[0].id);
    }
  }, [filteredCustomers, selectedId]);

  const selectedCustomer = useMemo(
    () => filteredCustomers.find((customer) => customer.id === selectedId) ?? filteredCustomers[0] ?? null,
    [filteredCustomers, selectedId],
  );

  const selectedDetail = useQuery({
    queryKey: ["customer-detail-inline", selectedCustomer?.id],
    queryFn: () => loadCustomerDetail(selectedCustomer?.id ?? ""),
    enabled: Boolean(selectedCustomer?.id),
    staleTime: 1_500,
  });

  const ageing = selectedCustomer?.ledgerMetrics.ageing;
  const ledgerRows = selectedDetail.data?.ledger ?? [];
  const paymentRows = selectedDetail.data?.payments ?? [];
  const billRows = selectedDetail.data?.bills ?? [];
  const selectedRisk = selectedCustomer ? riskInfo(selectedCustomer) : null;
  const selectedTrust = selectedCustomer ? trustBadge(selectedCustomer) : null;
  const creditLimit = money(selectedCustomer?.udharLimit);
  const availableCredit = Math.max(0, creditLimit - Math.max(0, money(selectedCustomer?.ledgerBalance)));
  const trustScore = selectedCustomer?.ledgerMetrics.trustScore ?? 0;

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ draft?: Partial<CustomerFormState> & { mode?: "create" | "edit" } }>).detail;
      const draft = detail?.draft;
      if (!draft) return;
      const lookupName = String(draft.name ?? "").trim().toLowerCase();
      const lookupMobile = String(draft.mobile ?? "").replace(/\D/g, "");
      const existing = draft.mode === "edit"
        ? dedupedCustomers.find((customer) => {
            const mobile = String(customer.mobile ?? "").replace(/\D/g, "");
            return (lookupMobile && mobile === lookupMobile) || (lookupName && customer.name.toLowerCase().includes(lookupName));
          })
        : undefined;

      setEditing(existing ?? null);
      setCustomerForm({
        name: draft.name ?? existing?.name ?? "",
        mobile: draft.mobile ?? existing?.mobile ?? "",
        address: draft.address ?? existing?.address ?? "",
        type: draft.type === "udhar" || existing?.type === "udhar" ? "udhar" : "regular",
        dueDate: draft.dueDate ?? existing?.dueDate ?? "",
        promiseToPayDate: draft.promiseToPayDate ?? existing?.promiseToPayDate ?? "",
        udharLimit: draft.udharLimit !== undefined ? String(draft.udharLimit) : typeof existing?.udharLimit === "number" ? String(existing.udharLimit) : "",
        notes: draft.notes ?? existing?.notes ?? "",
      });
      setCustomerOpen(true);
      toast({ title: existing ? "Customer edit prepared" : "Customer draft prepared", description: "Voice assistant filled the form. Review and save locally." });
    };
    window.addEventListener("kirana:voice-customer-draft", handler);
    return () => window.removeEventListener("kirana:voice-customer-draft", handler);
  }, [dedupedCustomers, toast]);

  function openCreate() {
    setEditing(null);
    setCustomerForm(blankCustomerForm());
    setCustomerOpen(true);
  }

  function openEdit(customer: CustomerWithLedger) {
    setEditing(customer);
    setCustomerForm({
      name: customer.name,
      mobile: customer.mobile ?? "",
      address: customer.address ?? "",
      type: customer.type === "udhar" ? "udhar" : "regular",
      dueDate: customer.dueDate ?? "",
      promiseToPayDate: customer.promiseToPayDate ?? "",
      udharLimit: typeof customer.udharLimit === "number" ? String(customer.udharLimit) : "",
      notes: customer.notes ?? "",
    });
    setCustomerOpen(true);
  }

  function openPayment(customer?: CustomerWithLedger) {
    setPaymentForm({ customerId: customer?.id ?? selectedCustomer?.id ?? "", amount: "", mode: "cash", note: "" });
    setPaymentOpen(true);
  }

  async function saveCustomer() {
    if (!customerForm.name.trim()) {
      toast({ title: "Customer name required", variant: "destructive" });
      return;
    }
    if (!customerForm.mobile.trim()) {
      toast({ title: "Mobile/number required", description: "Use phone, shop number, or local identity number.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const data: CustomerInput = {
        name: customerForm.name.trim(),
        mobile: customerForm.mobile.trim(),
        address: customerForm.address.trim() || undefined,
        type: customerForm.type,
        dueDate: customerForm.dueDate || undefined,
        promiseToPayDate: customerForm.promiseToPayDate || undefined,
        udharLimit: customerForm.udharLimit ? Number(customerForm.udharLimit) : undefined,
        notes: customerForm.notes.trim() || undefined,
      };
      if (editing) await updateCustomerLocalFirst(editing.id, data);
      else await createCustomerLocalFirst(data);
      toast({ title: editing ? "Customer updated" : "Customer added", description: "Data safe locally. Cloud backup will happen during sync." });
      setCustomerOpen(false);
      await refetch();
    } catch (error) {
      toast({ title: "Could not save customer", description: error instanceof Error ? error.message : "Please check details.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function requestDeleteCustomer(customer: CustomerWithLedger) {
    setDeleteTarget(customer);
    setDeleteError(null);
  }

  async function confirmDeleteCustomer(ownerPin: string, reason: string) {
    if (!deleteTarget) return;
    setSaving(true);
    setDeleteError(null);
    try {
      await deleteCustomerLocalFirst({ id: deleteTarget.id, ownerPin, reason });
      toast({ title: "Customer moved to recycle bin", description: "This is a soft delete. Ledger and bills are not hard deleted." });
      setDeleteTarget(null);
      await refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Try again.";
      setDeleteError(message);
      toast({ title: "Could not delete customer", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function mobileDigits() {
    return String(selectedCustomer?.mobile ?? "").replace(/\D/g, "").slice(-10);
  }

  function shareWhatsApp() {
    const digits = mobileDigits();
    if (!digits) { toast({ title: "No mobile number", description: "Add a mobile number to send a WhatsApp reminder.", variant: "destructive" }); return; }
    const balance = Math.max(0, money(selectedCustomer?.ledgerBalance));
    const text = encodeURIComponent(`Namaste ${selectedCustomer?.name} ji, aapka khata balance ₹${balance.toLocaleString("en-IN")} hai. Kripya payment kar dein. Dhanyavaad!`);
    window.open(`https://wa.me/91${digits}?text=${text}`, "_blank", "noopener");
  }

  function sendSms() {
    const digits = mobileDigits();
    if (!digits) { toast({ title: "No mobile number", variant: "destructive" }); return; }
    const balance = Math.max(0, money(selectedCustomer?.ledgerBalance));
    window.location.href = `sms:+91${digits}?body=${encodeURIComponent(`Namaste ${selectedCustomer?.name} ji, aapka khata balance ₹${balance.toLocaleString("en-IN")} hai.`)}`;
  }

  function quickCall() {
    const digits = mobileDigits();
    if (!digits) { toast({ title: "No mobile number", variant: "destructive" }); return; }
    window.location.href = `tel:+91${digits}`;
  }

  function printStatement() {
    if (!selectedCustomer) return;
    const popup = window.open("", "_blank", "width=540,height=740");
    if (!popup) { toast({ title: "Allow pop-ups", description: "Enable pop-ups to print the statement.", variant: "destructive" }); return; }
    const rows = (selectedDetail.data?.ledger ?? []).map((row) => {
      const signed = Number(row.signed_amount ?? 0);
      return `<tr><td>${formatShortDate(row.display_date)}</td><td>${String(row.note || row.source_id || row.display_type)}</td><td style="text-align:right">${signed > 0 ? signed.toLocaleString("en-IN") : "-"}</td><td style="text-align:right">${signed < 0 ? Math.abs(signed).toLocaleString("en-IN") : "-"}</td><td style="text-align:right">${money(row.running_balance).toLocaleString("en-IN")}</td></tr>`;
    }).join("");
    popup.document.write(`<!doctype html><html><head><title>Khata Statement — ${selectedCustomer.name}</title><style>body{font-family:Arial;font-size:12px;padding:18px;color:#111827}h1{font-size:17px;margin:0}p{margin:3px 0;color:#555}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #e2e8f0;padding:6px 4px;text-align:left;font-size:11px}th{background:#f5f8fc;text-transform:uppercase;font-size:10px}strong.due{color:#ef4444}</style></head><body><h1>Khata Statement — ${selectedCustomer.name}</h1><p>${selectedCustomer.mobile ?? ""}</p><p>As on ${formatShortDate(new Date().toISOString())} · Outstanding: <strong class="due">₹${Math.max(0, money(selectedCustomer.ledgerBalance)).toLocaleString("en-IN")}</strong></p><table><thead><tr><th>Date</th><th>Particulars</th><th style="text-align:right">Udhar (₹)</th><th style="text-align:right">Paid (₹)</th><th style="text-align:right">Balance (₹)</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No ledger entries</td></tr>`}</tbody></table><script>setTimeout(function(){window.print()},300)</script></body></html>`);
    popup.document.close();
  }

  async function recordPayment() {
    const amount = Number(paymentForm.amount);
    if (!paymentForm.customerId || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Select customer and amount", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await recordPaymentLocalFirst(paymentForm.customerId, { amount, mode: paymentForm.mode, note: paymentForm.note.trim() || undefined });
      toast({ title: "Payment recorded", description: "Ledger updated locally. Sync will upload this safely." });
      setPaymentOpen(false);
      await refetch();
    } catch (error) {
      toast({ title: "Payment failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full bg-[#f7fbff] px-4 py-4 lg:px-5">
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)_320px]">
        <section className="min-h-0 overflow-hidden rounded-[16px] border border-[#e6ecf4] bg-white shadow-[0_12px_34px_rgba(15,35,80,0.055)]">
          <div className="border-b border-[#edf2f8] p-4">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7a9a]" />
              <Input
                className="h-11 rounded-[12px] border-[#e3eaf3] bg-[#f8fafd] pl-10 text-[13px] font-medium text-[#0f2147] placeholder:text-[#6b7a9a] focus-visible:border-[#075cf7] focus-visible:bg-white focus-visible:ring-0"
                placeholder="Search customers by name or mobile"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {([
                ["all", `All ${totals.customers}`],
                ["udhar", `Active ${totals.active}`],
                ["bad", `High ${totals.bad}`],
                ["due", `Due ${totals.dueSoon}`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "h-9 rounded-[10px] border px-2 text-[11px] font-black transition-colors",
                    filter === key
                      ? "border-[#075cf7] bg-[#075cf7] text-white shadow-[0_8px_18px_rgba(0,91,255,0.22)]"
                      : "border-[#e6ecf4] bg-white text-[#334466] hover:bg-[#f7faff]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-[12px] font-bold text-[#64748b]">Sort: <span className="text-[#102347]">Highest balance</span></p>
            <Button onClick={openCreate} variant="outline" className="h-8 rounded-[9px] px-3 text-[12px] font-bold">
              <Plus size={14} className="mr-1" /> Add
            </Button>
          </div>

          <div className="max-h-[calc(100vh-245px)] overflow-y-auto px-3 pb-3">
            {isLoading ? (
              <div className="py-10 text-center text-[13px] text-[#64748b]">Loading customers from local database...</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="rounded-[14px] border border-dashed border-[#d8e2f1] px-4 py-10 text-center">
                <Users size={26} className="mx-auto text-[#94a3b8]" />
                <p className="mt-2 text-[13px] font-bold text-[#102347]">No customers found</p>
                <p className="mt-1 text-[12px] text-[#64748b]">Add a customer or clear filters.</p>
              </div>
            ) : (
              filteredCustomers.map((customer) => {
                const risk = riskInfo(customer);
                const active = selectedCustomer?.id === customer.id;
                return (
                  <button
                    key={customer.id}
                    onClick={() => setSelectedId(customer.id)}
                    className={cn(
                      "mb-2 flex w-full items-center gap-3 rounded-[14px] border p-3 text-left transition-all",
                      active
                        ? "border-[#075cf7] bg-[#eef5ff] shadow-[0_10px_22px_rgba(0,91,255,0.10)]"
                        : "border-transparent bg-white hover:border-[#dbe6f7] hover:bg-[#f8fbff]",
                    )}
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#edf4ff] text-[13px] font-black text-[#075cf7]">{initials(customer.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-black text-[#102347]">{customer.name}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-[#52627e]">{customer.mobile || "No mobile"}</span>
                      <span className="mt-1 block text-[11px] text-[#64748b]">{customer.ledgerMetrics.lastBillAt ? "Last bill " + formatShortDate(customer.ledgerMetrics.lastBillAt) : "No recent bill"}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn("block text-[13px] font-black", customer.ledgerBalance > 0 ? "text-rose-600" : "text-[#102347]")}>{fmtMoney(customer.ledgerBalance)}</span>
                      <span className={cn("mt-1 inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[10px] font-black ring-1 ring-inset", risk.cls)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", risk.dot)} />
                        {risk.label}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          {!selectedCustomer || !selectedRisk || !selectedTrust ? (
            <div className="rounded-[16px] border border-dashed border-[#d8e2f1] bg-white px-5 py-16 text-center shadow-[0_12px_34px_rgba(15,35,80,0.055)]">
              <Users size={30} className="mx-auto text-[#94a3b8]" />
              <p className="mt-3 font-display text-[18px] font-black text-[#102347]">Select a customer</p>
              <p className="mt-1 text-[13px] text-[#64748b]">Ledger, payment history, and trust details will appear here.</p>
            </div>
          ) : (
            <>
              <div className="rounded-[16px] border border-[#e6ecf4] bg-white p-5 shadow-[0_12px_34px_rgba(15,35,80,0.055)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 gap-4">
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#e7efff] font-display text-[22px] font-black text-[#075cf7]">{initials(selectedCustomer.name)}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-display text-[21px] font-black tracking-tight text-[#102347]">{selectedCustomer.name}</h2>
                        <button onClick={() => openEdit(selectedCustomer)} className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] font-bold text-[#075cf7] hover:bg-[#eef5ff]">
                          <Pencil size={13} /> Edit
                        </button>
                        <span className={cn("inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-black", selectedTrust.cls)}>
                          <Star size={12} /> {selectedTrust.label}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-[#344668]">
                        <span><Phone size={13} className="mr-1 inline text-[#64748b]" />{selectedCustomer.mobile || "No mobile"}</span>
                        <span><MapPin size={13} className="mr-1 inline text-[#64748b]" />{selectedCustomer.address || "No address"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-right">
                    <InfoMini label="Customer Since" value={formatShortDate(selectedCustomer.createdAt)} />
                    <InfoMini label="Last Purchase" value={formatShortDate(selectedCustomer.ledgerMetrics.lastBillAt)} />
                  </div>
                </div>

                <div className="mt-5 grid gap-3 rounded-[14px] border border-[#e8eef7] bg-[#fbfdff] p-4 md:grid-cols-3">
                  <SummaryCell label="Total Outstanding" value={fmtMoney(selectedCustomer.ledgerBalance)} valueClass={selectedCustomer.ledgerBalance > 0 ? "text-rose-600" : "text-emerald-600"} />
                  <SummaryCell label="Credit Limit" value={creditLimit > 0 ? fmtMoney(creditLimit) : "Not set"} />
                  <SummaryCell
                    label="Available Credit"
                    value={creditLimit > 0
                      ? (money(selectedCustomer.ledgerBalance) > creditLimit ? `Over by ${fmtMoney(money(selectedCustomer.ledgerBalance) - creditLimit)}` : fmtMoney(availableCredit))
                      : "No limit"}
                    valueClass={creditLimit > 0 && money(selectedCustomer.ledgerBalance) > creditLimit ? "text-rose-600" : "text-emerald-600"}
                  />
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px]">
                  <div className="rounded-[14px] border border-[#e8eef7] bg-white p-4">
                    <p className="text-[12px] font-bold text-[#64748b]">Risk Level</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[12px] font-black ring-1 ring-inset", selectedRisk.cls)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", selectedRisk.dot)} />
                        {selectedRisk.label}
                      </span>
                      <span className="text-[12px] text-[#64748b]">{selectedCustomer.ledgerMetrics.warning ?? "Payment pattern looks trackable."}</span>
                    </div>
                  </div>
                  <div className="rounded-[14px] border border-[#e8eef7] bg-white p-4 text-center">
                    <p className="text-[12px] font-bold text-[#64748b]">Payment Score</p>
                    {(() => {
                      const scoreColor = trustScore >= 75 ? "#16a34a" : trustScore >= 45 ? "#f59e0b" : "#ef4444";
                      return (
                        <div
                          className="mx-auto mt-2 grid h-16 w-16 place-items-center rounded-full"
                          style={{ background: `conic-gradient(${scoreColor} 0 ${Math.min(100, Math.max(0, trustScore))}%, #eef2f8 ${Math.min(100, Math.max(0, trustScore))}% 100%)` }}
                        >
                          <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-white font-display text-[12px] font-black" style={{ color: scoreColor }}>
                            {trustScore}<span className="text-[8px] text-[#94a3b8]">/100</span>
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div className="rounded-[16px] border border-[#e6ecf4] bg-white shadow-[0_12px_34px_rgba(15,35,80,0.055)]">
                <div className="flex items-center gap-6 overflow-x-auto border-b border-[#edf2f8] px-5">
                  {([["ledger", "Ledger"], ["transactions", "Transactions"], ["payments", "Payment History"], ["notes", `Notes${selectedCustomer.notes ? " (1)" : ""}`]] as const).map(([key, label]) => (
                    <button key={key} onClick={() => setActiveTab(key)} className={cn("h-12 whitespace-nowrap border-b-2 text-[13px] font-black transition-colors", activeTab === key ? "border-[#075cf7] text-[#075cf7]" : "border-transparent text-[#536383] hover:text-[#102347]")}>{label}</button>
                  ))}
                </div>
                {activeTab === "ledger" && (
                  <>
                    <div className="overflow-x-auto p-3">
                      <table className="w-full min-w-[650px] text-[12.5px]">
                        <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                          <tr>
                            <th className="px-3 py-2.5 text-left font-bold">Date</th>
                            <th className="px-3 py-2.5 text-left font-bold">Particulars</th>
                            <th className="px-3 py-2.5 text-left font-bold">Type</th>
                            <th className="px-3 py-2.5 text-right font-bold">Debit</th>
                            <th className="px-3 py-2.5 text-right font-bold">Credit</th>
                            <th className="px-3 py-2.5 text-right font-bold">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedDetail.isLoading ? (
                            <tr><td colSpan={6} className="px-3 py-10 text-center text-[#64748b]">Loading ledger...</td></tr>
                          ) : ledgerRows.length === 0 ? (
                            <tr><td colSpan={6} className="px-3 py-10 text-center text-[#64748b]">No ledger entries yet.</td></tr>
                          ) : (
                            ledgerRows.slice(0, 7).map((row) => {
                              const signed = Number(row.signed_amount ?? 0);
                              return (
                                <tr key={row.id} className="border-b border-[#eef2f8] last:border-0">
                                  <td className="px-3 py-3 text-[#52627e]">{formatShortDate(row.display_date)}</td>
                                  <td className="max-w-[220px] truncate px-3 py-3 font-semibold text-[#102347]">{row.note || row.source_id || row.display_type}</td>
                                  <td className="px-3 py-3"><span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", row.display_type === "PAYMENT" ? CHIP_TONES.green : CHIP_TONES.blue)}>{row.display_type}</span></td>
                                  <td className="px-3 py-3 text-right font-bold text-[#102347]">{signed > 0 ? fmtMoney(signed) : "-"}</td>
                                  <td className="px-3 py-3 text-right font-bold text-emerald-600">{signed < 0 ? fmtMoney(Math.abs(signed)) : "-"}</td>
                                  <td className="px-3 py-3 text-right font-black text-[#102347]">{fmtMoney(row.running_balance)}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="border-t border-[#edf2f8] px-5 py-3 text-center">
                      <Link href={`/customers/${selectedCustomer.id}`} className="inline-flex items-center gap-2 text-[13px] font-black text-[#075cf7] hover:underline">
                        View Full Ledger <ChevronRight size={14} />
                      </Link>
                    </div>
                  </>
                )}
                {activeTab === "transactions" && (
                  <div className="p-4">
                    {billRows.length === 0 ? (
                      <p className="py-8 text-center text-[12.5px] text-[#64748b]">No bills for this customer yet.</p>
                    ) : (
                      billRows.slice(0, 8).map((bill, index) => (
                        <div key={String(bill.id ?? index)} className={cn("flex items-center gap-3 py-2.5", index < Math.min(billRows.length, 8) - 1 && "border-b border-[#eef2f8]")}>
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#eef5ff] text-[#075cf7]"><FileText size={15} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] font-black text-[#102347]">{String(bill.billNumber ?? bill.billNo ?? "Bill")}</p>
                            <p className="text-[11px] text-[#94a3b8]">{formatShortDate(getDate(bill, ["createdAt", "created_at"]))}</p>
                          </div>
                          <span className="text-[13px] font-black text-[#102347]">{fmtMoney(getAmount(bill, ["grandTotal", "grand_total", "totalAmount", "total_amount"]))}</span>
                          <span className={cn("rounded-[7px] px-2 py-[3px] text-[10.5px] font-black", money(bill.creditAmount) > 0 ? CHIP_TONES.red : CHIP_TONES.green)}>{money(bill.creditAmount) > 0 ? "Due" : "Paid"}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {activeTab === "payments" && (
                  <div className="p-4">
                    {paymentRows.length === 0 ? (
                      <p className="py-8 text-center text-[12.5px] text-[#64748b]">No payments recorded yet.</p>
                    ) : (
                      paymentRows.slice(0, 8).map((payment, index) => (
                        <div key={String(payment.id ?? index)} className={cn("flex items-center gap-3 py-2.5", index < Math.min(paymentRows.length, 8) - 1 && "border-b border-[#eef2f8]")}>
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-emerald-50 text-emerald-600"><Wallet size={15} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-black text-[#102347]">{fmtMoney(getAmount(payment, ["amount", "paidAmount", "paid_amount"]))}</p>
                            <p className="text-[11px] text-[#94a3b8]">{formatShortDate(getDate(payment, ["paidAt", "paid_at", "createdAt", "created_at"]))}</p>
                          </div>
                          <span className={cn("rounded-[7px] px-2 py-[3px] text-[10.5px] font-black", String(payment.mode ?? "").toLowerCase() === "upi" ? CHIP_TONES.violet : CHIP_TONES.green)}>{String(payment.mode ?? "cash").toUpperCase()}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {activeTab === "notes" && (
                  <div className="p-4">
                    <div className="rounded-[12px] border border-[#e8eef7] bg-[#fbfdff] p-4 text-[12.5px] leading-6 text-[#344668]">
                      {selectedCustomer.notes || "No notes yet. Add payment preferences, delivery habits, or credit rules."}
                      <p className="mt-3 text-[11px] font-semibold text-[#94a3b8]">Updated {formatShortDate(selectedCustomer.updatedAt ?? selectedCustomer.createdAt)}</p>
                    </div>
                    <Button variant="outline" className="mt-3 h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => openEdit(selectedCustomer)}><Pencil size={13} /> {selectedCustomer.notes ? "Edit note" : "Add note"}</Button>
                  </div>
                )}
              </div>

              <button
                onClick={() => openPayment(selectedCustomer)}
                className="flex w-full items-center justify-between rounded-[14px] bg-gradient-to-b from-[#075cf7] to-[#0047e8] p-4 text-left text-white shadow-[0_14px_28px_rgba(0,91,255,0.26)] transition-transform hover:-translate-y-0.5"
              >
                <span className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-white/15"><Wallet size={18} /></span>
                  <span>
                    <span className="block text-[14px] font-black">Record Payment</span>
                    <span className="block text-[12px] text-white/75">Receive payment from {selectedCustomer.name}</span>
                  </span>
                </span>
                <ChevronRight size={20} />
              </button>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <ActionTile icon={<FileText size={18} />} title="Statement" sub="Download / Print" onClick={printStatement} />
                <ActionTile icon={<MessageCircle size={18} className="text-emerald-600" />} title="WhatsApp" sub="Share Statement" onClick={shareWhatsApp} />
                <ActionTile icon={<MessageSquare size={18} />} title="SMS" sub="Send Reminder" onClick={sendSms} />
                <ActionTile icon={<Phone size={18} />} title="Call" sub="Quick Call" onClick={quickCall} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="rounded-[14px] border border-[#e6ecf4] bg-white p-4 text-center shadow-[0_10px_24px_rgba(15,35,80,0.045)] transition-all hover:-translate-y-0.5 hover:border-[#cfe0ff] hover:bg-[#f8fbff]">
                      <span className="mx-auto grid h-10 w-10 place-items-center rounded-[12px] bg-[#eef5ff] text-[#075cf7]"><MoreHorizontal size={18} /></span>
                      <span className="mt-2 block text-[12px] font-black text-[#102347]">More</span>
                      <span className="mt-0.5 block text-[10.5px] font-medium text-[#64748b]">More Options</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem asChild><Link href={`/customers/${selectedCustomer.id}`}><span className="flex items-center"><UserRound size={14} className="mr-2" /> Open full profile</span></Link></DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openEdit(selectedCustomer)}><Pencil size={14} className="mr-2" /> Edit customer</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { void navigator.clipboard?.writeText(selectedCustomer.mobile ?? ""); toast({ title: "Mobile copied" }); }}><Phone size={14} className="mr-2" /> Copy mobile</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => requestDeleteCustomer(selectedCustomer)}><Trash2 size={14} className="mr-2" /> Delete customer</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          )}
        </section>

        <aside className="space-y-4">
          <RightCard title="Aging Summary">
            {(() => {
              // Real conic stops from the ledger ageing buckets — not decorative.
              const buckets = [
                { value: Math.max(0, money(ageing?.zeroToSeven)), color: "#22c55e" },
                { value: Math.max(0, money(ageing?.sevenToThirty)), color: "#f59e0b" },
                { value: Math.max(0, money(ageing?.thirtyPlus)), color: "#ef4444" },
              ];
              const total = buckets.reduce((sum, b) => sum + b.value, 0);
              let acc = 0;
              const stops = buckets.filter((b) => b.value > 0).map((b) => {
                const from = (acc / total) * 100;
                acc += b.value;
                const to = (acc / total) * 100;
                return `${b.color} ${from}% ${to}%`;
              }).join(", ");
              return (
                <div className="flex items-center gap-4">
                  <div
                    className="grid h-28 w-28 shrink-0 place-items-center rounded-full"
                    style={{ background: total > 0 ? `conic-gradient(${stops})` : "conic-gradient(#e6ecf4 0 100%)" }}
                  >
                    <div className="grid h-[76px] w-[76px] place-items-center rounded-full bg-white text-center shadow-inner">
                      <div>
                        <p className="font-display text-[16px] font-black text-[#102347]">{fmtMoney(total)}</p>
                        <p className="text-[10px] font-semibold text-[#64748b]">Total Due</p>
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2 text-[12px]">
                    <Legend color="bg-emerald-500" label="0 - 7 Days" value={fmtMoney(ageing?.zeroToSeven ?? 0)} />
                    <Legend color="bg-amber-500" label="7 - 30 Days" value={fmtMoney(ageing?.sevenToThirty ?? 0)} />
                    <Legend color="bg-rose-500" label="30+ Days" value={fmtMoney(ageing?.thirtyPlus ?? 0)} />
                  </div>
                </div>
              );
            })()}
          </RightCard>

          <RightCard title="Payment History" action="View all" onAction={() => setActiveTab("payments")}>
            {paymentRows.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-[#64748b]">No payments recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {paymentRows.slice(0, 5).map((payment, index) => {
                  const amount = getAmount(payment, ["amount", "paidAmount", "paid_amount"]);
                  const date = getDate(payment, ["paidAt", "paid_at", "createdAt", "created_at"]);
                  return (
                    <div key={String(payment.id ?? index)} className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="text-[#52627e]">{formatShortDate(date)}</span>
                      <span className="font-black text-[#102347]">{fmtMoney(amount)}</span>
                      <span className={cn("rounded-[7px] px-2 py-[3px] text-[10px] font-black", String(payment.mode ?? "").toLowerCase() === "upi" ? CHIP_TONES.violet : CHIP_TONES.green)}>{String(payment.mode ?? "cash").toUpperCase()}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </RightCard>

          <RightCard title="Recent Transactions" action="View all" onAction={() => setActiveTab("transactions")}>
            {billRows.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-[#64748b]">No recent bills yet.</p>
            ) : (
              <div className="space-y-3">
                {billRows.slice(0, 5).map((bill, index) => (
                  <div key={String(bill.id ?? index)} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="text-[#52627e]">{formatShortDate(bill.createdAt ?? bill.created_at)}</span>
                    <span className="font-semibold text-[#102347]">{String(bill.billNumber ?? bill.billNo ?? "Bill")}</span>
                    <span className={cn("rounded-[7px] px-2 py-[3px] text-[10px] font-black", money(bill.creditAmount) > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
                      {money(bill.creditAmount) > 0 ? "Due" : "Paid"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </RightCard>

          <RightCard title="Customer Notes" action="View all" onAction={() => setActiveTab("notes")}>
            <div className="rounded-[12px] border border-[#e8eef7] bg-[#fbfdff] p-3 text-[12px] leading-5 text-[#344668]">
              {selectedCustomer?.notes || "No notes yet. Add payment preferences, delivery habits, or credit rules from Edit."}
              <p className="mt-3 text-[11px] font-semibold text-[#94a3b8]">Updated {formatShortDate(selectedCustomer?.updatedAt ?? selectedCustomer?.createdAt)}</p>
            </div>
          </RightCard>
        </aside>
      </div>

      <Dialog open={customerOpen} onOpenChange={setCustomerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit customer" : "Add customer"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div><Label>Name *</Label><Input className="mt-1" value={customerForm.name} onChange={(event) => setCustomerForm((form) => ({ ...form, name: event.target.value }))} /></div>
            <div><Label>Phone / number *</Label><Input className="mt-1" value={customerForm.mobile} onChange={(event) => setCustomerForm((form) => ({ ...form, mobile: event.target.value }))} /></div>
            <div className="md:col-span-2"><Label>Address</Label><Input className="mt-1" value={customerForm.address} onChange={(event) => setCustomerForm((form) => ({ ...form, address: event.target.value }))} /></div>
            <div><Label>Customer type</Label><Select value={customerForm.type} onValueChange={(value) => setCustomerForm((form) => ({ ...form, type: value as "regular" | "udhar" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">Regular</SelectItem><SelectItem value="udhar">Udhar allowed</SelectItem></SelectContent></Select></div>
            <div><Label>Udhar limit</Label><Input type="number" className="mt-1" value={customerForm.udharLimit} onChange={(event) => setCustomerForm((form) => ({ ...form, udharLimit: event.target.value }))} /></div>
            <div><Label>Due date</Label><Input type="date" className="mt-1" value={customerForm.dueDate} onChange={(event) => setCustomerForm((form) => ({ ...form, dueDate: event.target.value }))} /></div>
            <div><Label>Promise-to-pay date</Label><Input type="date" className="mt-1" value={customerForm.promiseToPayDate} onChange={(event) => setCustomerForm((form) => ({ ...form, promiseToPayDate: event.target.value }))} /></div>
            <div className="md:col-span-2"><Label>Notes / pricing rule</Label><Textarea className="mt-1" value={customerForm.notes} onChange={(event) => setCustomerForm((form) => ({ ...form, notes: event.target.value }))} placeholder="Example: gives wholesale price for 10kg+" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setCustomerOpen(false)}>Cancel</Button><Button onClick={() => void saveCustomer()} disabled={saving}>{saving ? "Saving..." : "Save locally"}</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record customer payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Customer *</Label><Select value={paymentForm.customerId} onValueChange={(value) => setPaymentForm((form) => ({ ...form, customerId: value }))}><SelectTrigger className="mt-1"><SelectValue placeholder="Select customer" /></SelectTrigger><SelectContent>{dedupedCustomers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name} - {fmtMoney(customer.ledgerBalance)}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Amount *</Label><Input type="number" className="mt-1" value={paymentForm.amount} onChange={(event) => setPaymentForm((form) => ({ ...form, amount: event.target.value }))} /></div>
            <div><Label>Mode</Label><Select value={paymentForm.mode} onValueChange={(value) => setPaymentForm((form) => ({ ...form, mode: value as "cash" | "upi" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem></SelectContent></Select></div>
            <div><Label>Note</Label><Input className="mt-1" value={paymentForm.note} onChange={(event) => setPaymentForm((form) => ({ ...form, note: event.target.value }))} placeholder="Optional" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button onClick={() => void recordPayment()} disabled={saving}>{saving ? "Saving..." : "Record offline"}</Button></div>
        </DialogContent>
      </Dialog>

      <OwnerPinModal
        open={Boolean(deleteTarget)}
        title="Owner PIN required"
        description={`Delete ${deleteTarget?.name ?? "this customer"}? This only moves the customer to recycle bin. Bills, ledger, and payments stay safe.`}
        confirmLabel="Move to recycle bin"
        reasonRequired
        loading={saving}
        error={deleteError}
        onCancel={() => { if (!saving) setDeleteTarget(null); }}
        onConfirm={({ ownerPin, reason }) => void confirmDeleteCustomer(ownerPin, reason)}
      />
    </div>
  );
}

function InfoMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-[#64748b]">{label}</p>
      <p className="mt-1 text-[12px] font-black text-[#102347]">{value}</p>
    </div>
  );
}

function SummaryCell({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="border-b border-[#e8eef7] pb-3 last:border-0 md:border-b-0 md:border-r md:pb-0 md:pr-4 md:last:border-r-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748b]">{label}</p>
      <p className={cn("mt-1 font-display text-[21px] font-black tracking-tight text-[#102347]", valueClass)}>{value}</p>
    </div>
  );
}

function ActionTile({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="rounded-[14px] border border-[#e6ecf4] bg-white p-4 text-center shadow-[0_10px_24px_rgba(15,35,80,0.045)] transition-all hover:-translate-y-0.5 hover:border-[#cfe0ff] hover:bg-[#f8fbff]">
      <span className="mx-auto grid h-10 w-10 place-items-center rounded-[12px] bg-[#eef5ff] text-[#075cf7]">{icon}</span>
      <span className="mt-2 block text-[12px] font-black text-[#102347]">{title}</span>
      <span className="mt-0.5 block text-[10.5px] font-medium text-[#64748b]">{sub}</span>
    </button>
  );
}

function RightCard({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-[#e6ecf4] bg-white p-4 shadow-[0_12px_34px_rgba(15,35,80,0.055)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-[15px] font-black tracking-tight text-[#102347]">{title}</h3>
        {action ? <button onClick={onAction} className="text-[12px] font-black text-[#075cf7] hover:underline">{action}</button> : null}
      </div>
      {children}
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", color)} />
      <span className="min-w-0 flex-1 truncate text-[#52627e]">{label}</span>
      <span className="font-black text-[#102347]">{value}</span>
    </div>
  );
}
