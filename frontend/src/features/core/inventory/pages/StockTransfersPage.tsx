import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowRightLeft, BadgeCheck, Building2, CheckCircle2, ClipboardCheck, FileText, IndianRupee, Landmark, MapPin, Package, Plus, ReceiptText, ShieldCheck, Trash2, Truck, TriangleAlert, X } from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/shared";

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
interface LocationProduct { id: string; name: string; barcode?: string | null; sku?: string | null; baseUnit: string; displayUnit: string; stockBaseQty: number; allocationWarning: boolean; hsn?: string | null; gstRate?: number }
interface LocationInventory { location: Location; products: LocationProduct[] }
interface TransferItem { id: string; productId: string; productName: string; quantityBaseQty: number; receivedBaseQty: number; remainingBaseQty: number; baseUnit: string; hsn?: string | null; gstRate: number; taxableValue: number; taxTotal: number; totalValue: number }
interface Transfer {
  id: string;
  referenceNo: string;
  status: string;
  fulfillmentMode: "instant" | "shipment";
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
  eWayReviewStatus: "not_required" | "pending" | "external_reference_recorded" | "not_required_after_review";
  eWayBillNumber?: string | null;
  eWayBillDate?: string | null;
  eWayReviewReason?: string | null;
  eWayReviewedAt?: string | null;
  taxableValue: number;
  taxTotal: number;
  consignmentValue: number;
  legalSubmissionStatus: "not_submitted" | "external_reference_recorded_not_verified";
  complianceNotice: string;
  completedAt?: string | null;
  expectedArrivalDate?: string | null;
  carrierName?: string | null;
  trackingNumber?: string | null;
  lastReceivedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  fromLocation: Location;
  toLocation: Location;
  items: TransferItem[];
  receiptSummary: { lineCount: number; completedLineCount: number; openLineCount: number };
}

interface DraftTransferLine {
  productId: string;
  productName: string;
  baseUnit: string;
  quantityBaseQty: number;
  declaredTaxableValue?: number;
  gstRate: number;
  hsn?: string | null;
}

interface ReplenishmentSuggestion {
  destinationLocation: Location;
  productId: string;
  productName: string;
  baseUnit: string;
  stockBaseQty: number;
  lowStockThreshold: number;
  incomingBaseQty: number;
  projectedBaseQty: number;
  sourceAvailableBaseQty: number;
  targetBaseQty: number;
  recommendedTransferBaseQty: number;
  supplyLimited: boolean;
  reasonCode: "out_of_stock" | "below_branch_threshold";
  explanation: string;
}
interface ReplenishmentResponse { generatedAt: string; sourceLocation: Location | null; suggestions: ReplenishmentSuggestion[] }

type RegistrationMode = "inherit" | "distinct" | "unregistered";
type EWayReviewDecision = "external_reference_recorded" | "not_required_after_review";
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
function transferStatusLabel(status: string) {
  if (status === "in_transit") return "In transit";
  if (status === "partially_received") return "Partially received";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return status.replaceAll("_", " ");
}
function transferStatusTone(status: string) {
  if (status === "in_transit") return "border-blue-200 bg-blue-50 text-blue-800";
  if (status === "partially_received") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "cancelled") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-slate-200 bg-white text-slate-600";
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
  const [draftLines, setDraftLines] = useState<DraftTransferLine[]>([]);
  const [fulfillmentMode, setFulfillmentMode] = useState<"instant" | "shipment">("shipment");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
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
  const [reviewTransfer, setReviewTransfer] = useState<Transfer | null>(null);
  const [reviewDecision, setReviewDecision] = useState<EWayReviewDecision>("external_reference_recorded");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewEWayNumber, setReviewEWayNumber] = useState("");
  const [reviewEWayDate, setReviewEWayDate] = useState(today());
  const [reviewOwnerPin, setReviewOwnerPin] = useState("");
  const [receiptTransfer, setReceiptTransfer] = useState<Transfer | null>(null);
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>({});
  const [receiptNote, setReceiptNote] = useState("");
  const [receiptOwnerPin, setReceiptOwnerPin] = useState("");
  const [cancelTransfer, setCancelTransfer] = useState<Transfer | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOwnerPin, setCancelOwnerPin] = useState("");

  const locationsQ = useQuery({ queryKey: ["store-locations"], queryFn: () => apiRequest<LocationsResponse>("/stores") });
  const transfersQ = useQuery({ queryKey: ["stock-transfers"], queryFn: () => apiRequest<Transfer[]>("/stores/transfers?limit=100") });
  const replenishmentQ = useQuery({ queryKey: ["branch-replenishment-suggestions"], queryFn: () => apiRequest<ReplenishmentResponse>("/stores/replenishment-suggestions") });
  const sourceQ = useQuery({ queryKey: ["location-inventory", fromId], queryFn: () => apiRequest<LocationInventory>(`/stores/${fromId}/inventory`), enabled: Boolean(fromId) });

  const locations = (locationsQ.data?.locations ?? []).filter((row) => row.active);
  const fromLocation = locations.find((row) => row.id === fromId);
  const toLocation = locations.find((row) => row.id === toId);
  const selectedProduct = sourceQ.data?.products.find((row) => row.id === productId);
  const allocationWarnings = useMemo(() => sourceQ.data?.products.filter((row) => row.allocationWarning) ?? [], [sourceQ.data]);
  const eWayReviewCount = (transfersQ.data ?? []).filter((row) => row.eWayReviewRequired).length;
  const openShipmentCount = (transfersQ.data ?? []).filter((row) => ["in_transit", "partially_received"].includes(row.status)).length;
  const completedTransferCount = (transfersQ.data ?? []).filter((row) => row.status === "completed").length;
  const treatment = useMemo<TransferTreatment>(() => {
    if (!fromLocation || !toLocation) return "pending";
    const source = registrationStatus(fromLocation); const destination = registrationStatus(toLocation);
    if (source.formatValid && destination.formatValid) return source.gstin === destination.gstin ? "same_registration_movement" : "distinct_registration_supply";
    if (source.status === "unregistered" && destination.status === "unregistered") return "unregistered_internal";
    return "incomplete";
  }, [fromLocation, toLocation]);
  const registeredTransfer = treatment === "same_registration_movement" || treatment === "distinct_registration_supply";
  const distinctSupply = treatment === "distinct_registration_supply";
  const lineTaxableValue = Number(declaredTaxableValue) || 0;
  const taxableValue = draftLines.reduce((sum, line) => sum + Number(line.declaredTaxableValue || 0), 0);
  const estimatedTax = distinctSupply
    ? draftLines.reduce((sum, line) => sum + Math.round(Number(line.declaredTaxableValue || 0) * Number(line.gstRate || 0)) / 100, 0)
    : 0;
  const estimatedConsignment = Math.round((taxableValue + estimatedTax) * 100) / 100;
  const selectedHsnValid = !registeredTransfer || Number(selectedProduct?.gstRate || 0) <= 0 || /^\d{4}(?:\d{2})?(?:\d{2})?$/.test(selectedProduct?.hsn || "");
  const draftHsnValid = draftLines.every((line) => !registeredTransfer || Number(line.gstRate || 0) <= 0 || /^\d{4}(?:\d{2})?(?:\d{2})?$/.test(line.hsn || ""));
  const transferReady = treatment !== "pending" && treatment !== "incomplete" && draftLines.length > 0
    && (!registeredTransfer || draftLines.every((line) => Number(line.declaredTaxableValue) > 0))
    && (!distinctSupply || (documentNumber.trim().length > 0 && Boolean(documentDate))) && draftHsnValid;

  const addDraftLine = () => {
    if (!selectedProduct || !(Number(quantity) > 0)) return;
    const alreadyQueued = draftLines.find((line) => line.productId === selectedProduct.id)?.quantityBaseQty ?? 0;
    if (alreadyQueued + Number(quantity) > selectedProduct.stockBaseQty) {
      toast({ title: "Quantity exceeds source stock", description: `${selectedProduct.name} has ${selectedProduct.stockBaseQty} ${selectedProduct.baseUnit} available.`, variant: "destructive" });
      return;
    }
    if (registeredTransfer && !(lineTaxableValue > 0)) {
      toast({ title: "Enter taxable line value", description: "Registered movements retain the declared value for each product.", variant: "destructive" });
      return;
    }
    if (!selectedHsnValid) {
      toast({ title: "HSN needs review", description: `${selectedProduct.name} needs a valid HSN before this registered movement.`, variant: "destructive" });
      return;
    }
    setDraftLines((current) => {
      const existing = current.find((line) => line.productId === selectedProduct.id);
      if (!existing) {
        return [...current, {
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          baseUnit: selectedProduct.baseUnit,
          quantityBaseQty: Number(quantity),
          declaredTaxableValue: registeredTransfer ? lineTaxableValue : undefined,
          gstRate: Number(selectedProduct.gstRate || 0),
          hsn: selectedProduct.hsn,
        }];
      }
      return current.map((line) => line.productId === selectedProduct.id ? {
        ...line,
        quantityBaseQty: line.quantityBaseQty + Number(quantity),
        declaredTaxableValue: registeredTransfer ? Number(line.declaredTaxableValue || 0) + lineTaxableValue : undefined,
      } : line);
    });
    setProductId("");
    setQuantity("");
    setDeclaredTaxableValue("");
  };

  const resetTransfer = () => { setProductId(""); setQuantity(""); setDeclaredTaxableValue(""); setDraftLines([]); setFulfillmentMode("shipment"); setExpectedArrivalDate(""); setCarrierName(""); setTrackingNumber(""); setMovementReason("branch_transfer"); setDocumentNumber(""); setDocumentDate(today()); setNote(""); setOwnerPin(""); };
  const prepareReplenishment = (suggestion: ReplenishmentSuggestion) => {
    const sourceLocationId = replenishmentQ.data?.sourceLocation?.id;
    if (!sourceLocationId) return;
    resetTransfer();
    setFromId(sourceLocationId);
    setToId(suggestion.destinationLocation.id);
    setProductId(suggestion.productId);
    setQuantity(String(suggestion.recommendedTransferBaseQty));
    setFulfillmentMode("shipment");
    setNote(`Threshold replenishment for ${suggestion.destinationLocation.name}`);
    setTransferOpen(true);
  };
  const transferMutation = useMutation({
    mutationFn: () => apiRequest<Transfer>("/stores/transfers", {
      method: "POST",
      ownerPin,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromLocationId: fromId,
        toLocationId: toId,
        fulfillmentMode,
        movementReason,
        documentType: distinctSupply ? "tax_invoice" : treatment === "same_registration_movement" ? "delivery_challan" : undefined,
        documentNumber: distinctSupply ? documentNumber.trim() : undefined,
        documentDate: distinctSupply ? documentDate : undefined,
        expectedArrivalDate: fulfillmentMode === "shipment" && expectedArrivalDate ? expectedArrivalDate : undefined,
        carrierName: fulfillmentMode === "shipment" ? carrierName.trim() || undefined : undefined,
        trackingNumber: fulfillmentMode === "shipment" ? trackingNumber.trim() || undefined : undefined,
        items: draftLines.map((line) => ({ productId: line.productId, quantityBaseQty: line.quantityBaseQty, declaredTaxableValue: line.declaredTaxableValue })),
        note: note || undefined,
        ownerPin,
      }),
    }),
    onSuccess: (data) => { void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] }); void queryClient.invalidateQueries({ queryKey: ["location-inventory"] }); void queryClient.invalidateQueries({ queryKey: ["branch-replenishment-suggestions"] }); setTransferOpen(false); resetTransfer(); toast({ title: data.status === "completed" ? "Stock transfer completed" : "Shipment dispatched", description: data.status === "completed" ? `${data.referenceNo} recorded in both locations.` : `${data.referenceNo} reserved at source until destination receipt.` }); },
    onError: (error: Error) => toast({ title: "Transfer not completed", description: error.message, variant: "destructive" }),
  });
  const resetLocation = () => { setLocationName(""); setLocationCode(""); setLocationCity(""); setLocationAddress(""); setRegistrationMode("inherit"); setLocationGstin(""); setLocationLegalName(""); setLocationTradeName(""); };
  const locationMutation = useMutation({
    mutationFn: () => apiRequest<Location>("/stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: locationName, code: locationCode, city: locationCity || undefined, address: locationAddress || undefined, ...(registrationMode === "distinct" ? { gstNumber: locationGstin, gstLegalName: locationLegalName || undefined, gstTradeName: locationTradeName || undefined, gstRegistrationType: "regular" } : registrationMode === "unregistered" ? { gstNumber: null, gstRegistrationType: "unregistered" } : {}) }) }),
    onSuccess: (data) => { void queryClient.invalidateQueries({ queryKey: ["store-locations"] }); void queryClient.invalidateQueries({ queryKey: ["branch-replenishment-suggestions"] }); setLocationOpen(false); resetLocation(); toast({ title: "Store location created", description: data.taxRegistration?.formatValid ? `${data.name} uses ${data.taxRegistration.gstin}. Format validated locally.` : `${data.name} can now receive stock.` }); },
    onError: (error: Error) => toast({ title: "Location not created", description: error.message, variant: "destructive" }),
  });
  const resetReview = () => {
    setReviewTransfer(null);
    setReviewDecision("external_reference_recorded");
    setReviewReason("");
    setReviewEWayNumber("");
    setReviewEWayDate(today());
    setReviewOwnerPin("");
  };
  const reviewMutation = useMutation({
    mutationFn: () => apiRequest<Transfer>(`/stores/transfers/${reviewTransfer?.id}/compliance-review`, {
      method: "POST",
      ownerPin: reviewOwnerPin,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: reviewDecision,
        reason: reviewReason.trim(),
        eWayBillNumber: reviewDecision === "external_reference_recorded" ? reviewEWayNumber : undefined,
        eWayBillDate: reviewDecision === "external_reference_recorded" ? reviewEWayDate : undefined,
        ownerPin: reviewOwnerPin,
      }),
    }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["gst-compliance-readiness"] });
      resetReview();
      toast({
        title: "E-way review resolved",
        description: data.eWayBillNumber
          ? `${data.eWayBillNumber} retained as an external reference; portal status was not verified.`
          : "The not-required decision and reason are retained in the transfer audit trail.",
      });
    },
    onError: (error: Error) => toast({ title: "Review not saved", description: error.message, variant: "destructive" }),
  });
  const openReceipt = (transfer: Transfer) => {
    setReceiptTransfer(transfer);
    setReceiptQuantities(Object.fromEntries(transfer.items.filter((item) => item.remainingBaseQty > 0).map((item) => [item.id, ""])));
    setReceiptNote("");
    setReceiptOwnerPin("");
  };
  const resetReceipt = () => { setReceiptTransfer(null); setReceiptQuantities({}); setReceiptNote(""); setReceiptOwnerPin(""); };
  const receiptLines = receiptTransfer?.items
    .filter((item) => Number(receiptQuantities[item.id]) > 0)
    .map((item) => ({ transferItemId: item.id, quantityBaseQty: Number(receiptQuantities[item.id]) })) ?? [];
  const receiveMutation = useMutation({
    mutationFn: () => apiRequest<Transfer>(`/stores/transfers/${receiptTransfer?.id}/receive`, {
      method: "POST",
      ownerPin: receiptOwnerPin,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: receiptLines, note: receiptNote.trim() || undefined, ownerPin: receiptOwnerPin }),
    }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["location-inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["branch-replenishment-suggestions"] });
      resetReceipt();
      toast({ title: data.status === "completed" ? "Shipment fully received" : "Partial receipt recorded", description: data.status === "completed" ? "Every line is now available at the destination." : `${data.receiptSummary.openLineCount} line${data.receiptSummary.openLineCount === 1 ? " remains" : "s remain"} in transit.` });
    },
    onError: (error: Error) => toast({ title: "Receipt not recorded", description: error.message, variant: "destructive" }),
  });
  const resetCancellation = () => { setCancelTransfer(null); setCancelReason(""); setCancelOwnerPin(""); };
  const cancelMutation = useMutation({
    mutationFn: () => apiRequest<Transfer>(`/stores/transfers/${cancelTransfer?.id}/cancel`, {
      method: "POST",
      ownerPin: cancelOwnerPin,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: cancelReason.trim(), ownerPin: cancelOwnerPin }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["location-inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["branch-replenishment-suggestions"] });
      resetCancellation();
      toast({ title: "Shipment cancelled", description: "Only the unreceived remainder was returned to source availability; received stock was retained." });
    },
    onError: (error: Error) => toast({ title: "Shipment not cancelled", description: error.message, variant: "destructive" }),
  });
  const reviewReady = reviewReason.trim().length >= 8
    && reviewOwnerPin.length === 4
    && (reviewDecision === "not_required_after_review" || (/^\d{12}$/.test(reviewEWayNumber) && Boolean(reviewEWayDate)));
  const canTransfer = Boolean(fromId && toId && fromId !== toId && ownerPin.length === 4 && transferReady && !transferMutation.isPending);
  const receiptReady = receiptLines.length > 0 && receiptOwnerPin.length === 4 && receiptLines.every((line) => line.quantityBaseQty > 0 && line.quantityBaseQty <= Number(receiptTransfer?.items.find((item) => item.id === line.transferItemId)?.remainingBaseQty || 0));
  const cancellationReady = cancelReason.trim().length >= 8 && cancelOwnerPin.length === 4;
  const locationReady = locationName.trim().length >= 2 && locationCode.trim().length >= 2 && (registrationMode !== "distinct" || locationGstin.length === 15);
  const usage = locationsQ.data?.usage;
  const replenishmentSuggestions = replenishmentQ.data?.suggestions ?? [];
  return (
    <div className="space-y-5 pb-10">
      <section className="overflow-hidden rounded-[24px] border border-blue-100 bg-[radial-gradient(circle_at_top_right,#dbeafe_0,transparent_38%),linear-gradient(135deg,#071a3b,#0b3574)] p-6 text-white shadow-[0_24px_60px_rgba(15,49,104,0.18)] sm:p-8">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-blue-100"><ShieldCheck size={14} /> Reserved in transit · owner-approved receiving</div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Multi-store stock control</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100/90">Dispatch one or many products, keep moving stock unavailable for sale, receive partial shipments safely, and preserve registration-aware documents and an immutable audit trail.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => setLocationOpen(true)} disabled={Boolean(usage && usage.current >= usage.maximum)}><Building2 size={16} /> Add location</Button>
            <Button className="bg-white font-black text-blue-700 hover:bg-blue-50" onClick={() => setTransferOpen(true)} disabled={locations.length < 2}><ArrowRightLeft size={16} /> New transfer</Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Active locations</p><p className="mt-2 text-3xl font-black text-slate-900">{usage?.current ?? "—"}<span className="text-base text-slate-400"> / {usage?.maximum ?? "—"}</span></p><p className="mt-1 text-xs text-slate-500">Enforced by your Business plan</p></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Shipments in transit</p><p className="mt-2 text-3xl font-black text-slate-900">{openShipmentCount}</p><p className="mt-1 text-xs text-slate-500">{completedTransferCount} completed · most recent 100 shown</p></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">E-way reviews</p><div className="mt-2 flex items-center gap-2 text-3xl font-black text-slate-900">{eWayReviewCount > 0 && <TriangleAlert className="text-amber-500" size={24} />}{eWayReviewCount}</div><p className="mt-1 text-xs text-slate-500">Applicability review, not a submission claim</p></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Allocation health</p><div className="mt-2 flex items-center gap-2 text-xl font-black text-slate-900">{allocationWarnings.length ? <><TriangleAlert className="text-amber-500" /> Review</> : <><CheckCircle2 className="text-emerald-500" /> Balanced</>}</div><p className="mt-1 text-xs text-slate-500">Primary stock equals total less branches</p></div>
      </div>

      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="flex items-center gap-2 text-base font-black text-slate-900"><ClipboardCheck className="text-blue-600" size={19} /> Branch replenishment queue</h2><p className="mt-1 text-xs leading-5 text-slate-500">Deterministic suggestions use each branch threshold, open incoming shipments, configured reorder batch, and currently available primary stock. Nothing moves without owner review.</p></div>
          {replenishmentQ.data?.sourceLocation && <span className="shrink-0 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-800">Source: {replenishmentQ.data.sourceLocation.name}</span>}
        </div>
        {replenishmentQ.isLoading ? <div className="p-6 text-sm text-slate-500">Checking branch thresholds…</div> : replenishmentQ.isError ? <div className="p-6 text-sm text-rose-700">Replenishment suggestions could not be loaded. Existing stock and transfers remain available.</div> : replenishmentSuggestions.length === 0 ? (
          <div className="flex items-center gap-3 p-6"><span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><CheckCircle2 size={21} /></span><div><p className="text-sm font-black text-slate-900">Every branch is covered</p><p className="mt-1 text-xs text-slate-500">No below-threshold branch needs primary stock after counting open incoming shipments.</p></div></div>
        ) : (
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {replenishmentSuggestions.slice(0, 8).map((suggestion) => (
              <article key={`${suggestion.destinationLocation.id}:${suggestion.productId}`} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{suggestion.productName}</p><p className="mt-1 truncate text-xs font-semibold text-blue-700">{suggestion.destinationLocation.name}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${suggestion.reasonCode === "out_of_stock" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{suggestion.reasonCode === "out_of_stock" ? "Out of stock" : "Below threshold"}</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-white p-3 text-[10px] text-slate-500"><span>At branch<br /><b className="text-slate-900">{suggestion.stockBaseQty} {suggestion.baseUnit}</b></span><span>Incoming<br /><b className="text-blue-700">{suggestion.incomingBaseQty} {suggestion.baseUnit}</b></span><span>Primary free<br /><b className="text-slate-900">{suggestion.sourceAvailableBaseQty} {suggestion.baseUnit}</b></span></div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[11px] text-slate-500">Recommended movement</p><p className="text-lg font-black text-slate-900">{suggestion.recommendedTransferBaseQty} {suggestion.baseUnit}</p>{suggestion.supplyLimited && <p className="text-[10px] font-bold text-amber-700">Limited by source availability</p>}</div><Button size="sm" onClick={() => prepareReplenishment(suggestion)}><ArrowRightLeft size={14} /> Prepare transfer</Button></div>
              </article>
            ))}
          </div>
        )}
      </section>

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
          {locationsQ.isLoading && <LoadingSkeleton variant="cards" rows={2} className="lg:col-span-2" />}
          {locationsQ.isError && <ErrorState compact className="lg:col-span-2" title="Store locations could not be loaded" onRetry={() => void locationsQ.refetch()} />}
          {!locationsQ.isLoading && !locationsQ.isError && locations.length === 0 && <EmptyState className="lg:col-span-2" title="No store locations yet" description="Add a second location to start moving stock between branches." action={<Button onClick={() => setLocationOpen(true)}><Plus size={14} /> Add location</Button>} />}
        </div>
      </section>

      <section className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-base font-black text-slate-900">Transfer ledger</h2><p className="text-xs text-slate-500">Document, value, tax treatment, and source-to-destination history</p></div><Package className="text-blue-600" size={20} /></div>
        <div className="divide-y divide-slate-100">
          {transfersQ.isLoading && <LoadingSkeleton rows={4} className="p-5" />}
          {transfersQ.isError && <ErrorState compact className="m-4 w-auto" title="Transfer history could not be loaded" onRetry={() => void transfersQ.refetch()} />}
          {(transfersQ.data ?? []).map((transfer) => (
            <div key={transfer.id} className="px-5 py-4 transition-colors hover:bg-slate-50/70">
              <div className="grid gap-3 lg:grid-cols-[210px_1fr_220px] lg:items-center">
                <div>
                  <p className="font-mono text-xs font-black text-blue-700">{transfer.documentNumber || transfer.referenceNo}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{new Date(transfer.completedAt || transfer.lastReceivedAt || transfer.createdAt).toLocaleString("en-IN")}</p>
                  <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${transferStatusTone(transfer.status)}`}>
                    {transfer.status === "in_transit" || transfer.status === "partially_received" ? <Truck size={12} /> : transfer.status === "completed" ? <CheckCircle2 size={12} /> : <X size={12} />}
                    {transferStatusLabel(transfer.status)}
                  </span>
                </div>
                <div><div className="flex items-center gap-3 text-sm font-bold text-slate-800"><span className="truncate">{transfer.fromLocation.name}</span><ArrowRight className="shrink-0 text-blue-500" size={16} /><span className="truncate">{transfer.toLocation.name}</span></div><span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${treatmentTone(transfer.gstTreatment)}`}>{treatmentLabel(transfer.gstTreatment)}</span></div>
                <div className="lg:text-right"><p className="text-sm font-black text-slate-900">{money.format(transfer.consignmentValue || 0)}</p><p className="text-[11px] text-slate-500">{transfer.items.length} product line{transfer.items.length === 1 ? "" : "s"} · {transfer.receiptSummary.completedLineCount}/{transfer.receiptSummary.lineCount} fully received</p></div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {transfer.items.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-black text-slate-800">{item.productName}</p><span className="shrink-0 text-[10px] font-bold text-slate-500">{item.baseUnit}</span></div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-slate-500"><span>Ordered<br /><b className="text-slate-800">{item.quantityBaseQty}</b></span><span>Received<br /><b className="text-emerald-700">{item.receivedBaseQty}</b></span><span>{transfer.status === "cancelled" ? "Returned" : "Remaining"}<br /><b className={item.remainingBaseQty > 0 ? (transfer.status === "cancelled" ? "text-slate-700" : "text-amber-700") : "text-slate-700"}>{item.remainingBaseQty}</b></span></div>
                  </div>
                ))}
              </div>
              {transfer.fulfillmentMode === "shipment" && (transfer.carrierName || transfer.trackingNumber || transfer.expectedArrivalDate) && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-[11px] text-blue-900">
                  <span className="inline-flex items-center gap-1.5 font-bold"><Truck size={13} /> Shipment details</span>
                  {transfer.carrierName && <span>{transfer.carrierName}</span>}
                  {transfer.trackingNumber && <span>Tracking <b className="font-mono">{transfer.trackingNumber}</b></span>}
                  {transfer.expectedArrivalDate && <span>ETA {new Date(`${transfer.expectedArrivalDate}T00:00:00`).toLocaleDateString("en-IN")}</span>}
                </div>
              )}
              {transfer.status === "cancelled" && transfer.cancelReason && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-600"><b>Cancellation reason:</b> {transfer.cancelReason}</p>}
              {(transfer.documentType || transfer.eWayReviewStatus !== "not_required") && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <FileText size={13} className="text-slate-500" />
                  {transfer.documentType && <span className="font-bold">{transfer.documentType.replaceAll("_", " ")}</span>}
                  {transfer.documentDate && <span>· {new Date(transfer.documentDate).toLocaleDateString("en-IN")}</span>}
                  {transfer.taxTotal > 0 && <span>· Tax {money.format(transfer.taxTotal)}</span>}
                  {transfer.eWayReviewRequired && <span className="inline-flex items-center gap-1 font-bold text-amber-700"><TriangleAlert size={12} /> E-way applicability review pending</span>}
                  {transfer.eWayReviewStatus === "external_reference_recorded" && <span className="inline-flex items-center gap-1 font-bold text-emerald-700"><BadgeCheck size={12} /> External EWB {transfer.eWayBillNumber} · not portal-verified</span>}
                  {transfer.eWayReviewStatus === "not_required_after_review" && <span className="inline-flex items-center gap-1 font-bold text-blue-700"><CheckCircle2 size={12} /> Reviewed: not required</span>}
                  {transfer.eWayReviewReason && <span className="basis-full text-slate-500">Reason: {transfer.eWayReviewReason}</span>}
                </div>
              )}
              {(transfer.eWayReviewRequired || ["in_transit", "partially_received"].includes(transfer.status)) && (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {transfer.eWayReviewRequired && <Button size="sm" variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" onClick={() => setReviewTransfer(transfer)}>
                    <ShieldCheck size={14} /> Resolve review
                  </Button>}
                  {["in_transit", "partially_received"].includes(transfer.status) && <Button size="sm" variant="outline" className="border-slate-200 text-slate-700" onClick={() => setCancelTransfer(transfer)}><X size={14} /> Cancel remainder</Button>}
                  {["in_transit", "partially_received"].includes(transfer.status) && <Button size="sm" onClick={() => openReceipt(transfer)}><ClipboardCheck size={14} /> Receive stock</Button>}
                </div>
              )}
            </div>
          ))}
          {!transfersQ.isLoading && !transfersQ.isError && !(transfersQ.data?.length) && <EmptyState className="border-0 py-10" title="No transfers yet" description="Create the first movement after adding a second location." icon={<ArrowRightLeft size={28} className="text-slate-400" />} action={locations.length >= 2 ? <Button onClick={() => setTransferOpen(true)}><Plus size={14} /> New transfer</Button> : undefined} />}
        </div>
      </section>
      <Dialog open={transferOpen} onOpenChange={(open) => { setTransferOpen(open); if (!open && !transferMutation.isPending) resetTransfer(); }}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Transfer branch stock</DialogTitle><DialogDescription>Tax treatment is derived from saved location registrations. Values and documents are stored as immutable transfer evidence.</DialogDescription></DialogHeader>
          <div className="space-y-5 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="transfer-from">From</Label><Select value={fromId} onValueChange={(value) => { setFromId(value); setProductId(""); setQuantity(""); setDeclaredTaxableValue(""); setDraftLines([]); if (value === toId) setToId(""); }}><SelectTrigger id="transfer-from"><SelectValue placeholder="Source location" /></SelectTrigger><SelectContent>{locations.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="transfer-to">To</Label><Select value={toId} onValueChange={(value) => { setToId(value); setProductId(""); setQuantity(""); setDeclaredTaxableValue(""); setDraftLines([]); }}><SelectTrigger id="transfer-to"><SelectValue placeholder="Destination" /></SelectTrigger><SelectContent>{locations.filter((row) => row.id !== fromId).map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
            </div>

            <div className={`rounded-xl border p-4 ${treatmentTone(treatment)}`}>
              <div className="flex items-start gap-3"><Landmark className="mt-0.5 shrink-0" size={18} /><div><p className="text-sm font-black">{treatmentLabel(treatment)}</p><p className="mt-1 text-xs leading-5">{treatment === "same_registration_movement" ? "A sequential delivery challan will be generated automatically. GST is not added to this internal movement." : treatment === "distinct_registration_supply" ? "GST treats separately registered locations as distinct persons. Reference the tax invoice and enter the taxable value." : treatment === "unregistered_internal" ? "This remains an internal inventory record because neither location has a GSTIN." : treatment === "incomplete" ? "One location is registered and the other is not. Correct the location registration before moving stock." : "Select a source and destination to preview the required document."}</p></div></div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setFulfillmentMode("shipment")} className={`rounded-xl border p-4 text-left transition ${fulfillmentMode === "shipment" ? "border-blue-400 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-200"}`}>
                <span className="flex items-center gap-2 text-sm font-black text-slate-900"><Truck size={17} className="text-blue-600" /> Dispatch and receive</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">Reserve at source, track transit, then receive all or part with owner approval.</span>
              </button>
              <button type="button" onClick={() => setFulfillmentMode("instant")} className={`rounded-xl border p-4 text-left transition ${fulfillmentMode === "instant" ? "border-blue-400 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-200"}`}>
                <span className="flex items-center gap-2 text-sm font-black text-slate-900"><ArrowRightLeft size={17} className="text-blue-600" /> Instant movement</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">Complete immediately when both locations confirm stock at the same time.</span>
              </button>
            </div>

            {fulfillmentMode === "shipment" && (
              <div className="grid gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4 sm:grid-cols-3">
                <div className="space-y-2"><Label htmlFor="transfer-eta">Expected arrival</Label><Input id="transfer-eta" type="date" min={today()} value={expectedArrivalDate} onChange={(event) => setExpectedArrivalDate(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="transfer-carrier">Carrier</Label><Input id="transfer-carrier" value={carrierName} onChange={(event) => setCarrierName(event.target.value)} placeholder="Own vehicle / courier" /></div>
                <div className="space-y-2"><Label htmlFor="transfer-tracking">Tracking number</Label><Input id="transfer-tracking" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="Optional reference" /></div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-black text-slate-900">Products in this transfer</p><p className="text-xs text-slate-500">Build one auditable shipment with multiple product lines.</p></div><Package size={18} className="text-blue-600" /></div>
              <div className="space-y-2"><Label htmlFor="transfer-product">Product</Label><Select value={productId} onValueChange={(value) => { setProductId(value); setQuantity(""); setDeclaredTaxableValue(""); }} disabled={!fromId}><SelectTrigger id="transfer-product"><SelectValue placeholder={fromId ? "Choose available product" : "Choose source first"} /></SelectTrigger><SelectContent>{(sourceQ.data?.products ?? []).filter((row) => row.stockBaseQty > 0).map((row) => <SelectItem key={row.id} value={row.id}>{row.name} · {row.stockBaseQty} {row.baseUnit}</SelectItem>)}</SelectContent></Select></div>

              <div className={`mt-3 grid gap-3 ${registeredTransfer ? "sm:grid-cols-[1fr_1fr_auto]" : "sm:grid-cols-[1fr_auto]"} sm:items-end`}>
                <div className="space-y-2"><Label htmlFor="transfer-quantity">Quantity ({selectedProduct?.baseUnit || "base unit"})</Label><Input id="transfer-quantity" type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
                {registeredTransfer && <div className="space-y-2"><Label htmlFor="transfer-value">Taxable line value</Label><div className="relative"><IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} /><Input id="transfer-value" className="pl-9" type="number" min="0" step="0.01" value={declaredTaxableValue} onChange={(event) => setDeclaredTaxableValue(event.target.value)} placeholder="0.00" /></div></div>}
                <Button type="button" variant="outline" onClick={addDraftLine} disabled={!selectedProduct || !(Number(quantity) > 0) || !selectedHsnValid || (registeredTransfer && !(lineTaxableValue > 0))}><Plus size={15} /> Add line</Button>
              </div>

              {selectedProduct && <div className="mt-3 grid gap-2 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs text-blue-900 sm:grid-cols-3"><span><b>Available</b><br />{selectedProduct.stockBaseQty} {selectedProduct.baseUnit}</span><span><b>HSN</b><br />{selectedProduct.hsn || "Not set"}</span><span><b>GST rate</b><br />{Number(selectedProduct.gstRate || 0)}%</span></div>}
              {!selectedHsnValid && <p className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"><TriangleAlert size={14} /> A taxable registered transfer needs a valid 4, 6, or 8 digit HSN.</p>}

              <div className="mt-4 space-y-2">
                {draftLines.map((line) => (
                  <div key={line.productId} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-blue-600 shadow-sm"><Package size={16} /></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-slate-900">{line.productName}</p><p className="mt-0.5 text-[11px] text-slate-500">{line.quantityBaseQty} {line.baseUnit}{registeredTransfer ? ` · ${money.format(Number(line.declaredTaxableValue || 0))} taxable` : ""}</p></div>
                    <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${line.productName}`} className="h-9 w-9 text-slate-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => setDraftLines((current) => current.filter((item) => item.productId !== line.productId))}><Trash2 size={15} /></Button>
                  </div>
                ))}
                {draftLines.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-500">No products added yet.</p>}
              </div>
            </div>

            {distinctSupply && <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-black text-violet-900"><ReceiptText size={16} /> Tax invoice reference</div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="transfer-document-number">Invoice number</Label><Input id="transfer-document-number" maxLength={16} value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, "").slice(0, 16))} placeholder="INV/26-27/001" /></div><div className="space-y-2"><Label htmlFor="transfer-document-date">Invoice date</Label><Input id="transfer-document-date" type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} /></div></div></div>}

            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="movement-reason">Movement reason</Label><Select value={movementReason} onValueChange={setMovementReason}><SelectTrigger id="movement-reason"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="branch_transfer">Branch transfer</SelectItem><SelectItem value="own_use">Own use</SelectItem><SelectItem value="job_work">Job work</SelectItem><SelectItem value="repair">Repair</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="transfer-note">Note (optional)</Label><Input id="transfer-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Replenishment, branch opening…" /></div></div>
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4"><Label htmlFor="transfer-pin">Owner PIN approval</Label><Input id="transfer-pin" className="max-w-[180px] bg-white" inputMode="numeric" type="password" maxLength={4} value={ownerPin} onChange={(event) => setOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4 digits" /><p className="text-[11px] leading-4 text-slate-500">Required to reserve or move stock between locations.</p></div>

            {registeredTransfer && taxableValue > 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between text-xs text-slate-600"><span>Taxable value</span><b>{money.format(taxableValue)}</b></div><div className="mt-2 flex items-center justify-between text-xs text-slate-600"><span>{distinctSupply ? `${fromLocation?.gstStateCode === toLocation?.gstStateCode ? "CGST + SGST" : "IGST"} (${Number(selectedProduct?.gstRate || 0)}%)` : "Tax on internal movement"}</span><b>{money.format(estimatedTax)}</b></div><div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-black text-slate-900"><span>Consignment value</span><span>{money.format(estimatedConsignment)}</span></div>{estimatedConsignment > 50000 && <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-[11px] font-semibold leading-4 text-amber-800"><TriangleAlert className="mt-0.5 shrink-0" size={13} /> Above ₹50,000: Artha will flag e-way applicability for review. This does not create or submit a legal e-way bill.</p>}</div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => { setTransferOpen(false); resetTransfer(); }} disabled={transferMutation.isPending}>Cancel</Button><Button disabled={!canTransfer} onClick={() => transferMutation.mutate()}>{transferMutation.isPending ? "Saving transfer…" : distinctSupply ? (fulfillmentMode === "shipment" ? "Dispatch documented supply" : "Record documented supply") : fulfillmentMode === "shipment" ? "Dispatch shipment" : "Complete transfer"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(receiptTransfer)} onOpenChange={(open) => { if (!open && !receiveMutation.isPending) resetReceipt(); }}>
        <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Receive shipment</DialogTitle>
            <DialogDescription>{receiptTransfer ? `${receiptTransfer.documentNumber || receiptTransfer.referenceNo} · ${receiptTransfer.fromLocation.name} to ${receiptTransfer.toLocation.name}` : "Record destination receipt"}. Receive only what physically arrived.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            {receiptTransfer && (receiptTransfer.carrierName || receiptTransfer.trackingNumber) && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900"><Truck size={15} /><b>{receiptTransfer.carrierName || "Shipment"}</b>{receiptTransfer.trackingNumber && <span>Tracking <b className="font-mono">{receiptTransfer.trackingNumber}</b></span>}</div>}
            <div className="space-y-3">
              {receiptTransfer?.items.filter((item) => item.remainingBaseQty > 0).map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black text-slate-900">{item.productName}</p><p className="mt-1 text-[11px] text-slate-500">Ordered {item.quantityBaseQty} · received {item.receivedBaseQty} · <b className="text-amber-700">{item.remainingBaseQty} {item.baseUnit} remaining</b></p></div><Button type="button" variant="ghost" size="sm" onClick={() => setReceiptQuantities((current) => ({ ...current, [item.id]: String(item.remainingBaseQty) }))}>Receive all</Button></div>
                  <div className="mt-3 space-y-2"><Label htmlFor={`receipt-${item.id}`}>Quantity received ({item.baseUnit})</Label><Input id={`receipt-${item.id}`} type="number" min="0" max={item.remainingBaseQty} step="any" value={receiptQuantities[item.id] ?? ""} onChange={(event) => setReceiptQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></div>
                  {Number(receiptQuantities[item.id]) > item.remainingBaseQty && <p className="mt-2 text-xs font-bold text-rose-700">Cannot receive more than the remaining quantity.</p>}
                </div>
              ))}
            </div>
            <div className="space-y-2"><Label htmlFor="receipt-note">Receipt note (optional)</Label><Textarea id="receipt-note" rows={2} maxLength={500} value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} placeholder="Damaged carton, split delivery, vehicle reference…" /></div>
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4"><Label htmlFor="receipt-pin">Owner PIN approval</Label><Input id="receipt-pin" className="max-w-[180px] bg-white" inputMode="numeric" type="password" maxLength={4} value={receiptOwnerPin} onChange={(event) => setReceiptOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4 digits" /><p className="text-[11px] text-slate-500">Received quantities become sellable at the destination after approval.</p></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={resetReceipt} disabled={receiveMutation.isPending}>Cancel</Button><Button onClick={() => receiveMutation.mutate()} disabled={!receiptReady || receiveMutation.isPending}><ClipboardCheck size={15} /> {receiveMutation.isPending ? "Recording receipt…" : "Record receipt"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelTransfer)} onOpenChange={(open) => { if (!open && !cancelMutation.isPending) resetCancellation(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Cancel shipment remainder</DialogTitle><DialogDescription>{cancelTransfer ? cancelTransfer.documentNumber || cancelTransfer.referenceNo : "Shipment"}. Received stock stays at the destination; only unreceived quantities return to source availability.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><TriangleAlert className="mr-2 inline" size={15} />This closes the shipment and is retained in the audit trail. It does not reverse quantities already received.</div>
            <div className="space-y-2"><Label htmlFor="cancel-transfer-reason">Cancellation reason</Label><Textarea id="cancel-transfer-reason" rows={3} maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Vehicle issue, order replaced, remaining stock no longer required…" /><p className="text-right text-[11px] text-slate-500">{cancelReason.trim().length}/500 · minimum 8 characters</p></div>
            <div className="space-y-2"><Label htmlFor="cancel-transfer-pin">Owner PIN</Label><Input id="cancel-transfer-pin" className="max-w-[180px]" inputMode="numeric" type="password" maxLength={4} value={cancelOwnerPin} onChange={(event) => setCancelOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4 digits" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={resetCancellation} disabled={cancelMutation.isPending}>Keep shipment open</Button><Button variant="destructive" onClick={() => cancelMutation.mutate()} disabled={!cancellationReady || cancelMutation.isPending}><X size={15} /> {cancelMutation.isPending ? "Cancelling…" : "Cancel remainder"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reviewTransfer)} onOpenChange={(open) => { if (!open && !reviewMutation.isPending) resetReview(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve e-way applicability review</DialogTitle>
            <DialogDescription>
              {reviewTransfer ? `${reviewTransfer.documentNumber || reviewTransfer.referenceNo} · ${money.format(reviewTransfer.consignmentValue)}` : "Transfer review"}. Record external evidence or retain a reasoned not-required decision.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              Artha stores this review and audit evidence. It does not verify the e-way bill portal, decide legal applicability, or submit a legal document.
            </div>
            <div className="space-y-2">
              <Label htmlFor="eway-review-decision">Review decision</Label>
              <Select value={reviewDecision} onValueChange={(value) => setReviewDecision(value as EWayReviewDecision)}>
                <SelectTrigger id="eway-review-decision"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="external_reference_recorded">External e-way bill recorded</SelectItem>
                  <SelectItem value="not_required_after_review">Reviewed and not required</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reviewDecision === "external_reference_recorded" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="eway-review-number">12-digit e-way bill number</Label>
                  <Input id="eway-review-number" inputMode="numeric" maxLength={12} value={reviewEWayNumber} onChange={(event) => setReviewEWayNumber(event.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="181000609270" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="eway-review-date">E-way bill date</Label>
                  <Input id="eway-review-date" type="date" value={reviewEWayDate} onChange={(event) => setReviewEWayDate(event.target.value)} />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="eway-review-reason">Review reason</Label>
              <Textarea id="eway-review-reason" rows={3} maxLength={500} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder={reviewDecision === "external_reference_recorded" ? "Reference generated externally by authorised operator/provider…" : "Reason applicability was reviewed as not required…"} />
              <p className="text-right text-[11px] text-slate-500">{reviewReason.trim().length}/500 · minimum 8 characters</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="eway-review-pin">Owner PIN</Label>
              <Input id="eway-review-pin" inputMode="numeric" type="password" maxLength={4} value={reviewOwnerPin} onChange={(event) => setReviewOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4 digits" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetReview} disabled={reviewMutation.isPending}>Cancel</Button>
            <Button onClick={() => reviewMutation.mutate()} disabled={!reviewReady || reviewMutation.isPending}>
              <ShieldCheck size={15} /> {reviewMutation.isPending ? "Saving review…" : "Save review evidence"}
            </Button>
          </DialogFooter>
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
