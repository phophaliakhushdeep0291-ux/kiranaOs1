import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePanelResize, PanelResizeHandle } from "@/hooks/use-panel-resize";
import { cn } from "@/lib/utils";
import { BadgePercent, CheckCircle2, IndianRupee, Loader2, Pencil, Percent, Plus, Tag, Ticket, Trash2, X, XCircle } from "lucide-react";
import { listOffers, createOffer, updateOffer, deleteOffer, applyOffer } from "@/features/offers/api";
import { useOfflineStatus } from "@/features/sync";
import { CHIP_TONES } from "@/lib/chip-tones";
import type { ApplyOfferResult, Offer, OfferInput } from "@/types/api";

function inr(n: number) { return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`; }
function fmtDate(iso?: string | null) { return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"; }

function offerStatus(o: Offer): { label: string; tone: "green" | "amber" | "rose" | "gray" } {
  const now = Date.now();
  if (!o.active) return { label: "Paused", tone: "gray" };
  if (o.validFrom && new Date(o.validFrom).getTime() > now) return { label: "Scheduled", tone: "amber" };
  if (o.validTo && new Date(o.validTo).getTime() < now) return { label: "Expired", tone: "rose" };
  if (o.usageLimit > 0 && o.usedCount >= o.usageLimit) return { label: "Used up", tone: "rose" };
  return { label: "Active", tone: "green" };
}
const TONE_CLASS: Record<string, string> = {
  green: CHIP_TONES.green, amber: CHIP_TONES.amber, rose: CHIP_TONES.red, gray: CHIP_TONES.gray,
};
const TILE_COLORS = ["var(--brand)", "#16a34a", "#f59e0b", "#8b5cf6", "#ef4444", "#0891b2", "#db2777", "#ea580c"];

const offerFormSchema = z.object({
  title: z.string().trim().min(1, "Offer name is required").max(160),
  code: z.string().trim().max(40).optional(),
  type: z.enum(["percentage", "flat"]),
  value: z.coerce.number().positive("Enter a value"),
  minBillAmount: z.coerce.number().min(0).default(0),
  maxDiscount: z.coerce.number().min(0).default(0),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  usageLimit: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});
type OfferFormData = z.infer<typeof offerFormSchema>;

export default function OffersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineStatus();
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);
  const [deleting, setDeleting] = useState<Offer | null>(null);
  const { width: panelWidth, isResizing, isDesktop, onResizeStart } = usePanelResize("kirana:offers-panel-width", { defaultWidth: 420 });

  const offersQ = useQuery({ queryKey: ["offers"], queryFn: listOffers });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["offers"] });

  // Offers are online-first (they validate coupon codes server-side). Offline
  // they can't be saved, so say so plainly rather than a misleading "Try again".
  const offlineNotice = () => toast({
    title: "You're offline",
    description: "Offers need a connection right now. Reconnect and save again — your typed details stay in the form.",
    variant: "destructive",
  });

  const saveMut = useMutation({
    mutationFn: (vars: { id?: string; data: OfferInput }) => (vars.id ? updateOffer(vars.id, vars.data) : createOffer(vars.data)),
    onSuccess: () => { invalidate(); setPanelOpen(false); setEditing(null); toast({ title: editing ? "Offer updated" : "Offer created" }); },
    onError: (err: unknown) => {
      if (!isOnline) return offlineNotice();
      toast({ title: "Could not save", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteOffer(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "Offer moved to recycle bin" }); },
    onError: (err: unknown) => {
      if (!isOnline) return offlineNotice();
      toast({ title: "Could not delete", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    },
  });
  const toggleActive = (o: Offer) => saveMut.mutate({ id: o.id, data: { active: !o.active } as OfferInput });

  const rows = offersQ.data ?? [];
  const activeCount = rows.filter((o) => offerStatus(o).label === "Active").length;
  const scheduledCount = rows.filter((o) => offerStatus(o).label === "Scheduled").length;
  const redemptions = rows.reduce((s, o) => s + (o.usedCount || 0), 0);
  const discountImpact = rows.reduce((s, o) => s + (o.discountGiven || 0), 0);

  function openCreate() { setEditing(null); setPanelOpen(true); }
  function openEdit(o: Offer) { setEditing(o); setPanelOpen(true); }

  return (
    <div
      className={cn("app-docked-page", isResizing ? "" : "transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]")}
      style={panelOpen && isDesktop ? { paddingRight: panelWidth + 24 } : undefined}
    >
      <div className="space-y-4">
        {!isOnline && (
          <div role="status" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
            Showing the last offers saved on this device. Coupon redemption and offer changes require a connection so usage limits cannot be oversubscribed across counters.
          </div>
        )}
        <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<Ticket size={16} />} label="Active Offers" value={String(activeCount)} tone="blue" />
          <Kpi icon={<Tag size={16} />} label="Scheduled Offers" value={String(scheduledCount)} tone="violet" />
          <Kpi icon={<BadgePercent size={16} />} label="Coupon Redemptions" value={redemptions.toLocaleString("en-IN")} tone="green" />
          <Kpi icon={<IndianRupee size={16} />} label="Discount Impact" value={inr(discountImpact)} tone="green" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
          {/* Offers table */}
          <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
            <div className="flex items-center justify-between border-b border-[#eef2f8] px-5 py-3.5">
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">All Offers & Campaigns</h3>
              <Button onClick={openCreate} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-9 gap-2 rounded-[9px] font-bold text-white hover:opacity-95">
                <Plus size={15} /> New Offer
              </Button>
            </div>
            {offersQ.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
            ) : offersQ.isError ? (
              <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load offers. Check your connection.</div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Ticket size={22} /></span>
                <p className="text-[13px] font-bold text-[var(--brand-ink)]">No offers yet</p>
                <p className="text-[12px] text-[#64748b]">Create a coupon or auto-discount to boost sales.</p>
              </div>
            ) : (
              <div className="app-table-scroll overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                    <tr>
                      <th className="px-5 py-2.5 text-left font-bold">Offer Name</th>
                      <th className="px-5 py-2.5 text-left font-bold">Type</th>
                      <th className="px-5 py-2.5 text-left font-bold">Validity</th>
                      <th className="px-5 py-2.5 text-left font-bold">Usage</th>
                      <th className="px-5 py-2.5 text-left font-bold">Status</th>
                      <th className="px-5 py-2.5 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o, i) => {
                      const st = offerStatus(o);
                      const tileColor = TILE_COLORS[i % TILE_COLORS.length];
                      return (
                        <tr key={o.id} className={i < rows.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <span className="grid h-10 w-12 shrink-0 place-items-center rounded-[8px] text-center leading-none text-white" style={{ background: tileColor }}>
                                <span>
                                  <span className="block text-[11px] font-black">{o.type === "flat" ? `₹${Math.round(o.value)}` : `${o.value}%`}</span>
                                  <span className="block text-[7px] font-bold tracking-wider">OFF</span>
                                </span>
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-bold text-[var(--brand-ink)]">{o.title}</p>
                                {o.code ? <span className="mt-0.5 inline-block rounded-[5px] bg-[var(--brand-ink)] px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">{o.code}</span> : <span className="text-[11px] text-[#94a3b8]">Auto-apply</span>}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", o.type === "flat" ? CHIP_TONES.blue : CHIP_TONES.violet)}>{o.type === "flat" ? "Flat" : "Percentage"}</span>
                            {o.minBillAmount > 0 && <span className="mt-1 block text-[10px] text-[#94a3b8]">min {inr(o.minBillAmount)}</span>}
                          </td>
                          <td className="px-5 py-3 text-[#52627e]">{o.validFrom || o.validTo ? `${fmtDate(o.validFrom)} – ${fmtDate(o.validTo)}` : "Always"}</td>
                          <td className="px-5 py-3">
                            {o.usageLimit > 0 ? (
                              <div className="w-[110px]">
                                <div className="flex justify-between text-[10px] font-bold text-[#52627e]"><span>{o.usedCount} / {o.usageLimit}</span><span>{Math.min(100, Math.round((o.usedCount / o.usageLimit) * 100))}%</span></div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef2f8]"><div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.min(100, (o.usedCount / o.usageLimit) * 100)}%` }} /></div>
                              </div>
                            ) : (
                              <span className="text-[11px] text-[#94a3b8]">{o.usedCount} used · no limit</span>
                            )}
                          </td>
                          <td className="px-5 py-3"><span className={`rounded-[7px] px-2 py-[3px] text-[11px] font-bold ${TONE_CLASS[st.tone]}`}>{st.label}</span></td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <Switch checked={o.active} onCheckedChange={() => toggleActive(o)} />
                              <button onClick={() => openEdit(o)} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label="Edit"><Pencil size={14} /></button>
                              <button onClick={() => setDeleting(o)} className="grid h-8 w-8 place-items-center rounded-[8px] text-rose-500 hover:bg-rose-50" aria-label="Delete"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <CouponTester />
        </div>
      </div>

      <OfferPanel
        open={panelOpen}
        editing={editing}
        saving={saveMut.isPending}
        width={panelWidth}
        onResizeStart={onResizeStart}
        onClose={() => { setPanelOpen(false); setEditing(null); }}
        onSubmit={(data) => saveMut.mutate({ id: editing?.id, data })}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-[380px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Delete this offer?</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[#52627e]">"{deleting?.title}" will move to the recycle bin and stop applying at billing.</p>
          <div className="flex gap-2.5 pt-2">
            <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button className="h-11 flex-1 gap-2 rounded-[10px] bg-rose-600 font-black text-white hover:bg-rose-700" disabled={deleteMut.isPending} onClick={() => deleting && deleteMut.mutate(deleting.id)}>
              {deleteMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CouponTester() {
  const [subtotal, setSubtotal] = useState("500");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ApplyOfferResult | null>(null);
  const mut = useMutation({
    mutationFn: () => applyOffer(Number(subtotal) || 0, code.trim() || undefined),
    onSuccess: setResult,
    onError: () => setResult({ applicable: false, discount: 0, reason: "Could not check offer" }),
  });
  return (
    <div className="h-fit rounded-[14px] border border-[#e6ecf4] bg-white p-5 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]"><Ticket size={15} /></span><h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">Coupon tester</h3></div>
      <p className="mb-3 text-[11px] text-[#64748b]">Check what discount applies for a bill — exactly what billing will compute.</p>
      <div className="space-y-2.5">
        <div><Label className="mb-1 block text-[11px] font-semibold text-[#45577a]">Bill subtotal (₹)</Label><Input className="h-9" type="number" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} /></div>
        <div><Label className="mb-1 block text-[11px] font-semibold text-[#45577a]">Coupon code (optional)</Label><Input className="h-9 uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Leave blank for auto-offers" /></div>
        <Button className="h-9 w-full rounded-[9px] font-bold" variant="outline" onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? <Loader2 size={14} className="animate-spin" /> : "Check offer"}</Button>
      </div>
      {result && (
        <div className={`mt-3 flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[12px] ${result.applicable ? "bg-emerald-50 text-emerald-800" : "bg-[#f4f7fb] text-[#52627e]"}`}>
          {result.applicable ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-[#94a3b8]" />}
          <div>
            {result.applicable ? <><p className="font-bold">{result.title} — save {inr(result.discount)}</p><p className="text-[11px]">Applied to the bill subtotal.</p></> : <p>{result.reason ?? "No offer applies."}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "blue" | "violet" | "green" }) {
  const ring = tone === "blue" ? "bg-[var(--brand-soft)] text-[var(--brand)]" : tone === "violet" ? "bg-violet-50 text-violet-600" : "bg-emerald-50 text-emerald-600";
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-[9px] ${ring}`}>{icon}</span>
      </div>
      <p className="mt-1.5 truncate font-display text-[24px] font-black leading-none text-[var(--brand-ink)]">{value}</p>
    </div>
  );
}

/* ── Create / Edit docked panel ── */
const TYPE_CARDS: { key: OfferFormData["type"]; label: string; icon: typeof Percent }[] = [
  { key: "flat", label: "Flat", icon: IndianRupee },
  { key: "percentage", label: "Percentage", icon: Percent },
];

function OfferPanel({ open, editing, saving, width, onResizeStart, onClose, onSubmit }: {
  open: boolean; editing: Offer | null; saving: boolean; width: number;
  onResizeStart: (e: React.MouseEvent) => void; onClose: () => void; onSubmit: (data: OfferInput) => void;
}) {
  const form = useForm<OfferFormData>({
    resolver: zodResolver(offerFormSchema),
    values: {
      title: editing?.title ?? "",
      code: editing?.code ?? "",
      type: (editing?.type as OfferFormData["type"]) ?? "percentage",
      value: editing?.value ?? ("" as unknown as number),
      minBillAmount: editing?.minBillAmount ?? 0,
      maxDiscount: editing?.maxDiscount ?? 0,
      validFrom: editing?.validFrom ? editing.validFrom.slice(0, 10) : "",
      validTo: editing?.validTo ? editing.validTo.slice(0, 10) : "",
      usageLimit: editing?.usageLimit ?? 0,
      active: editing?.active ?? true,
    },
  });
  const type = form.watch("type");

  function submit(v: OfferFormData) {
    onSubmit({
      ...v,
      code: v.code?.trim() ? v.code.trim() : undefined,
      validFrom: v.validFrom ? new Date(v.validFrom).toISOString() : undefined,
      validTo: v.validTo ? new Date(v.validTo).toISOString() : undefined,
    });
  }

  return (
    <aside
      style={{ width }}
      className={`app-slide-panel fixed right-0 top-0 z-[80] flex h-full w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog" aria-label={editing ? "Edit offer" : "Create new offer"} aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">{editing ? "Edit Offer" : "Create New Offer"}</h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">{editing ? "Update this discount or promotion" : "Set up a new discount or promotional offer"}</p>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <form onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          {/* Offer type cards */}
          <div>
            <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Offer Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_CARDS.map((t) => {
                const selected = type === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => form.setValue("type", t.key)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-[10px] border px-2 py-3 transition-colors",
                      selected ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[#e7edf7] bg-white hover:border-[var(--brand-border)]",
                    )}
                  >
                    <t.icon size={17} className={selected ? "text-[var(--brand)]" : "text-[#536583]"} />
                    <span className={cn("text-[11.5px] font-bold", selected ? "text-[var(--brand)]" : "text-[#344668]")}>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Fld label="Offer Name *" err={form.formState.errors.title?.message}><Input className="h-10" placeholder="E.g., Summer Sale Flat ₹50 Off" {...form.register("title")} /></Fld>
          <Fld label="Coupon Code (Optional)" hint="Leave blank to auto-apply at billing"><Input className="h-10 uppercase" placeholder="E.g., SUMMER50" {...form.register("code")} /></Fld>

          <div className="grid grid-cols-2 gap-3">
            <Fld label={type === "flat" ? "Discount Value (₹) *" : "Discount Value (%) *"} err={form.formState.errors.value?.message}>
              <Input className="h-10" type="number" step="0.01" placeholder={type === "flat" ? "E.g., 50" : "E.g., 10"} {...form.register("value")} />
            </Fld>
            <Fld label="Minimum Purchase (₹)" hint="Minimum cart value to apply offer"><Input className="h-10" type="number" step="0.01" {...form.register("minBillAmount")} /></Fld>
          </div>
          {type === "percentage" && <Fld label="Max Discount Cap (₹)" hint="0 = no cap"><Input className="h-10" type="number" step="0.01" {...form.register("maxDiscount")} /></Fld>}

          <div className="grid grid-cols-2 gap-3">
            <Fld label="Start Date"><Input className="h-10" type="date" {...form.register("validFrom")} /></Fld>
            <Fld label="End Date"><Input className="h-10" type="date" {...form.register("validTo")} /></Fld>
          </div>

          <Fld label="Usage Limit" hint="Total times this offer can be used · 0 = unlimited"><Input className="h-10" type="number" {...form.register("usageLimit")} /></Fld>

          <div className="flex items-center justify-between rounded-[10px] border border-[#e7edf7] px-3.5 py-2.5">
            <div>
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">Status — Active</p>
              <p className="text-[11px] text-[#64748b]">Offer will be live immediately</p>
            </div>
            <Switch checked={form.watch("active")} onCheckedChange={(v) => form.setValue("active", v)} />
          </div>
        </div>

        <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#eef1f6] bg-white px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5 shadow-[0_-12px_30px_rgba(15,35,80,0.06)]">
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="outline" className="h-11 min-w-0 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-11 min-w-0 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Ticket size={15} /> {editing ? "Save Changes" : "Create Offer"}</>}
            </Button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function Fld({ label, err, hint, children }: { label: string; err?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{label}</Label>
      {children}
      {hint && !err && <p className="mt-1 text-[11px] text-[#9aa6bb]">{hint}</p>}
      {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}
