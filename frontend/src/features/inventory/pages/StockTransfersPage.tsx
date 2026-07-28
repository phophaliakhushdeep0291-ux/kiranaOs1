import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowRightLeft, BadgeCheck, Building2, CheckCircle2, FileText, IndianRupee, Landmark, MapPin, Package, Plus, ReceiptText, ShieldCheck, TriangleAlert } from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface TaxRegistration {
  status: "format_valid" | "invalid" | "unregistered";
  formatValid: boolean;
  gstin?: string | null;
  stateCode?: string | null;
  notice: string;
}

interface Location {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  city?: string | null;
  gstNumber?: string | null;
  gstStateCode?: string | null;
  gstLegalName?: string | null;
  gstTradeName?: string | null;
  gstRegistrationType?: string | null;
  taxRegistration?: TaxRegistration;
  isPrimary: boolean;
  active: boolean;
  _count?: { stocks: number; outgoingTransfers: number; incomingTransfers: number };
}

interface LocationsResponse { locations: Location[]; usage: { current: number; maximum: number } }
interface LocationProduct { id: string; name: string; baseUnit: string; displayUnit: string; stockBaseQty: number; allocationWarning: boolean; hsn?: string | null; gstRate?: number }
interface LocationInventory { location: Location; products: LocationProduct[] }
interface TransferItem { id: string; productName: string; quantityBaseQty: number; baseUnit: string; hsn?: string | null; gstRate: number; taxableValue: number; taxTotal: number; totalValue: number }
interface Transfer {
  id: string;
  referenceNo: string;
  status: string;
  note?: string | null;
  movementReason: string;
  gstTreatment: "unregistered_internal" | "same_registration_movement" | "distinct_registration_supply";
  documentType?: string | null;
  documentNumber?: string | null;
  documentDate?: string | null;
  fromGstin?: string | null;
  toGstin?: string | null;
  isInterstate: boolean;
  complianceStatus: string;
  eWayReviewRequired: boolean;
  taxableValue: number;
  taxTotal: number;
  consignmentValue: number;
  legalSubmissionStatus: "not_submitted";
  complianceNotice: string;
  completedAt?: string | null;
  createdAt: string;
  fromLocation: Location;
  toLocation: Location;
  items: TransferItem[];
}

type RegistrationMode = "inherit" | "distinct" | "unregistered";
type TransferTreatment = "pending" | "incomplete" | Transfer["gstTreatment"];

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.05)]";
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const today = () => { const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 10); };
function treatmentLabel(value: TransferTreatment) {
  if (value === "same_registration_movement") return "Same GST registration";
  if (value === "distinct_registration_supply") return "Distinct-registration supply";
  if (value === "unregistered_internal") return "Unregistered internal movement";
  if (value === "incomplete") return "Registration details incomplete";
  return "Choose both locations";
}
function treatmentTone(value: TransferTreatment) {
  if (value === "distinct_registration_supply") return "border-violet-200 bg-violet-50 text-violet-800";
  if (value === "same_registration_movement") return "border-blue-200 bg-blue-50 text-blue-800";
  if (value === "unregistered_internal") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}
function registrationStatus(location: Location): TaxRegistration {
  if (location.taxRegistration) return location.taxRegistration;
  return { status: location.gstNumber ? "invalid" : "unregistered", formatValid: false, gstin: location.gstNumber, stateCode: location.gstStateCode, notice: location.gstNumber ? "Registration needs review." : "No GSTIN assigned." };
}

export default function StockTransfersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [transferOpen, setTransferOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [declaredTaxableValue, setDeclaredTaxableValue] = useState("");
  const [movementReason, setMovementReason] = useState("branch_transfer");
  const [documentNumber, setDocumentNumber] = useState("");
  const [documentDate, setDocumentDate] = useState(today());
  const [note, setNote] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [locationCity, setLocationCity] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>("inherit");
  const [locationGstin, setLocationGstin] = useState("");
  const [locationLegalName, setLocationLegalName] = useState("");
  const [locationTradeName, setLocationTradeName] = useState("");

  const locationsQ = useQuery({ queryKey: ["store-locations"], queryFn: () => apiRequest<LocationsResponse>("/stores") });
  const transfersQ = useQuery({ queryKey: ["stock-transfers"], queryFn: () => apiRequest<Transfer[]>("/stores/transfers?limit=100") });
  const sourceQ = useQuery({ queryKey: ["location-inventory", fromId], queryFn: () => apiRequest<LocationInventory>(`/stores/${fromId}/inventory`), enabled: Boolean(fromId) });

  const locations = (locationsQ.data?.locations ?? []).filter((row) => row.active);
  const fromLocation = locations.find((row) => row.id === fromId);
  const toLocation = locations.find((row) => row.id === toId);
  const selectedProduct = sourceQ.data?.products.find((row) => row.id === productId);
  const allocationWarnings = useMemo(() => sourceQ.data?.products.filter((row) => row.allocationWarning) ?? [], [sourceQ.data]);
  const eWayReviewCount = (transfersQ.data ?? []).filter((row) => row.eWayReviewRequired).length;
  const treatment = useMemo<TransferTreatment>(() => {
    if (!fromLocation || !toLocation) return "pending";
    const source = registrationStatus(fromLocation); const destination = registrationStatus(toLocation);
    if (source.formatValid && destination.formatValid) return source.gstin === destination.gstin ? "same_registration_movement" : "distinct_registration_supply";
    if (source.status === "unregistered" && destination.status === "unregistered") return "unregistered_internal";
    return "incomplete";
  }, [fromLocation, toLocation]);
  const registeredTransfer = treatment === "same_registration_movement" || treatment === "distinct_registration_supply";
  const distinctSupply = treatment === "distinct_registration_supply";
  const taxableValue = Number(declaredTaxableValue) || 0;
  const estimatedTax = distinctSupply ? Math.round(taxableValue * Number(selectedProduct?.gstRate || 0)) / 100 : 0;
  const estimatedConsignment = Math.round((taxableValue + estimatedTax) * 100) / 100;
  const hsnValid = !registeredTransfer || Number(selectedProduct?.gstRate || 0) <= 0 || /^\d{4}(?:\d{2})?(?:\d{2})?$/.test(selectedProduct?.hsn || "");
  const transferReady = treatment !== "pending" && treatment !== "incomplete" && (!registeredTransfer || taxableValue > 0) && (!distinctSupply || (documentNumber.trim().length > 0 && Boolean(documentDate))) && hsnValid;

  const resetTransfer = () => { setProductId(""); setQuantity(""); setDeclaredTaxableValue(""); setMovementReason("branch_transfer"); setDocumentNumber(""); setDocumentDate(today()); setNote(""); setOwnerPin(""); };
  const transferMutation = useMutation({
    mutationFn: () => apiRequest<Transfer>("/stores/transfers", { method: "POST", ownerPin, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromLocationId: fromId, toLocationId: toId, movementReason, documentType: distinctSupply ? "tax_invoice" : treatment === "same_registration_movement" ? "delivery_challan" : undefined, documentNumber: distinctSupply ? documentNumber.trim() : undefined, documentDate: distinctSupply ? documentDate : undefined, items: [{ productId, quantityBaseQty: Number(quantity), declaredTaxableValue: registeredTransfer ? taxableValue : undefined }], note: note || undefined, ownerPin }) }),
    onSuccess: (data) => { void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] }); void queryClient.invalidateQueries({ queryKey: ["location-inventory"] }); setTransferOpen(false); resetTransfer(); toast({ title: "Stock transfer completed", description: data.documentNumber ? `${data.documentNumber} recorded · ${treatmentLabel(data.gstTreatment)}` : `${data.referenceNo} recorded in both locations.` }); },
    onError: (error: Error) => toast({ title: "Transfer not completed", description: error.message, variant: "destructive" }),
  });
  const resetLocation = () => { setLocationName(""); setLocationCode(""); setLocationCity(""); setLocationAddress(""); setRegistrationMode("inherit"); setLocationGstin(""); setLocationLegalName(""); setLocationTradeName(""); };
  const locationMutation = useMutation({
    mutationFn: () => apiRequest<Location>("/stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: locationName, code: locationCode, city: locationCity || undefined, address: locationAddress || undefined, ...(registrationMode === "distinct" ? { gstNumber: locationGstin, gstLegalName: locationLegalName || undefined, gstTradeName: locationTradeName || undefined, gstRegistrationType: "regular" } : registrationMode === "unregistered" ? { gstNumber: null, gstRegistrationType: "unregistered" } : {}) }) }),
    onSuccess: (data) => { void queryClient.invalidateQueries({ queryKey: ["store-locations"] }); setLocationOpen(false); resetLocation(); toast({ title: "Store location created", description: data.taxRegistration?.formatValid ? `${data.name} uses ${data.taxRegistration.gstin}. Format validated locally.` : `${data.name} can now receive stock.` }); },
    onError: (error: Error) => toast({ title: "Location not created", description: error.message, variant: "destructive" }),
  });
  const canTransfer = Boolean(fromId && toId && fromId !== toId && productId && Number(quantity) > 0 && ownerPin.length === 4 && transferReady && !transferMutation.isPending);
  const locationReady = locationName.trim().length >= 2 && locationCode.trim().length >= 2 && (registrationMode !== "distinct" || locationGstin.length === 15);
  const usage = locationsQ.data?.usage;
  return (
    <div className="space-y-5 pb-10">
      <section className="overflow-hidden rounded-[24px] border border-blue-100 bg-[radial-gradient(circle_at_top_right,#dbeafe_0,transparent_38%),linear-gradient(135deg,#071a3b,#0b3574)] p-6 text-white shadow-[0_24px_60px_rgba(15,49,104,0.18)] sm:p-8">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-blue-100"><ShieldCheck size={14} /> Atomic stock · registration-aware documents</div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Multi-store stock control</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100/90">Move inventory without changing company-wide stock. KiranaOS classifies the movement from the location GSTINs, captures exact values and taxes, and preserves a permanent document trail.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => setLocationOpen(true)} disabled={Boolean(usage && usage.current >= usage.maximum)}><Building2 size={16} /> Add location</Button>
            <Button className="bg-white font-black text-blue-700 hover:bg-blue-50" onClick={() => setTransferOpen(true)} disabled={locations.length < 2}><ArrowRightLeft size={16} /> New transfer</Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Active locations</p><p className="mt-2 text-3xl font-black text-slate-900">{usage?.current ?? "—"}<span className="text-base text-slate-400"> / {usage?.maximum ?? "—"}</span></p><p className="mt-1 text-xs text-slate-500">Enforced by your Business plan</p></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Completed transfers</p><p className="mt-2 text-3xl font-black text-slate-900">{transfersQ.data?.length ?? "—"}</p><p className="mt-1 text-xs text-slate-500">Most recent 100 movements</p></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">E-way reviews</p><div className="mt-2 flex items-center gap-2 text-3xl font-black text-slate-900">{eWayReviewCount > 0 && <TriangleAlert className="text-amber-500" size={24} />}{eWayReviewCount}</div><p className="mt-1 text-xs text-slate-500">Applicability review, not a submission claim</p></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Allocation health</p><div className="mt-2 flex items-center gap-2 text-xl font-black text-slate-900">{allocationWarnings.length ? <><TriangleAlert className="text-amber-500" /> Review</> : <><CheckCircle2 className="text-emerald-500" /> Balanced</>}</div><p className="mt-1 text-xs text-slate-500">Primary stock equals total less branches</p></div>
      </div>

      <section className={`${card} p-5`}>
        <div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-black text-slate-900">Store network</h2><p className="text-xs text-slate-500">Operational locations and locally validated registration identity</p></div><MapPin className="text-blue-600" size={20} /></div>
        <div className="grid gap-3 lg:grid-cols-2">
          {locations.map((location) => {
            const registration = registrationStatus(location);
            return (
              <div key={location.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition-colors hover:border-blue-200 hover:bg-blue-50/30">
                <div className="flex items-start gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700"><Building2 size={20} /></span>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-black text-slate-900">{location.name}</p>{location.isPrimary && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">PRIMARY</span>}</div><p className="mt-0.5 truncate text-xs text-slate-500">{location.code} · {location.city || location.address || "Address not set"}</p></div>
                  <p className="text-right text-xs font-bold text-slate-500">{(location._count?.incomingTransfers ?? 0) + (location._count?.outgoingTransfers ?? 0)}<br /><span className="font-medium">moves</span></p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-3">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${registration.formatValid ? "border-emerald-200 bg-emerald-50 text-emerald-700" : registration.status === "unregistered" ? "border-slate-200 bg-white text-slate-600" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{registration.formatValid ? <BadgeCheck size={13} /> : <TriangleAlert size={13} />}{registration.formatValid ? registration.gstin : registration.status === "unregistered" ? "Unregistered" : "GSTIN needs review"}</span>
                  {registration.stateCode && <span className="text-[11px] font-semibold text-slate-500">State {registration.stateCode}</span>}
                  {location.gstTradeName && <span className="truncate text-[11px] text-slate-500">· {location.gstTradeName}</span>}
                </div>
              </div>
            );
          })}
          {!locationsQ.isLoading && locations.length === 0 && <p className="text-sm text-slate-500">No store location is available.</p>}
        </div>
      </section>

      <section className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-base font-black text-slate-900">Transfer ledger</h2><p className="text-xs text-slate-500">Document, value, tax treatment, and source-to-destination history</p></div><Package className="text-blue-600" size={20} /></div>
        <div className="divide-y divide-slate-100">
          {(transfersQ.data ?? []).map((transfer) => (
            <div key={transfer.id} className="px-5 py-4 transition-colors hover:bg-slate-50/70">
              <div className="grid gap-3 lg:grid-cols-[190px_1fr_220px] lg:items-center">
                <div><p className="font-mono text-xs font-black text-blue-700">{transfer.documentNumber || transfer.referenceNo}</p><p className="mt-1 text-[11px] text-slate-500">{new Date(transfer.completedAt || transfer.createdAt).toLocaleString("en-IN")}</p></div>
                <div><div className="flex items-center gap-3 text-sm font-bold text-slate-800"><span className="truncate">{transfer.fromLocation.name}</span><ArrowRight className="shrink-0 text-blue-500" size={16} /><span className="truncate">{transfer.toLocation.name}</span></div><span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${treatmentTone(transfer.gstTreatment)}`}>{treatmentLabel(transfer.gstTreatment)}</span></div>
                <div className="lg:text-right"><p className="text-sm font-black text-slate-900">{money.format(transfer.consignmentValue || 0)}</p><p className="truncate text-[11px] text-slate-500">{transfer.items.map((item) => `${item.productName} ${item.quantityBaseQty} ${item.baseUnit}`).join(", ")}</p></div>
              </div>
              {(transfer.documentType || transfer.eWayReviewRequired) && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600"><FileText size={13} className="text-slate-500" />{transfer.documentType && <span className="font-bold">{transfer.documentType.replaceAll("_", " ")}</span>}{transfer.documentDate && <span>· {new Date(transfer.documentDate).toLocaleDateString("en-IN")}</span>}{transfer.taxTotal > 0 && <span>· Tax {money.format(transfer.taxTotal)}</span>}{transfer.eWayReviewRequired && <span className="inline-flex items-center gap-1 font-bold text-amber-700"><TriangleAlert size={12} /> E-way applicability review</span>}</div>}
            </div>
          ))}
          {!transfersQ.isLoading && !(transfersQ.data?.length) && <div className="p-10 text-center"><ArrowRightLeft className="mx-auto text-slate-300" size={30} /><p className="mt-3 text-sm font-bold text-slate-700">No transfers yet</p><p className="mt-1 text-xs text-slate-500">Create the first movement after adding a second location.</p></div>}
        </div>
      </section>
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Transfer branch stock</DialogTitle><DialogDescription>Tax treatment is derived from saved location registrations. Values and documents are stored as immutable transfer evidence.</DialogDescription></DialogHeader>
          <div className="space-y-5 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="transfer-from">From</Label><Select value={fromId} onValueChange={(value) => { setFromId(value); setProductId(""); setDeclaredTaxableValue(""); if (value === toId) setToId(""); }}><SelectTrigger id="transfer-from"><SelectValue placeholder="Source location" /></SelectTrigger><SelectContent>{locations.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="transfer-to">To</Label><Select value={toId} onValueChange={setToId}><SelectTrigger id="transfer-to"><SelectValue placeholder="Destination" /></SelectTrigger><SelectContent>{locations.filter((row) => row.id !== fromId).map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
            </div>

            <div className={`rounded-xl border p-4 ${treatmentTone(treatment)}`}>
              <div className="flex items-start gap-3"><Landmark className="mt-0.5 shrink-0" size={18} /><div><p className="text-sm font-black">{treatmentLabel(treatment)}</p><p className="mt-1 text-xs leading-5">{treatment === "same_registration_movement" ? "A sequential delivery challan will be generated automatically. GST is not added to this internal movement." : treatment === "distinct_registration_supply" ? "GST treats separately registered locations as distinct persons. Reference the tax invoice and enter the taxable value." : treatment === "unregistered_internal" ? "This remains an internal inventory record because neither location has a GSTIN." : treatment === "incomplete" ? "One location is registered and the other is not. Correct the location registration before moving stock." : "Select a source and destination to preview the required document."}</p></div></div>
            </div>

            <div className="space-y-2"><Label htmlFor="transfer-product">Product</Label><Select value={productId} onValueChange={(value) => { setProductId(value); setDeclaredTaxableValue(""); }} disabled={!fromId}><SelectTrigger id="transfer-product"><SelectValue placeholder={fromId ? "Choose available product" : "Choose source first"} /></SelectTrigger><SelectContent>{(sourceQ.data?.products ?? []).filter((row) => row.stockBaseQty > 0).map((row) => <SelectItem key={row.id} value={row.id}>{row.name} · {row.stockBaseQty} {row.baseUnit}</SelectItem>)}</SelectContent></Select></div>

            <div className={`grid gap-3 ${registeredTransfer ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              <div className="space-y-2"><Label htmlFor="transfer-quantity">Quantity ({selectedProduct?.baseUnit || "base unit"})</Label><Input id="transfer-quantity" type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
              {registeredTransfer && <div className="space-y-2"><Label htmlFor="transfer-value">Taxable line value</Label><div className="relative"><IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} /><Input id="transfer-value" className="pl-9" type="number" min="0" step="0.01" value={declaredTaxableValue} onChange={(event) => setDeclaredTaxableValue(event.target.value)} placeholder="0.00" /></div></div>}
              <div className="space-y-2"><Label htmlFor="transfer-pin">Owner PIN</Label><Input id="transfer-pin" inputMode="numeric" type="password" maxLength={4} value={ownerPin} onChange={(event) => setOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4 digits" /></div>
            </div>

            {selectedProduct && <div className="grid gap-2 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs text-blue-900 sm:grid-cols-3"><span><b>Available</b><br />{selectedProduct.stockBaseQty} {selectedProduct.baseUnit}</span><span><b>HSN</b><br />{selectedProduct.hsn || "Not set"}</span><span><b>GST rate</b><br />{Number(selectedProduct.gstRate || 0)}%</span></div>}
            {!hsnValid && <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"><TriangleAlert size={14} /> A taxable registered transfer needs a valid 4, 6, or 8 digit HSN.</p>}

            {distinctSupply && <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-black text-violet-900"><ReceiptText size={16} /> Tax invoice reference</div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="transfer-document-number">Invoice number</Label><Input id="transfer-document-number" maxLength={16} value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, "").slice(0, 16))} placeholder="INV/26-27/001" /></div><div className="space-y-2"><Label htmlFor="transfer-document-date">Invoice date</Label><Input id="transfer-document-date" type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} /></div></div></div>}

            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="movement-reason">Movement reason</Label><Select value={movementReason} onValueChange={setMovementReason}><SelectTrigger id="movement-reason"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="branch_transfer">Branch transfer</SelectItem><SelectItem value="own_use">Own use</SelectItem><SelectItem value="job_work">Job work</SelectItem><SelectItem value="repair">Repair</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="transfer-note">Note (optional)</Label><Input id="transfer-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Replenishment, branch opening…" /></div></div>

            {registeredTransfer && taxableValue > 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between text-xs text-slate-600"><span>Taxable value</span><b>{money.format(taxableValue)}</b></div><div className="mt-2 flex items-center justify-between text-xs text-slate-600"><span>{distinctSupply ? `${fromLocation?.gstStateCode === toLocation?.gstStateCode ? "CGST + SGST" : "IGST"} (${Number(selectedProduct?.gstRate || 0)}%)` : "Tax on internal movement"}</span><b>{money.format(estimatedTax)}</b></div><div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-black text-slate-900"><span>Consignment value</span><span>{money.format(estimatedConsignment)}</span></div>{estimatedConsignment > 50000 && <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-[11px] font-semibold leading-4 text-amber-800"><TriangleAlert className="mt-0.5 shrink-0" size={13} /> Above ₹50,000: KiranaOS will flag e-way applicability for review. This does not create or submit a legal e-way bill.</p>}</div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button><Button disabled={!canTransfer} onClick={() => transferMutation.mutate()}>{transferMutation.isPending ? "Transferring…" : distinctSupply ? "Record documented supply" : "Complete transfer"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={locationOpen} onOpenChange={setLocationOpen}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>Add store location</DialogTitle><DialogDescription>Choose whether this branch uses the main registration, a distinct GSTIN, or no GST registration. GSTIN checks are local format/checksum validation—not GST portal verification.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-2"><Label htmlFor="location-name">Location name</Label><Input id="location-name" value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="Indiranagar Branch" /></div>
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="location-code">Code</Label><Input id="location-code" value={locationCode} onChange={(event) => setLocationCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16))} placeholder="IND01" /></div><div className="space-y-2"><Label htmlFor="location-city">City</Label><Input id="location-city" value={locationCity} onChange={(event) => setLocationCity(event.target.value)} placeholder="Bengaluru" /></div></div>
            <div className="space-y-2"><Label htmlFor="location-address">Address</Label><Input id="location-address" value={locationAddress} onChange={(event) => setLocationAddress(event.target.value)} placeholder="Shop 4, Market Road" /></div>
            <div className="space-y-2"><Label htmlFor="registration-mode">GST registration</Label><Select value={registrationMode} onValueChange={(value) => setRegistrationMode(value as RegistrationMode)}><SelectTrigger id="registration-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">Use main shop GSTIN</SelectItem><SelectItem value="distinct">Use a distinct GSTIN</SelectItem><SelectItem value="unregistered">Unregistered location</SelectItem></SelectContent></Select><p className="text-[11px] leading-4 text-slate-500">Omitting a GSTIN inherits the shop registration. Explicit “unregistered” does not silently inherit it.</p></div>
            {registrationMode === "distinct" && <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4"><div className="space-y-2"><Label htmlFor="location-gstin">GSTIN</Label><Input id="location-gstin" maxLength={15} value={locationGstin} onChange={(event) => setLocationGstin(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))} placeholder="29ABCDE1234F1Z5" /><p className="text-[11px] text-blue-700">The server validates structure, state code, and checksum. Active portal status requires a certified provider.</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="location-legal-name">Legal name</Label><Input id="location-legal-name" value={locationLegalName} onChange={(event) => setLocationLegalName(event.target.value)} placeholder="Registered legal name" /></div><div className="space-y-2"><Label htmlFor="location-trade-name">Trade name</Label><Input id="location-trade-name" value={locationTradeName} onChange={(event) => setLocationTradeName(event.target.value)} placeholder="Branch trade name" /></div></div></div>}
            {registrationMode === "unregistered" && <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800"><TriangleAlert className="mt-0.5 shrink-0" size={15} /> Transfers between a registered and unregistered location are blocked until the registration setup is corrected.</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setLocationOpen(false)}>Cancel</Button><Button disabled={!locationReady || locationMutation.isPending} onClick={() => locationMutation.mutate()}><Plus size={15} /> {locationMutation.isPending ? "Creating…" : "Create location"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}