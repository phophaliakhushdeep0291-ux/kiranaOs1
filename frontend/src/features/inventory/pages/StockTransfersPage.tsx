import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowRightLeft, Building2, CheckCircle2, MapPin, Package, Plus, ShieldCheck, TriangleAlert } from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Location {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  city?: string | null;
  isPrimary: boolean;
  active: boolean;
  _count?: { stocks: number; outgoingTransfers: number; incomingTransfers: number };
}
interface LocationsResponse { locations: Location[]; usage: { current: number; maximum: number } }
interface LocationProduct { id: string; name: string; baseUnit: string; displayUnit: string; stockBaseQty: number; allocationWarning: boolean }
interface LocationInventory { location: Location; products: LocationProduct[] }
interface Transfer { id: string; referenceNo: string; status: string; note?: string | null; completedAt?: string | null; createdAt: string; fromLocation: Location; toLocation: Location; items: Array<{ id: string; productName: string; quantityBaseQty: number; baseUnit: string }> }

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.05)]";

export default function StockTransfersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [transferOpen, setTransferOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [locationCity, setLocationCity] = useState("");

  const locationsQ = useQuery({ queryKey: ["store-locations"], queryFn: () => apiRequest<LocationsResponse>("/stores") });
  const transfersQ = useQuery({ queryKey: ["stock-transfers"], queryFn: () => apiRequest<Transfer[]>("/stores/transfers?limit=100") });
  const sourceQ = useQuery({
    queryKey: ["location-inventory", fromId],
    queryFn: () => apiRequest<LocationInventory>(`/stores/${fromId}/inventory`),
    enabled: Boolean(fromId),
  });

  const locations = (locationsQ.data?.locations ?? []).filter((row) => row.active);
  const selectedProduct = sourceQ.data?.products.find((row) => row.id === productId);
  const allocationWarnings = useMemo(() => sourceQ.data?.products.filter((row) => row.allocationWarning) ?? [], [sourceQ.data]);

  const transferMutation = useMutation({
    mutationFn: () => apiRequest<Transfer>("/stores/transfers", {
      method: "POST",
      ownerPin,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromLocationId: fromId, toLocationId: toId, items: [{ productId, quantityBaseQty: Number(quantity) }], note: note || undefined, ownerPin }),
    }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["location-inventory"] });
      setTransferOpen(false); setProductId(""); setQuantity(""); setNote(""); setOwnerPin("");
      toast({ title: "Stock transfer completed", description: `${data.referenceNo} is recorded in both locations.` });
    },
    onError: (error: Error) => toast({ title: "Transfer not completed", description: error.message, variant: "destructive" }),
  });

  const locationMutation = useMutation({
    mutationFn: () => apiRequest<Location>("/stores", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: locationName, code: locationCode, city: locationCity || undefined }),
    }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["store-locations"] });
      setLocationOpen(false); setLocationName(""); setLocationCode(""); setLocationCity("");
      toast({ title: "Store location created", description: `${data.name} can now receive stock.` });
    },
    onError: (error: Error) => toast({ title: "Location not created", description: error.message, variant: "destructive" }),
  });

  const canTransfer = Boolean(fromId && toId && fromId !== toId && productId && Number(quantity) > 0 && ownerPin.length === 4 && !transferMutation.isPending);
  const usage = locationsQ.data?.usage;

  return (
    <div className="space-y-5 pb-10">
      <section className="overflow-hidden rounded-[24px] border border-blue-100 bg-[radial-gradient(circle_at_top_right,#dbeafe_0,transparent_38%),linear-gradient(135deg,#071a3b,#0b3574)] p-6 text-white shadow-[0_24px_60px_rgba(15,49,104,0.18)] sm:p-8">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-blue-100"><ShieldCheck size={14} /> Atomic, audited inventory movement</div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Multi-store stock control</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-blue-100/90">Move stock between live branch balances without changing total company inventory. Every transfer validates source stock, requires owner approval and keeps a permanent reference.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => setLocationOpen(true)} disabled={Boolean(usage && usage.current >= usage.maximum)}><Building2 size={16} /> Add location</Button>
            <Button className="bg-white font-black text-blue-700 hover:bg-blue-50" onClick={() => setTransferOpen(true)} disabled={locations.length < 2}><ArrowRightLeft size={16} /> New transfer</Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Active locations</p><p className="mt-2 text-3xl font-black text-slate-900">{usage?.current ?? "—"}<span className="text-base text-slate-400"> / {usage?.maximum ?? "—"}</span></p><p className="mt-1 text-xs text-slate-500">Enforced by your Business plan</p></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Completed transfers</p><p className="mt-2 text-3xl font-black text-slate-900">{transfersQ.data?.length ?? "—"}</p><p className="mt-1 text-xs text-slate-500">Most recent 100 movements</p></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Allocation health</p><div className="mt-2 flex items-center gap-2 text-xl font-black text-slate-900">{allocationWarnings.length ? <><TriangleAlert className="text-amber-500" /> Review</> : <><CheckCircle2 className="text-emerald-500" /> Balanced</>}</div><p className="mt-1 text-xs text-slate-500">Primary stock is total minus branch allocations</p></div>
      </div>

      <section className={`${card} p-5`}>
        <div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-black text-slate-900">Store network</h2><p className="text-xs text-slate-500">Operational branches under this shop</p></div><MapPin className="text-blue-600" size={20} /></div>
        <div className="grid gap-3 lg:grid-cols-2">
          {locations.map((location) => (
            <div key={location.id} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-100 text-blue-700"><Building2 size={20} /></span>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-black text-slate-900">{location.name}</p>{location.isPrimary && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">PRIMARY</span>}</div><p className="mt-0.5 truncate text-xs text-slate-500">{location.code} · {location.city || location.address || "Address not set"}</p></div>
              <p className="text-right text-xs font-bold text-slate-500">{(location._count?.incomingTransfers ?? 0) + (location._count?.outgoingTransfers ?? 0)}<br /><span className="font-medium">moves</span></p>
            </div>
          ))}
          {!locationsQ.isLoading && locations.length === 0 && <p className="text-sm text-slate-500">No store location is available.</p>}
        </div>
      </section>

      <section className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-base font-black text-slate-900">Transfer ledger</h2><p className="text-xs text-slate-500">Permanent source-to-destination history</p></div><Package className="text-blue-600" size={20} /></div>
        <div className="divide-y divide-slate-100">
          {(transfersQ.data ?? []).map((transfer) => (
            <div key={transfer.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[180px_1fr_180px] lg:items-center">
              <div><p className="font-mono text-xs font-black text-blue-700">{transfer.referenceNo}</p><p className="mt-1 text-[11px] text-slate-500">{new Date(transfer.completedAt || transfer.createdAt).toLocaleString("en-IN")}</p></div>
              <div className="flex items-center gap-3 text-sm font-bold text-slate-800"><span className="truncate">{transfer.fromLocation.name}</span><ArrowRight className="shrink-0 text-blue-500" size={16} /><span className="truncate">{transfer.toLocation.name}</span></div>
              <div className="lg:text-right"><p className="text-xs font-black text-slate-800">{transfer.items.length} product{transfer.items.length === 1 ? "" : "s"}</p><p className="truncate text-[11px] text-slate-500">{transfer.items.map((item) => `${item.productName} ${item.quantityBaseQty} ${item.baseUnit}`).join(", ")}</p></div>
            </div>
          ))}
          {!transfersQ.isLoading && !(transfersQ.data?.length) && <div className="p-10 text-center"><ArrowRightLeft className="mx-auto text-slate-300" size={30} /><p className="mt-3 text-sm font-bold text-slate-700">No transfers yet</p><p className="mt-1 text-xs text-slate-500">Create the first movement after adding a second location.</p></div>}
        </div>
      </section>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Transfer branch stock</DialogTitle><DialogDescription>The movement completes immediately and cannot silently overwrite newer stock.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>From</Label><Select value={fromId} onValueChange={(value) => { setFromId(value); setProductId(""); }}><SelectTrigger><SelectValue placeholder="Source location" /></SelectTrigger><SelectContent>{locations.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>To</Label><Select value={toId} onValueChange={setToId}><SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger><SelectContent>{locations.filter((row) => row.id !== fromId).map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div></div>
            <div className="space-y-2"><Label>Product</Label><Select value={productId} onValueChange={setProductId} disabled={!fromId}><SelectTrigger><SelectValue placeholder={fromId ? "Choose available product" : "Choose source first"} /></SelectTrigger><SelectContent>{(sourceQ.data?.products ?? []).filter((row) => row.stockBaseQty > 0).map((row) => <SelectItem key={row.id} value={row.id}>{row.name} · {row.stockBaseQty} {row.baseUnit}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Quantity ({selectedProduct?.baseUnit || "base unit"})</Label><Input type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div><div className="space-y-2"><Label>Owner PIN</Label><Input inputMode="numeric" type="password" maxLength={4} value={ownerPin} onChange={(event) => setOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4 digits" /></div></div>
            {selectedProduct && <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">Available at source: {selectedProduct.stockBaseQty} {selectedProduct.baseUnit}</p>}
            <div className="space-y-2"><Label>Transfer note (optional)</Label><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Replenishment, new branch opening…" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button><Button disabled={!canTransfer} onClick={() => transferMutation.mutate()}>{transferMutation.isPending ? "Transferring…" : "Complete transfer"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={locationOpen} onOpenChange={setLocationOpen}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Add store location</DialogTitle><DialogDescription>Your plan limit is enforced before the branch is created.</DialogDescription></DialogHeader><div className="space-y-4 py-3"><div className="space-y-2"><Label>Location name</Label><Input value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="Indiranagar Branch" /></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Code</Label><Input value={locationCode} onChange={(event) => setLocationCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16))} placeholder="IND01" /></div><div className="space-y-2"><Label>City</Label><Input value={locationCity} onChange={(event) => setLocationCity(event.target.value)} placeholder="Bengaluru" /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setLocationOpen(false)}>Cancel</Button><Button disabled={locationName.trim().length < 2 || locationCode.trim().length < 2 || locationMutation.isPending} onClick={() => locationMutation.mutate()}><Plus size={15} /> {locationMutation.isPending ? "Creating…" : "Create location"}</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
