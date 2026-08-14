import { useAppLanguage } from "@/features/core/settings/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { SettingsShell } from "@/features/core/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, RowToggle, Kpi } from "@/features/core/settings/ui";
import { useSettingsPrefs } from "@/features/core/settings/use-settings-prefs";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import type { BillListResult } from "@/types/api";
import { useFeature } from "@/features/core/subscription";

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
  registrations: Array<{ locationId: string; code: string; name: string; gstin: string | null; stateCode: string | null; formatValid: boolean; reason: string | null; portalVerified: false }>;
  // Broken across lines deliberately: on one line, a `>` closing one generic and
  // the `<` opening the next read to the hardcoded-string scanner as `>label<`,
  // so the type itself was reported as untranslated prose.
  gaps: {
    invalidRegistrations?: Array<{ locationId: string; name: string; reason: string | null }>;
    missingHsn: Array<{ id: string; name: string }>;
    invalidHsn: Array<{ id: string; name: string }>;
    transferReviewCount?: number;
  };
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
  const { t } = useAppLanguage();
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
  const { t } = useAppLanguage();
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
  const [eInvoiceOpen, setEInvoiceOpen] = useState(false);
  const [eInvoicePinOpen, setEInvoicePinOpen] = useState(false);
  const [eInvoiceBillId, setEInvoiceBillId] = useState("");
  const [eInvoiceError, setEInvoiceError] = useState("");
  const [savingEInvoice, setSavingEInvoice] = useState(false);
  const [hsnPinOpen, setHsnPinOpen] = useState(false);
  const [pendingHsn, setPendingHsn] = useState<{ row: HsnRow; hsn: string; gstRate: number } | null>(null);
  const [savingHsn, setSavingHsn] = useState(false);
  const [selectedSellerGstin, setSelectedSellerGstin] = useState("");
  const hsnInputRef = useRef<HTMLInputElement>(null);
  const rateInputRef = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);
  const gstReportsFeature = useFeature("gst_reports");
  // Real numbers from stored bills (gst + gstMode persisted per bill).
  const gstQ = useQuery({ queryKey: ["gst-report-month"], queryFn: () => apiRequest<GstReport>("/reports/gst?range=monthly"), enabled: gstReportsFeature.allowed, retry: 1 });
  const readinessQ = useQuery({ queryKey: ["gst-compliance-readiness"], queryFn: () => apiRequest<ComplianceReadiness>("/compliance/readiness"), retry: 1 });
  const hsnSummaryQ = useQuery({ queryKey: ["gst-hsn-summary"], queryFn: () => apiRequest<HsnSummary>("/compliance/hsn-summary"), enabled: gstReportsFeature.allowed, retry: 1 });
  const recentBillsQ = useQuery({ queryKey: ["gst-compliance-recent-bills"], queryFn: () => apiRequest<BillListResult>("/bills?status=active&page=1&limit=50"), enabled: gstReportsFeature.allowed && (ewayOpen || eInvoiceOpen), retry: 1 });
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
  const uniqueRegistrations = useMemo(() => {
    const valid = (readinessQ.data?.registrations ?? []).filter((registration) => registration.formatValid && registration.gstin);
    return [...new Map(valid.map((registration) => [registration.gstin as string, registration])).values()];
  }, [readinessQ.data?.registrations]);

  useEffect(() => {
    if (uniqueRegistrations.length === 1 && !selectedSellerGstin) setSelectedSellerGstin(uniqueRegistrations[0].gstin || "");
    if (selectedSellerGstin && !uniqueRegistrations.some((registration) => registration.gstin === selectedSellerGstin)) setSelectedSellerGstin("");
  }, [selectedSellerGstin, uniqueRegistrations]);

  const requireSellerRegistration = () => {
    if (selectedSellerGstin) return selectedSellerGstin;
    toast({ title: t("settings.tax.chooseSeller"), description: t("settings.tax.chooseSellerHelp"), variant: "destructive" });
    return null;
  };

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
      const legalSubmission = readinessQ.data?.provider.legalSubmission === true;
      await apiRequest(`/compliance/e-way-bills/${ewayDraft.billId}/${legalSubmission ? "submit" : "draft"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ewayDraft, distanceKm: Number(ewayDraft.distanceKm), ownerPin, billId: undefined }),
      });
      setEwayPinOpen(false);
      setEwayDraft(EMPTY_EWAY);
      void readinessQ.refetch();
      toast(legalSubmission
        ? { title: t("settings.tax.ewaySubmitted"), description: `The request was accepted by ${readinessQ.data?.provider.providerName || "the configured certified GSP"}.` }
        : { title: t("settings.tax.ewayDraftPrepared"), description: t("settings.tax.ewayDraftNote") });
    } catch (error) {
      setEwayError(error instanceof Error ? error.message : t("settings.tax.ewayFailed"));
    } finally {
      setSavingEway(false);
    }
  };
  async function submitEInvoice(ownerPin: string) {
    if (!eInvoiceBillId) return;
    setSavingEInvoice(true);
    setEInvoiceError("");
    try {
      const legalSubmission = readinessQ.data?.provider.legalSubmission === true;
      const endpoint = legalSubmission ? "submit" : "sandbox";
      await apiRequest(`/compliance/e-invoices/${eInvoiceBillId}/${endpoint}`, { method: "POST", body: JSON.stringify({ ownerPin }) });
      setEInvoicePinOpen(false);
      setEInvoiceBillId("");
      void readinessQ.refetch();
      toast(legalSubmission
        ? { title: t("settings.tax.eInvoiceSubmitted"), description: `The certified provider accepted the request for IRN generation.` }
        : { title: t("settings.tax.eInvoiceSandbox"), description: t("settings.tax.eInvoiceSandboxNote") });
    } catch (error) {
      setEInvoiceError(error instanceof Error ? error.message : t("settings.tax.eInvoiceFailed"));
    } finally {
      setSavingEInvoice(false);
    }
  }
  const hsnHasError = editorError.includes(t("settings.tax.hsnCodeLower"));
  const rateHasError = editorError.includes(t("settings.tax.gstRateLower"));
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
      toast({ title: t("settings.tax.hsnUpdated"), description: `${result.updatedProducts} products now use HSN ${pendingHsn.hsn} at ${pendingHsn.gstRate}%.` });
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : t("settings.tax.categoryUpdateFailed"));
    } finally {
      setSavingHsn(false);
    }
  }
  async function exportGstReport() {
    const sellerGstin = requireSellerRegistration();
    if (!sellerGstin) return;
    try {
      const csv = await apiRequest<string>(`/compliance/gst-register?range=monthly&format=csv&sellerGstin=${encodeURIComponent(sellerGstin)}`);
      downloadText(`artha-gst-register-${sellerGstin}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast({ title: t("settings.tax.registerDownloaded"), description: `${sellerGstin} only · seller snapshots, HSN, and tax values are ready for accountant review.` });
    } catch (error) {
      toast({ title: t("settings.tax.exportUnavailable"), description: error instanceof Error ? error.message : t("settings.tax.registerExportFailed"), variant: "destructive" });
    }
  }
  async function exportGstr1Working() {
    const sellerGstin = requireSellerRegistration();
    if (!sellerGstin) return;
    try {
      const csv = await apiRequest<string>(`/compliance/gstr1-working?range=monthly&format=csv&sellerGstin=${encodeURIComponent(sellerGstin)}`);
      downloadText(`artha-gstr1-working-${sellerGstin}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast({ title: t("settings.tax.gstr1Downloaded"), description: `${sellerGstin} only · review B2B, B2CS, credit-note, HSN, and place-of-supply treatment with your accountant before filing.` });
    } catch (error) {
      toast({ title: t("settings.tax.exportUnavailable"), description: error instanceof Error ? error.message : t("settings.tax.gstr1ExportFailed"), variant: "destructive" });
    }
  }

  return (
    <SettingsShell>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* GST Configuration */}
        <Card>
          <CardHead icon={<Receipt size={15} />} title={t("settings.tax.cfgTitle")} sub={t("settings.tax.cfgSub")} />
          <div className="space-y-3 px-5 pb-5">
            <Fld label={t("settings.tax.modeLabel")} hint={tax.mode !== "none" ? t("settings.tax.modeChangeHelp") : undefined}>
              <Select value={tax.mode} onValueChange={(v) => update({ mode: v as TaxConfig["mode"] })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("settings.tax.noGst")}</SelectItem>
                  <SelectItem value="inclusive">{t("settings.tax.inclusive")}</SelectItem>
                  <SelectItem value="exclusive">{t("settings.tax.exclusive")}</SelectItem>
                </SelectContent>
              </Select>
            </Fld>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fld label={t("settings.tax.defaultRate")}>
                <Select value={tax.defaultRate} onValueChange={(v) => update({ defaultRate: v })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{["0", "5", "12", "18", "28"].map((r) => <SelectItem key={r} value={r}>{r}%</SelectItem>)}</SelectContent>
                </Select>
              </Fld>
              <Fld label={t("settings.tax.invoicePrefix")}><Input className="h-10" value={tax.invoicePrefix} onChange={(e) => setText({ invoicePrefix: e.target.value })} onBlur={flush} /></Fld>
            </div>
            <Fld label={t("settings.tax.legalGstin")} hint={t("settings.tax.legalGstinHelp")}><Input className="h-10 bg-slate-50" value={shop?.gstNumber ?? ""} readOnly placeholder={t("settings.tax.addGstinPlaceholder")} /></Fld>
            <RowToggle label={t("settings.tax.enableTaxInvoice")} desc={t("settings.tax.enableTaxInvoiceHelp")} pill={<Switch checked={tax.taxInvoice} onCheckedChange={(v) => update({ taxInvoice: v })} />} />
            <RowToggle label={t("settings.tax.composition")} desc={t("settings.tax.compositionHelp")} pill={<Switch checked={tax.composition} onCheckedChange={(v) => update({ composition: v })} />} last />
          </div>
        </Card>

        {/* GST Rates */}
        <Card>
          <CardHead icon={<Receipt size={15} />} title={t("settings.tax.ratesTitle")} sub={t("settings.tax.ratesSub")} />
          <div className="px-5 pb-4">
            {Object.keys(DEFAULT_TAX.rates).map((r, i, arr) => (
              <div key={r} className={`flex items-center gap-3 py-2.5 ${i < arr.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className="grid h-8 w-12 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[13px] font-black text-[var(--brand)]">{r}%</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[var(--brand-ink)]">{RATE_INFO[r]}</p>
                  <p className="text-[11px] text-[#64748b]">{tax.defaultRate === r ? "Default rate" : "Tap to use on products"}</p>
                </div>
                {tax.defaultRate === r && <Badge tone="blue">{t("settings.tax.default")}</Badge>}
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
          title={t("settings.tax.hsnTitle")}
          sub={t("settings.tax.hsnSub")}
          action={gstReportsFeature.allowed
            ? <button type="button" onClick={() => void hsnSummaryQ.refetch()} className="text-[12px] font-bold text-[var(--brand)] hover:underline">{t("settings.tax.refresh")}</button>
            : <Button asChild size="sm" variant="outline" className="h-8 text-xs"><Link href="/plans">{t("settings.tax.upgradeBusiness")}</Link></Button>}
        />
        <div className="px-5 pb-5">
          {!gstReportsFeature.loading && !gstReportsFeature.allowed ? (
            <div className="rounded-[10px] border border-dashed border-[#cbd9ed] bg-[#f8fbff] px-4 py-6 text-center">
              <p className="text-[13px] font-black text-[#17345f]">{t("settings.tax.workspace")}</p>
              <p className="mx-auto mt-1 max-w-xl text-[12px] leading-5 text-[#64748b]">{t("settings.tax.workspaceHelp")}</p>
            </div>
          ) : <div className="app-table-scroll overflow-x-auto rounded-[10px] border border-[#eef2f8]">
            <table className="min-w-[680px] w-full text-[12px]">
              <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">{t("settings.tax.category")}</th>
                  <th className="px-3 py-2 text-left font-bold">{t("settings.tax.gstRate")}</th>
                  <th className="px-3 py-2 text-left font-bold">{t("settings.tax.hsnCode")}</th>
                  <th className="px-3 py-2 text-left font-bold">{t("settings.tax.products")}</th>
                  <th className="px-3 py-2 text-right font-bold">{t("settings.tax.action")}</th>
                </tr>
              </thead>
              <tbody>
                {hsnSummaryQ.isLoading ? <tr><td colSpan={5} className="px-3 py-8 text-center text-[#64748b]">{t("settings.tax.loadingClassifications")}</td></tr> : null}
                {!hsnSummaryQ.isLoading && hsnRows.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-[#64748b]">{t("settings.tax.addProductsFirst")}</td></tr> : null}
                {hsnRows.map((row, i) => (
                  <tr key={row.cat} className={i < hsnRows.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                    <td className="px-3 py-2.5 font-bold text-[var(--brand-ink)]">{row.cat}</td>
                    <td className="px-3 py-2.5"><Badge tone={row.rate === "Mixed" ? "amber" : "gray"}>{row.rate}</Badge></td>
                    <td className="px-3 py-2.5 font-mono text-[#344668]"><span className="inline-flex items-center gap-2">{row.hsn}{!row.consistent ? <Badge tone="amber">{t("settings.tax.review")}</Badge> : <Badge tone="green">{t("settings.tax.valid")}</Badge>}</span></td>
                    <td className="px-3 py-2.5 text-[#64748b]">{row.count} products</td>
                    <td className="px-3 py-2.5 text-right"><button type="button" onClick={() => editHsn(row)} aria-label={`Edit GST mapping for ${row.cat}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-bold text-[var(--brand)] hover:bg-[var(--brand-soft)]"><Pencil size={12} aria-hidden="true" /> {t("settings.tax.edit")}</button></td>
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
            title={t("settings.tax.reportsTitle")}
            sub={t("settings.tax.thisMonth")}
            action={gstReportsFeature.allowed
              ? <span className="flex items-center gap-3"><button onClick={exportGstReport} className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--brand)] hover:underline"><Download size={12} /> {t("settings.tax.register")}</button><button onClick={exportGstr1Working} className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--brand)] hover:underline"><Download size={12} /> {t("settings.tax.gstr1Working")}</button></span>
              : <Button asChild size="sm" variant="outline" className="h-8 text-xs"><Link href="/plans">{t("settings.tax.upgradeBusiness")}</Link></Button>}
          />
          {!gstReportsFeature.loading && !gstReportsFeature.allowed ? (
            <div className="px-5 pb-5">
              <div className="rounded-[10px] border border-dashed border-[#cbd9ed] bg-[#f8fbff] px-4 py-6 text-center">
                <p className="text-[13px] font-black text-[#17345f]">GST reporting is not in the {gstReportsFeature.plan.name} plan</p>
                <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-[#64748b]">{t("settings.tax.registersHelp")}</p>
              </div>
            </div>
          ) : <>
            <div className="px-5 pb-4">
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                <Label htmlFor="gst-registration-scope" className="text-xs font-black text-[#17345f]">{t("settings.tax.sellerForExport")}</Label>
                <Select value={selectedSellerGstin} onValueChange={setSelectedSellerGstin}>
                  <SelectTrigger id="gst-registration-scope" className="mt-2 h-10 bg-white"><SelectValue placeholder={t("settings.tax.chooseSellerPlaceholder")} /></SelectTrigger>
                  <SelectContent>{uniqueRegistrations.map((registration) => <SelectItem key={registration.gstin} value={registration.gstin || ""}>{registration.gstin} · {registration.name} · State {registration.stateCode}</SelectItem>)}</SelectContent>
                </Select>
                <p className="mt-2 text-[11px] leading-4 text-[#64748b]">{t("settings.tax.sellerHelp")}</p>
                {!readinessQ.isLoading && uniqueRegistrations.length === 0 && <p className="mt-2 text-[11px] font-bold text-rose-700">{t("settings.tax.noValidSeller")}</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2">
              <Kpi label={t("settings.tax.gstCollected")} value={gstQ.isLoading ? "…" : inr(gstQ.data?.gstCollected)} tone="green" />
              <Kpi label={t("settings.tax.taxableSales")} value={gstQ.isLoading ? "…" : inr(gstQ.data?.taxableSales)} tone="blue" />
              <Kpi label={t("settings.tax.gstSplit")} value={gstQ.isLoading ? "…" : gstQ.data ? `C ${inr(gstQ.data.cgst)} · S ${inr(gstQ.data.sgst)} · I ${inr(gstQ.data.igst)}` : "—"} tone="amber" />
              <Kpi label={t("settings.tax.billsWithGst")} value={gstQ.isLoading ? "…" : gstQ.data ? String(gstQ.data.gstBills) : "—"} tone="violet" />
            </div>
            {gstQ.isError && <p className="px-5 pb-4 text-[11px] font-semibold text-rose-600">Could not load this month's GST report: {gstQ.error instanceof Error ? gstQ.error.message : t("settings.tax.pleaseRetry")}</p>}
          </>}
        </Card>

        {/* Compliance Settings */}
        <Card>
          <CardHead icon={<ShieldCheck size={15} />} title={t("settings.tax.complianceTitle")} sub={t("settings.tax.complianceSub")} />
          <div className="px-5 pb-4">
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-[13px] font-black text-[var(--brand-ink)]">{t("settings.tax.readiness")}</p><p className="mt-0.5 text-[11px] text-[#64748b]">{t("settings.tax.serverValidated")}</p></div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${readinessQ.data?.legallyReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{readinessQ.isLoading ? "Checking…" : `${readinessQ.data?.score ?? 0}%`}</span>
              </div>
              <div className="mt-3 space-y-2">
                {(readinessQ.data?.checks ?? []).map((check) => (
                  <div key={check.key} className="flex items-start gap-2">
                    {check.ready ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />}
                    <div><p className="text-[12px] font-bold text-[var(--brand-ink)]">{check.label}</p><p className="text-[11px] leading-4 text-[#64748b]">{check.detail}</p></div>
                  </div>
                ))}
              </div>
            </div>
            <RowToggle
              label={t("settings.tax.eInvoice")}
              desc={readinessQ.data?.provider.legalSubmission
                ? `${readinessQ.data.provider.providerName || t("settings.tax.certifiedGsp")} is ready for legal submission`
                : readinessQ.data?.provider.configured
                  ? t("settings.tax.gspNotAttested")
                  : t("settings.tax.gspBlocked")}
              pill={readinessQ.data?.provider.configured && gstReportsFeature.allowed
                ? <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => { setEInvoiceError(""); setEInvoiceOpen(true); }}><Receipt size={13} /> {readinessQ.data.provider.legalSubmission ? "Submit" : "Validate"}</Button>
                : <Badge tone="amber">{t("settings.tax.notConnected")}</Badge>}
            />
            <RowToggle label={t("settings.tax.ewayBill")} desc={t("settings.tax.ewayBillHelp")} pill={gstReportsFeature.allowed ? <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setEwayOpen(true)}><Truck size={13} /> {t("settings.tax.prepare")}</Button> : <Button asChild size="sm" variant="outline" className="h-8 text-xs"><Link href="/plans">{t("settings.tax.upgradeBusiness")}</Link></Button>} />
            <RowToggle label={t("settings.tax.showBreakup")} pill={<Switch checked={tax.showBreakup} onCheckedChange={(v) => update({ showBreakup: v })} />} />
            <RowToggle label={t("settings.tax.roundOff")} pill={<Switch checked={tax.roundOff} onCheckedChange={(v) => update({ roundOff: v })} />} />
            <RowToggle label={t("settings.tax.lockTax")} pill={<Switch checked={tax.lockAfterBill} onCheckedChange={(v) => update({ lockAfterBill: v })} />} />
            <RowToggle label={t("settings.tax.warnInvalidGstin")} pill={<Switch checked={tax.warnInvalidGstin} onCheckedChange={(v) => update({ warnInvalidGstin: v })} />} last />
          </div>
        </Card>
      </div>

      <Dialog open={ewayOpen} onOpenChange={setEwayOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t("settings.tax.prepareEway")}</DialogTitle><DialogDescription>{t("settings.tax.prepareEwayHelp")}</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Fld label={t("settings.tax.gstInvoice")}><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={ewayDraft.billId} onChange={(event) => setEwayDraft((value) => ({ ...value, billId: event.target.value }))}><option value="">{t("settings.tax.selectInvoice")}</option>{eligibleBills.map((bill) => <option key={bill.id} value={bill.id}>{bill.billNo} · {bill.customerName || "Walk-in"} · ₹{Number(bill.grandTotal || 0).toLocaleString("en-IN")}</option>)}</select>{recentBillsQ.isSuccess && eligibleBills.length === 0 && <p className="mt-1 text-[11px] text-amber-700">{t("settings.tax.noInvoices")}</p>}</Fld>
            <Fld label={t("settings.tax.transportMode")}><Select value={ewayDraft.transportMode} onValueChange={(value: EWayDraft["transportMode"]) => setEwayDraft((draft) => ({ ...draft, transportMode: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="road">{t("settings.tax.road")}</SelectItem><SelectItem value="rail">{t("settings.tax.rail")}</SelectItem><SelectItem value="air">{t("settings.tax.air")}</SelectItem><SelectItem value="ship">{t("settings.tax.ship")}</SelectItem></SelectContent></Select></Fld>
            <Fld label={t("settings.tax.transporterId")}><Input value={ewayDraft.transporterId} onChange={(event) => setEwayDraft((draft) => ({ ...draft, transporterId: event.target.value.toUpperCase() }))} placeholder={t("settings.tax.transporterIdPlaceholder")} /></Fld>
            <Fld label={t("manufacturing.orders.transporter")}><Input value={ewayDraft.transporterName} onChange={(event) => setEwayDraft((draft) => ({ ...draft, transporterName: event.target.value }))} placeholder={t("settings.tax.carrierName")} /></Fld>
            <Fld label={t("manufacturing.orders.vehicle")}><Input value={ewayDraft.vehicleNumber} onChange={(event) => setEwayDraft((draft) => ({ ...draft, vehicleNumber: event.target.value.toUpperCase() }))} placeholder="MH12AB1234" /></Fld>
            <Fld label={t("settings.tax.vehicleType")}><Select value={ewayDraft.vehicleType} onValueChange={(value: EWayDraft["vehicleType"]) => setEwayDraft((draft) => ({ ...draft, vehicleType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">{t("settings.tax.regular")}</SelectItem><SelectItem value="over_dimensional">{t("settings.tax.overDimensional")}</SelectItem></SelectContent></Select></Fld>
            <Fld label={t("settings.tax.distanceKm")}><Input type="number" min={1} max={4000} value={ewayDraft.distanceKm} onChange={(event) => setEwayDraft((draft) => ({ ...draft, distanceKm: event.target.value }))} /></Fld>
            <Fld label={t("settings.tax.transportDoc")}><Input value={ewayDraft.transportDocumentNumber} onChange={(event) => setEwayDraft((draft) => ({ ...draft, transportDocumentNumber: event.target.value }))} placeholder={t("settings.tax.transportDocPlaceholder")} /></Fld>
            <Fld label={t("settings.tax.documentDate")}><Input type="date" value={ewayDraft.transportDocumentDate} onChange={(event) => setEwayDraft((draft) => ({ ...draft, transportDocumentDate: event.target.value }))} /></Fld>
            <Fld label={t("settings.tax.deliveryAddress")}><Input value={ewayDraft.deliveryAddress} onChange={(event) => setEwayDraft((draft) => ({ ...draft, deliveryAddress: event.target.value }))} placeholder={t("settings.tax.destinationPlaceholder")} /></Fld>
          </div>
          {ewayError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{ewayError}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setEwayOpen(false)}>{t("settings.tax.cancel")}</Button><Button onClick={requestEwayApproval}>{t("settings.tax.reviewApprove")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={eInvoiceOpen} onOpenChange={setEInvoiceOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{readinessQ.data?.provider.legalSubmission ? "Submit GST e-invoice" : "Validate e-invoice in sandbox"}</DialogTitle>
            <DialogDescription>{readinessQ.data?.provider.legalSubmission ? `Send one GST invoice to ${readinessQ.data.provider.providerName || "the configured certified GSP"} for legal IRN generation.` : "Validate the invoice payload and retain audit evidence. Sandbox validation does not create a legal IRN."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="e-invoice-bill">{t("settings.tax.gstInvoice")}</Label>
            <select id="e-invoice-bill" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={eInvoiceBillId} onChange={(event) => setEInvoiceBillId(event.target.value)}>
              <option value="">{t("settings.tax.selectInvoice")}</option>
              {eligibleBills.map((bill) => <option key={bill.id} value={bill.id}>{bill.billNo} · {bill.customerName || "Walk-in"} · ₹{Number(bill.grandTotal || 0).toLocaleString("en-IN")}</option>)}
            </select>
            {eInvoiceError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{eInvoiceError}</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEInvoiceOpen(false)}>{t("settings.tax.cancel")}</Button><Button disabled={!eInvoiceBillId} onClick={() => { setEInvoiceOpen(false); setEInvoicePinOpen(true); }}>{t("settings.tax.reviewApprove")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <OwnerPinModal open={ewayPinOpen} title={readinessQ.data?.provider.legalSubmission ? t("settings.tax.approveEwaySubmit") : t("settings.tax.approveEwayDraft")} description={readinessQ.data?.provider.legalSubmission ? t("settings.tax.ewaySubmitHelp") : t("settings.tax.ewayDraftHelp")} confirmLabel={readinessQ.data?.provider.legalSubmission ? t("settings.tax.submitEway") : t("settings.tax.prepareDraft")} loading={savingEway} error={ewayError} onCancel={() => { if (!savingEway) { setEwayPinOpen(false); setEwayOpen(true); } }} onConfirm={({ ownerPin }) => saveEwayDraft(ownerPin)} />

      <OwnerPinModal open={eInvoicePinOpen} title={readinessQ.data?.provider.legalSubmission ? t("settings.tax.approveEInvoiceSubmit") : t("settings.tax.approveSandbox")} description={readinessQ.data?.provider.legalSubmission ? t("settings.tax.eInvoiceSubmitHelp") : t("settings.tax.sandboxHelp")} confirmLabel={readinessQ.data?.provider.legalSubmission ? t("settings.tax.submitEInvoice") : t("settings.tax.validateInvoice")} loading={savingEInvoice} error={eInvoiceError} onCancel={() => { if (!savingEInvoice) { setEInvoicePinOpen(false); setEInvoiceOpen(true); } }} onConfirm={({ ownerPin }) => submitEInvoice(ownerPin)} />

      <OwnerPinModal open={hsnPinOpen} title={t("settings.tax.approveHsn")} description={pendingHsn ? `Apply HSN ${pendingHsn.hsn} and ${pendingHsn.gstRate}% GST to every active product in ${pendingHsn.row.cat}.` : t("settings.tax.approveClassification")} confirmLabel={t("settings.tax.updateProducts")} loading={savingHsn} error={editorError || null} onCancel={() => { if (!savingHsn) { setHsnPinOpen(false); setPendingHsn(null); setEditorError(""); } }} onConfirm={({ ownerPin }) => confirmHsnAssignment(ownerPin)} />

      <Dialog open={Boolean(hsnEditor)} onOpenChange={(open) => { if (!open) { setHsnEditor(null); setEditorError(""); } }}>
        <DialogContent className="max-w-md">
          <form onSubmit={(event) => { event.preventDefault(); saveHsnEditor(); }}>
            <DialogHeader>
              <DialogTitle>{hsnEditor ? `Edit ${hsnEditor.row.cat}` : "Edit HSN classification"}</DialogTitle>
              <DialogDescription>{t("settings.tax.categoryUpdateHelp")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-5">
              <div className="space-y-2">
                <Label htmlFor="hsn-code">{t("settings.tax.hsnCodeLower")}</Label>
                <Input ref={hsnInputRef} id="hsn-code" value={draftHsn} onChange={(event) => { setDraftHsn(event.target.value.replace(/\D/g, "").slice(0, 8)); setEditorError(""); }} inputMode="numeric" autoComplete="off" aria-describedby={hsnHasError ? "hsn-editor-error" : "hsn-code-help"} aria-invalid={hsnHasError || undefined} autoFocus />
                <p id="hsn-code-help" className="text-xs text-muted-foreground">{t("settings.tax.hsnHelp")}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="gst-rate">{t("settings.tax.gstRateLower")}</Label>
                <div className="relative">
                  <Input ref={rateInputRef} id="gst-rate" value={draftRate} onChange={(event) => { setDraftRate(event.target.value.replace(/[^\d.]/g, "").slice(0, 6)); setEditorError(""); }} inputMode="decimal" autoComplete="off" className="pr-10" aria-describedby={rateHasError ? "hsn-editor-error" : "gst-rate-help"} aria-invalid={rateHasError || undefined} />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-muted-foreground" aria-hidden="true">%</span>
                </div>
                <p id="gst-rate-help" className="text-xs text-muted-foreground">{t("settings.tax.rateRangeHelp")}</p>
              </div>
              {editorError && <p id="hsn-editor-error" role="alert" aria-live="polite" className="rounded-lg bg-destructive/8 px-3 py-2 text-sm font-medium text-destructive">{editorError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setHsnEditor(null)}>{t("settings.tax.cancel")}</Button>
              <Button type="submit">{t("settings.tax.reviewApprove")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsShell>
  );
}
