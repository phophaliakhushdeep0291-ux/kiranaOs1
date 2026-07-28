import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, BarChart3, Boxes, CheckCircle2, Download, Pencil, Receipt, ShieldCheck, Truck } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, RowToggle, Kpi } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import type { BillListResult } from "@/types/api";
import { useFeature } from "@/features/subscription";

interface TaxConfig {
  mode: "exclusive" | "inclusive" | "none";
  defaultRate: string;
  gstin: string;
  invoicePrefix: string;
  taxInvoice: boolean;
  composition: boolean;
  rates: Record<string, boolean>;
  eInvoice: boolean;
  eWayBill: boolean;
  showBreakup: boolean;
  roundOff: boolean;
  lockAfterBill: boolean;
  warnInvalidGstin: boolean;
  hsnMappings: HsnRow[];
}
interface HsnRow {
  category: string | null;
  cat: string;
  rate: string;
  hsn: string;
  count: number;
  missingHsn: number;
  invalidHsn: number;
  consistent: boolean;
}
type HsnEditor = { row: HsnRow };
interface HsnSummary {
  categories: Array<{ category: string | null; label: string; productCount: number; hsn: string | null; gstRate: number | null; missingHsn: number; invalidHsn: number; consistent: boolean }>;
}
interface GstReport {
  totalBills: number;
  gstBills: number;
  taxableSales: number;
  gstCollected: number;
  cgst: number;
  sgst: number;
  igst: number;
}
interface ComplianceReadiness {
  score: number;
  legallyReady: boolean;
  provider: { mode: string; providerName?: string | null; configured: boolean; certified?: boolean; legalSubmission: boolean };
  checks: Array<{ key: string; label: string; ready: boolean; detail: string }>;
  gaps: { missingHsn: Array<{ id: string; name: string }>; invalidHsn: Array<{ id: string; name: string }> };
}
interface EWayDraft {
  billId: string;
  transportMode: "road" | "rail" | "air" | "ship";
  transporterId: string;
  transporterName: string;
  vehicleNumber: string;
  vehicleType: "regular" | "over_dimensional";
  distanceKm: string;
  transportDocumentNumber: string;
  transportDocumentDate: string;
  deliveryAddress: string;
}

const DEFAULT_TAX: TaxConfig = {
  // Kirana MRP prices include GST — inclusive is the safe default.
  mode: "inclusive", defaultRate: "18", gstin: "", invoicePrefix: "INV",
  taxInvoice: true, composition: false,
  rates: { "0": true, "5": true, "12": true, "18": true, "28": true },
  eInvoice: false, eWayBill: false, showBreakup: true, roundOff: true, lockAfterBill: true, warnInvalidGstin: true,
  hsnMappings: [],
};
const RATE_INFO: Record<string, string> = { "0": "Exempt / unbranded", "5": "Essentials", "12": "Processed foods", "18": "Standard", "28": "Luxury / sin" };
const EMPTY_EWAY: EWayDraft = { billId: "", transportMode: "road", transporterId: "", transporterName: "", vehicleNumber: "", vehicleType: "regular", distanceKm: "", transportDocumentNumber: "", transportDocumentDate: "", deliveryAddress: "" };

function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function TaxesSettingsPage() {
  const { toast } = useToast();
  const { prefs, patch, shop, hydrated } = useSettingsPrefs();
  const [tax, setTax] = useState<TaxConfig>(DEFAULT_TAX);
  const [hsnEditor, setHsnEditor] = useState<HsnEditor | null>(null);
  const [draftHsn, setDraftHsn] = useState("");
  const [draftRate, setDraftRate] = useState("");
  const [editorError, setEditorError] = useState("");
  const [ewayOpen, setEwayOpen] = useState(false);
  const [ewayPinOpen, setEwayPinOpen] = useState(false);
  const [ewayDraft, setEwayDraft] = useState<EWayDraft>(EMPTY_EWAY);
  const [ewayError, setEwayError] = useState("");
  const [savingEway, setSavingEway] = useState(false);
  const [hsnPinOpen, setHsnPinOpen] = useState(false);
  const [pendingHsn, setPendingHsn] = useState<{ row: HsnRow; hsn: string; gstRate: number } | null>(null);
  const [savingHsn, setSavingHsn] = useState(false);
  const hsnInputRef = useRef<HTMLInputElement>(null);
  const rateInputRef = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);
  const gstReportsFeature = useFeature("gst_reports");
  // Real numbers from stored bills (gst + gstMode persisted per bill).
  const gstQ = useQuery({ queryKey: ["gst-report-month"], queryFn: () => apiRequest<GstReport>("/reports/gst?range=monthly"), enabled: gstReportsFeature.allowed, retry: 1 });
  const readinessQ = useQuery({ queryKey: ["gst-compliance-readiness"], queryFn: () => apiRequest<ComplianceReadiness>("/compliance/readiness"), retry: 1 });
  const hsnSummaryQ = useQuery({ queryKey: ["gst-hsn-summary"], queryFn: () => apiRequest<HsnSummary>("/compliance/hsn-summary"), enabled: gstReportsFeature.allowed, retry: 1 });
  const recentBillsQ = useQuery({ queryKey: ["gst-compliance-recent-bills"], queryFn: () => apiRequest<BillListResult>("/bills?status=active&page=1&limit=50"), enabled: gstReportsFeature.allowed && ewayOpen, retry: 1 });
  const inr = (n?: number) => (n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

  useEffect(() => {
    if (seeded.current || !hydrated) return;
    seeded.current = true;
    const saved = (prefs.taxes ?? {}) as Partial<TaxConfig>;
    setTax({ ...DEFAULT_TAX, ...saved, rates: { ...DEFAULT_TAX.rates, ...(saved.rates ?? {}) }, gstin: saved.gstin ?? shop?.gstNumber ?? "" });
  }, [hydrated, prefs.taxes, shop]);

  const commit = (next: TaxConfig) => { setTax(next); patch({ taxes: next }); };
  const update = (partial: Partial<TaxConfig>) => commit({ ...tax, ...partial });
  const setText = (partial: Partial<TaxConfig>) => setTax((t) => ({ ...t, ...partial }));
  const flush = () => patch({ taxes: tax });
  const hsnRows: HsnRow[] = (hsnSummaryQ.data?.categories ?? []).map((row) => ({
    category: row.category,
    cat: row.label,
    rate: row.gstRate == null ? "Mixed" : `${row.gstRate}%`,
    hsn: row.hsn ?? (row.missingHsn > 0 ? "Missing" : "Mixed"),
    count: row.productCount,
    missingHsn: row.missingHsn,
    invalidHsn: row.invalidHsn,
    consistent: row.consistent,
  }));
  const eligibleBills = (recentBillsQ.data?.bills ?? []).filter((bill) => bill.billType === "gst_invoice");

  const requestEwayApproval = () => {
    if (!ewayDraft.billId || !ewayDraft.distanceKm || !ewayDraft.deliveryAddress.trim() || (!ewayDraft.transporterId.trim() && !ewayDraft.transporterName.trim()) || (ewayDraft.transportMode === "road" && !ewayDraft.vehicleNumber.trim())) {
      setEwayError("Choose a GST invoice and complete transporter, distance, delivery and vehicle details.");
      return;
    }
    setEwayError("");
    setEwayOpen(false);
    setEwayPinOpen(true);
  };

  const saveEwayDraft = async (ownerPin: string) => {
    setSavingEway(true);
    setEwayError("");
    try {
      await apiRequest(`/compliance/e-way-bills/${ewayDraft.billId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ewayDraft, distanceKm: Number(ewayDraft.distanceKm), ownerPin, billId: undefined }),
      });
      setEwayPinOpen(false);
      setEwayDraft(EMPTY_EWAY);
      void readinessQ.refetch();
      toast({ title: "E-way transport record prepared", description: "Saved as a clearly marked draft. Connect a certified GSP to request a legal e-way bill number." });
    } catch (error) {
      setEwayError(error instanceof Error ? error.message : "Could not prepare the transport record.");
    } finally {
      setSavingEway(false);
    }
  };
  const hsnHasError = editorError.includes("HSN code");
  const rateHasError = editorError.includes("GST rate");
  function editHsn(row: HsnRow) {
    setDraftHsn(/^\d+$/.test(row.hsn) ? row.hsn : "");
    setDraftRate(/^\d/.test(row.rate) ? row.rate.replace("%", "") : tax.defaultRate);
    setEditorError("");
    setHsnEditor({ row });
  }
  function saveHsnEditor() {
    if (!hsnEditor) return;
    const rateNumber = Number(draftRate.replace("%", "").trim());
    if (!Number.isFinite(rateNumber) || rateNumber < 0 || rateNumber > 100) {
      setEditorError("Enter a GST rate between 0 and 100.");
      window.requestAnimationFrame(() => rateInputRef.current?.focus());
      return;
    }
    const normalizedRate = `${rateNumber}%`;
    const normalizedHsn = draftHsn.trim();
    if (!/^\d{4}(?:\d{2})?(?:\d{2})?$/.test(normalizedHsn)) {
      setEditorError("Enter a valid 4, 6 or 8 digit HSN code.");
      window.requestAnimationFrame(() => hsnInputRef.current?.focus());
      return;
    }
    setPendingHsn({ row: hsnEditor.row, hsn: normalizedHsn, gstRate: rateNumber });
    setHsnEditor(null);
    setEditorError("");
    setHsnPinOpen(true);
  }
  async function confirmHsnAssignment(ownerPin: string) {
    if (!pendingHsn) return;
    setSavingHsn(true);
    try {
      const result = await apiRequest<{ updatedProducts: number }>("/compliance/hsn-category", { method: "PUT", body: JSON.stringify({ category: pendingHsn.row.category, hsn: pendingHsn.hsn, gstRate: pendingHsn.gstRate, ownerPin }) });
      setHsnPinOpen(false);
      setPendingHsn(null);
      await Promise.all([hsnSummaryQ.refetch(), readinessQ.refetch()]);
      toast({ title: "HSN classification updated", description: `${result.updatedProducts} products now use HSN ${pendingHsn.hsn} at ${pendingHsn.gstRate}%.` });
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Could not update the product category.");
    } finally {
      setSavingHsn(false);
    }
  }
  async function exportGstReport() {
    try {
      const csv = await apiRequest<string>("/compliance/gst-register?range=monthly&format=csv");
      downloadText(`artha-gst-invoice-register-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast({ title: "GST invoice register downloaded", description: "Line-level HSN and tax values are ready for accountant review." });
    } catch (error) {
      toast({ title: "Export unavailable", description: error instanceof Error ? error.message : "Could not export the GST register.", variant: "destructive" });
    }
  }
  async function exportGstr1Working() {
    try {
      const csv = await apiRequest<string>("/compliance/gstr1-working?range=monthly&format=csv");
      downloadText(`artha-gstr1-working-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast({ title: "GSTR-1 working papers downloaded", description: "B2B, B2CS, CDNR, CDNUR and HSN sections include place-of-supply treatment and return netting. Review with your accountant before filing." });
    } catch (error) {
      toast({ title: "Export unavailable", description: error instanceof Error ? error.message : "Could not export GSTR-1 working papers.", variant: "destructive" });
    }
  }

  return (
    <SettingsShell>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* GST Configuration */}
        <Card>
          <CardHead icon={<Receipt size={15} />} title="GST Configuration" sub="How tax applies to your bills" />
          <div className="space-y-3 px-5 pb-5">
            <Fld label="GST Mode" hint={tax.mode !== "none" ? "Changing mode after bills exist needs owner approval." : undefined}>
              <Select value={tax.mode} onValueChange={(v) => update({ mode: v as TaxConfig["mode"] })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No GST</SelectItem>
                  <SelectItem value="inclusive">Inclusive (tax in price)</SelectItem>
                  <SelectItem value="exclusive">Exclusive (add to price)</SelectItem>
                </SelectContent>
              </Select>
            </Fld>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fld label="Default GST Rate">
                <Select value={tax.defaultRate} onValueChange={(v) => update({ defaultRate: v })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{["0", "5", "12", "18", "28"].map((r) => <SelectItem key={r} value={r}>{r}%</SelectItem>)}</SelectContent>
                </Select>
              </Fld>
              <Fld label="Invoice Prefix"><Input className="h-10" value={tax.invoicePrefix} onChange={(e) => setText({ invoicePrefix: e.target.value })} onBlur={flush} /></Fld>
            </div>
            <Fld label="Legal Business GSTIN" hint="Legal identity is managed in Business Profile and validated by the server."><Input className="h-10 bg-slate-50" value={shop?.gstNumber ?? ""} readOnly placeholder="Add GSTIN in Business Profile" /></Fld>
            <RowToggle label="Enable tax invoice" desc="Print GST invoices with breakup" pill={<Switch checked={tax.taxInvoice} onCheckedChange={(v) => update({ taxInvoice: v })} />} />
            <RowToggle label="Composition scheme" desc="Flat-rate dealers (no input credit)" pill={<Switch checked={tax.composition} onCheckedChange={(v) => update({ composition: v })} />} last />
          </div>
        </Card>

        {/* GST Rates */}
        <Card>
          <CardHead icon={<Receipt size={15} />} title="GST Rates" sub="Enable the slabs you sell at" />
          <div className="px-5 pb-4">
            {Object.keys(DEFAULT_TAX.rates).map((r, i, arr) => (
              <div key={r} className={`flex items-center gap-3 py-2.5 ${i < arr.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className="grid h-8 w-12 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[13px] font-black text-[var(--brand)]">{r}%</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[#102347]">{RATE_INFO[r]}</p>
                  <p className="text-[11px] text-[#64748b]">{tax.defaultRate === r ? "Default rate" : "Tap to use on products"}</p>
                </div>
                {tax.defaultRate === r && <Badge tone="blue">Default</Badge>}
                <Switch aria-label={`Enable ${r}% GST rate`} checked={tax.rates[r] ?? false} onCheckedChange={(v) => update({ rates: { ...tax.rates, [r]: v } })} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* HSN / Product Mapping */}
      <Card>
        <CardHead
          icon={<Boxes size={15} />}
          title="HSN / Product Mapping"
          sub="Live classifications from the product catalogue"
          action={gstReportsFeature.allowed
            ? <button type="button" onClick={() => void hsnSummaryQ.refetch()} className="text-[12px] font-bold text-[var(--brand)] hover:underline">Refresh</button>
            : <Button asChild size="sm" variant="outline" className="h-8 text-xs"><Link href="/plans">Upgrade to Business</Link></Button>}
        />
        <div className="px-5 pb-5">
          {!gstReportsFeature.loading && !gstReportsFeature.allowed ? (
            <div className="rounded-[10px] border border-dashed border-[#cbd9ed] bg-[#f8fbff] px-4 py-6 text-center">
              <p className="text-[13px] font-black text-[#17345f]">Business compliance workspace</p>
              <p className="mx-auto mt-1 max-w-xl text-[12px] leading-5 text-[#64748b]">Upgrade to classify taxable products by HSN, measure coverage, and apply owner-approved category mappings.</p>
            </div>
          ) : <div className="app-table-scroll overflow-x-auto rounded-[10px] border border-[#eef2f8]">
            <table className="min-w-[680px] w-full text-[12px]">
              <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">Category</th>
                  <th className="px-3 py-2 text-left font-bold">GST Rate</th>
                  <th className="px-3 py-2 text-left font-bold">HSN Code</th>
                  <th className="px-3 py-2 text-left font-bold">Products</th>
                  <th className="px-3 py-2 text-right font-bold">Action</th>
                </tr>
              </thead>
              <tbody>
                {hsnSummaryQ.isLoading ? <tr><td colSpan={5} className="px-3 py-8 text-center text-[#64748b]">Loading product classifications…</td></tr> : null}
                {!hsnSummaryQ.isLoading && hsnRows.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-[#64748b]">Add products to build the HSN classification summary.</td></tr> : null}
                {hsnRows.map((row, i) => (
                  <tr key={row.cat} className={i < hsnRows.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                    <td className="px-3 py-2.5 font-bold text-[#102347]">{row.cat}</td>
                    <td className="px-3 py-2.5"><Badge tone={row.rate === "Mixed" ? "amber" : "gray"}>{row.rate}</Badge></td>
                    <td className="px-3 py-2.5 font-mono text-[#344668]"><span className="inline-flex items-center gap-2">{row.hsn}{!row.consistent ? <Badge tone="amber">Review</Badge> : <Badge tone="green">Valid</Badge>}</span></td>
                    <td className="px-3 py-2.5 text-[#64748b]">{row.count} products</td>
                    <td className="px-3 py-2.5 text-right"><button type="button" onClick={() => editHsn(row)} aria-label={`Edit GST mapping for ${row.cat}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-bold text-[var(--brand)] hover:bg-[#eef4ff]"><Pencil size={12} aria-hidden="true" /> Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* GST Reports */}
        <Card>
          <CardHead
            icon={<BarChart3 size={15} />}
            title="GST Reports"
            sub="This month"
            action={gstReportsFeature.allowed
              ? <span className="flex items-center gap-3"><button onClick={exportGstReport} className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--brand)] hover:underline"><Download size={12} /> Register</button><button onClick={exportGstr1Working} className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--brand)] hover:underline"><Download size={12} /> GSTR-1 working</button></span>
              : <Button asChild size="sm" variant="outline" className="h-8 text-xs"><Link href="/plans">Upgrade to Business</Link></Button>}
          />
          {!gstReportsFeature.loading && !gstReportsFeature.allowed ? (
            <div className="px-5 pb-5">
              <div className="rounded-[10px] border border-dashed border-[#cbd9ed] bg-[#f8fbff] px-4 py-6 text-center">
                <p className="text-[13px] font-black text-[#17345f]">GST reporting is not in the {gstReportsFeature.plan.name} plan</p>
                <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-[#64748b]">Business adds GST registers, IGST/CGST/SGST totals, credit-note working papers, and accountant-ready CSV exports.</p>
              </div>
            </div>
          ) : <>
            <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2">
              <Kpi label="GST Collected" value={gstQ.isLoading ? "…" : inr(gstQ.data?.gstCollected)} tone="green" />
              <Kpi label="Taxable Sales" value={gstQ.isLoading ? "…" : inr(gstQ.data?.taxableSales)} tone="blue" />
              <Kpi label="GST split" value={gstQ.isLoading ? "…" : gstQ.data ? `C ${inr(gstQ.data.cgst)} · S ${inr(gstQ.data.sgst)} · I ${inr(gstQ.data.igst)}` : "—"} tone="amber" />
              <Kpi label="Bills with GST" value={gstQ.isLoading ? "…" : gstQ.data ? String(gstQ.data.gstBills) : "—"} tone="violet" />
            </div>
            {gstQ.isError && <p className="px-5 pb-4 text-[11px] font-semibold text-rose-600">Could not load this month's GST report: {gstQ.error instanceof Error ? gstQ.error.message : "Please retry."}</p>}
          </>}
        </Card>

        {/* Compliance Settings */}
        <Card>
          <CardHead icon={<ShieldCheck size={15} />} title="Compliance Settings" sub="Accuracy & legal safeguards" />
          <div className="px-5 pb-4">
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-[13px] font-black text-[#102347]">Compliance readiness</p><p className="mt-0.5 text-[11px] text-[#64748b]">Server-validated—not a local preference</p></div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${readinessQ.data?.legallyReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{readinessQ.isLoading ? "Checking…" : `${readinessQ.data?.score ?? 0}%`}</span>
              </div>
              <div className="mt-3 space-y-2">
                {(readinessQ.data?.checks ?? []).map((check) => (
                  <div key={check.key} className="flex items-start gap-2">
                    {check.ready ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />}
                    <div><p className="text-[12px] font-bold text-[#102347]">{check.label}</p><p className="text-[11px] leading-4 text-[#64748b]">{check.detail}</p></div>
                  </div>
                ))}
              </div>
            </div>
            <RowToggle
              label="E-Invoice / IRN"
              desc={readinessQ.data?.provider.legalSubmission
                ? `${readinessQ.data.provider.providerName || "Certified GSP"} is ready for legal submission`
                : readinessQ.data?.provider.configured
                  ? "Sandbox/configuration detected, but legal provider certification is not attested"
                  : "Blocked until a certified GSTN/GSP provider is connected"}
              pill={<Badge tone={readinessQ.data?.provider.legalSubmission ? "green" : readinessQ.data?.provider.configured ? "blue" : "amber"}>{readinessQ.data?.provider.legalSubmission ? "Connected" : readinessQ.data?.provider.configured ? "Sandbox" : "Not connected"}</Badge>}
            />
            <RowToggle label="E-Way Bill" desc="Capture transporter, vehicle, document, distance and delivery details; legal generation requires a certified GSP" pill={gstReportsFeature.allowed ? <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setEwayOpen(true)}><Truck size={13} /> Prepare</Button> : <Button asChild size="sm" variant="outline" className="h-8 text-xs"><Link href="/plans">Upgrade to Business</Link></Button>} />
            <RowToggle label="Show GST breakup on bill" pill={<Switch checked={tax.showBreakup} onCheckedChange={(v) => update({ showBreakup: v })} />} />
            <RowToggle label="Round off tax amount" pill={<Switch checked={tax.roundOff} onCheckedChange={(v) => update({ roundOff: v })} />} />
            <RowToggle label="Lock tax after bill creation" pill={<Switch checked={tax.lockAfterBill} onCheckedChange={(v) => update({ lockAfterBill: v })} />} />
            <RowToggle label="Warn if GSTIN invalid" pill={<Switch checked={tax.warnInvalidGstin} onCheckedChange={(v) => update({ warnInvalidGstin: v })} />} last />
          </div>
        </Card>
      </div>

      <Dialog open={ewayOpen} onOpenChange={setEwayOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Prepare e-way bill transport data</DialogTitle><DialogDescription>This creates an auditable draft against a GST invoice. It does not claim a legal e-way bill number unless a certified GSP is connected and submitted.</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Fld label="GST invoice"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={ewayDraft.billId} onChange={(event) => setEwayDraft((value) => ({ ...value, billId: event.target.value }))}><option value="">Select recent GST invoice</option>{eligibleBills.map((bill) => <option key={bill.id} value={bill.id}>{bill.billNo} · {bill.customerName || "Walk-in"} · ₹{Number(bill.grandTotal || 0).toLocaleString("en-IN")}</option>)}</select>{recentBillsQ.isSuccess && eligibleBills.length === 0 && <p className="mt-1 text-[11px] text-amber-700">No active GST invoices found at this location.</p>}</Fld>
            <Fld label="Transport mode"><Select value={ewayDraft.transportMode} onValueChange={(value: EWayDraft["transportMode"]) => setEwayDraft((draft) => ({ ...draft, transportMode: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="road">Road</SelectItem><SelectItem value="rail">Rail</SelectItem><SelectItem value="air">Air</SelectItem><SelectItem value="ship">Ship</SelectItem></SelectContent></Select></Fld>
            <Fld label="Transporter ID"><Input value={ewayDraft.transporterId} onChange={(event) => setEwayDraft((draft) => ({ ...draft, transporterId: event.target.value.toUpperCase() }))} placeholder="GSTIN / TRANSIN" /></Fld>
            <Fld label="Transporter name"><Input value={ewayDraft.transporterName} onChange={(event) => setEwayDraft((draft) => ({ ...draft, transporterName: event.target.value }))} placeholder="Carrier name" /></Fld>
            <Fld label="Vehicle number"><Input value={ewayDraft.vehicleNumber} onChange={(event) => setEwayDraft((draft) => ({ ...draft, vehicleNumber: event.target.value.toUpperCase() }))} placeholder="MH12AB1234" /></Fld>
            <Fld label="Vehicle type"><Select value={ewayDraft.vehicleType} onValueChange={(value: EWayDraft["vehicleType"]) => setEwayDraft((draft) => ({ ...draft, vehicleType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">Regular</SelectItem><SelectItem value="over_dimensional">Over-dimensional</SelectItem></SelectContent></Select></Fld>
            <Fld label="Distance (km)"><Input type="number" min={1} max={4000} value={ewayDraft.distanceKm} onChange={(event) => setEwayDraft((draft) => ({ ...draft, distanceKm: event.target.value }))} /></Fld>
            <Fld label="Transport document"><Input value={ewayDraft.transportDocumentNumber} onChange={(event) => setEwayDraft((draft) => ({ ...draft, transportDocumentNumber: event.target.value }))} placeholder="LR / RR / airway bill number" /></Fld>
            <Fld label="Document date"><Input type="date" value={ewayDraft.transportDocumentDate} onChange={(event) => setEwayDraft((draft) => ({ ...draft, transportDocumentDate: event.target.value }))} /></Fld>
            <Fld label="Delivery address"><Input value={ewayDraft.deliveryAddress} onChange={(event) => setEwayDraft((draft) => ({ ...draft, deliveryAddress: event.target.value }))} placeholder="Destination address" /></Fld>
          </div>
          {ewayError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{ewayError}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setEwayOpen(false)}>Cancel</Button><Button onClick={requestEwayApproval}>Review and approve</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <OwnerPinModal open={ewayPinOpen} title="Approve e-way transport record" description="This protected compliance record is linked to the selected GST invoice and retained for audit." confirmLabel="Prepare draft" loading={savingEway} error={ewayError} onCancel={() => { if (!savingEway) { setEwayPinOpen(false); setEwayOpen(true); } }} onConfirm={({ ownerPin }) => saveEwayDraft(ownerPin)} />

      <OwnerPinModal open={hsnPinOpen} title="Approve HSN category update" description={pendingHsn ? `Apply HSN ${pendingHsn.hsn} and ${pendingHsn.gstRate}% GST to every active product in ${pendingHsn.row.cat}.` : "Approve the product tax classification update."} confirmLabel="Update products" loading={savingHsn} error={editorError || null} onCancel={() => { if (!savingHsn) { setHsnPinOpen(false); setPendingHsn(null); setEditorError(""); } }} onConfirm={({ ownerPin }) => confirmHsnAssignment(ownerPin)} />

      <Dialog open={Boolean(hsnEditor)} onOpenChange={(open) => { if (!open) { setHsnEditor(null); setEditorError(""); } }}>
        <DialogContent className="max-w-md">
          <form onSubmit={(event) => { event.preventDefault(); saveHsnEditor(); }}>
            <DialogHeader>
              <DialogTitle>{hsnEditor ? `Edit ${hsnEditor.row.cat}` : "Edit HSN classification"}</DialogTitle>
              <DialogDescription>This updates every active product in the selected category and records an owner-approved audit event.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-5">
              <div className="space-y-2">
                <Label htmlFor="hsn-code">HSN code</Label>
                <Input ref={hsnInputRef} id="hsn-code" value={draftHsn} onChange={(event) => { setDraftHsn(event.target.value.replace(/\D/g, "").slice(0, 8)); setEditorError(""); }} inputMode="numeric" autoComplete="off" aria-describedby={hsnHasError ? "hsn-editor-error" : "hsn-code-help"} aria-invalid={hsnHasError || undefined} autoFocus />
                <p id="hsn-code-help" className="text-xs text-muted-foreground">Use the 4, 6 or 8 digit code confirmed by your accountant or GST classification.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="gst-rate">GST rate</Label>
                <div className="relative">
                  <Input ref={rateInputRef} id="gst-rate" value={draftRate} onChange={(event) => { setDraftRate(event.target.value.replace(/[^\d.]/g, "").slice(0, 6)); setEditorError(""); }} inputMode="decimal" autoComplete="off" className="pr-10" aria-describedby={rateHasError ? "hsn-editor-error" : "gst-rate-help"} aria-invalid={rateHasError || undefined} />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-muted-foreground" aria-hidden="true">%</span>
                </div>
                <p id="gst-rate-help" className="text-xs text-muted-foreground">Enter a value from 0 to 100.</p>
              </div>
              {editorError && <p id="hsn-editor-error" role="alert" aria-live="polite" className="rounded-lg bg-destructive/8 px-3 py-2 text-sm font-medium text-destructive">{editorError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setHsnEditor(null)}>Cancel</Button>
              <Button type="submit">Review and approve</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsShell>
  );
}
