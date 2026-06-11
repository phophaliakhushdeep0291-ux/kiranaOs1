import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BadgePercent, CheckCircle2, Loader2, Pencil, Plus, Tag, Ticket, Trash2, XCircle } from "lucide-react";
import { listOffers, createOffer, updateOffer, deleteOffer, applyOffer } from "@/features/offers/api";
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
  green: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700", rose: "bg-rose-100 text-rose-700", gray: "bg-[#eef2f8] text-[#64748b]",
};

const offerFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);
  const [deleting, setDeleting] = useState<Offer | null>(null);

  const offersQ = useQuery({ queryKey: ["offers"], queryFn: listOffers });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["offers"] });

  const saveMut = useMutation({
    mutationFn: (vars: { id?: string; data: OfferInput }) => (vars.id ? updateOffer(vars.id, vars.data) : createOffer(vars.data)),
    onSuccess: () => { invalidate(); setDialogOpen(false); setEditing(null); toast({ title: editing ? "Offer updated" : "Offer created" }); },
    onError: (err: unknown) => toast({ title: "Could not save", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteOffer(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "Offer moved to recycle bin" }); },
    onError: (err: unknown) => toast({ title: "Could not delete", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" }),
  });
  const toggleActive = (o: Offer) => saveMut.mutate({ id: o.id, data: { active: !o.active } as OfferInput });

  const rows = offersQ.data ?? [];
  const activeCount = rows.filter((o) => offerStatus(o).label === "Active").length;
  const redemptions = rows.reduce((s, o) => s + (o.usedCount || 0), 0);

  return (
    <div className="min-h-full bg-[#f7f9fd] px-4 py-4">
      <div className="mx-auto w-full max-w-[1200px] space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi icon={<Ticket size={16} />} label="Active offers" value={String(activeCount)} tone="blue" />
          <Kpi icon={<Tag size={16} />} label="Total offers" value={String(rows.length)} tone="violet" />
          <Kpi icon={<BadgePercent size={16} />} label="Redemptions" value={String(redemptions)} tone="green" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* Offers table */}
          <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
            <div className="flex items-center justify-between border-b border-[#eef2f8] px-5 py-3.5">
              <h3 className="font-display text-[14px] font-black tracking-tight text-[#102347]">Your offers</h3>
              <Button onClick={() => { setEditing(null); setDialogOpen(true); }} style={{ background: "linear-gradient(180deg,#0057ff 0%,#0047e8 100%)" }} className="h-9 gap-2 rounded-[9px] font-bold text-white hover:opacity-95">
                <Plus size={15} /> Create Offer
              </Button>
            </div>
            {offersQ.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
            ) : offersQ.isError ? (
              <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load offers. Check your connection.</div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-[#eef5ff] text-[#0057ff]"><Ticket size={22} /></span>
                <p className="text-[13px] font-bold text-[#102347]">No offers yet</p>
                <p className="text-[12px] text-[#64748b]">Create a coupon or auto-discount to boost sales.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                    <tr>
                      <th className="px-5 py-2.5 text-left font-bold">Offer</th>
                      <th className="px-5 py-2.5 text-left font-bold">Discount</th>
                      <th className="px-5 py-2.5 text-left font-bold">Validity</th>
                      <th className="px-5 py-2.5 text-left font-bold">Status</th>
                      <th className="px-5 py-2.5 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o, i) => {
                      const st = offerStatus(o);
                      return (
                        <tr key={o.id} className={i < rows.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                          <td className="px-5 py-3">
                            <p className="font-bold text-[#102347]">{o.title}</p>
                            {o.code ? <span className="mt-0.5 inline-block rounded-[6px] bg-[#0f1e3d] px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">{o.code}</span> : <span className="text-[11px] text-[#94a3b8]">Auto-apply</span>}
                          </td>
                          <td className="px-5 py-3 font-bold text-[#102347]">{o.type === "flat" ? inr(o.value) : `${o.value}%`}{o.minBillAmount > 0 && <span className="block text-[10px] font-medium text-[#94a3b8]">min {inr(o.minBillAmount)}</span>}</td>
                          <td className="px-5 py-3 text-[#52627e]">{o.validFrom || o.validTo ? `${fmtDate(o.validFrom)} – ${fmtDate(o.validTo)}` : "Always"}{o.usageLimit > 0 && <span className="block text-[10px] text-[#94a3b8]">{o.usedCount}/{o.usageLimit} used</span>}</td>
                          <td className="px-5 py-3"><span className={`rounded-[7px] px-2 py-[3px] text-[11px] font-bold ${TONE_CLASS[st.tone]}`}>{st.label}</span></td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <Switch checked={o.active} onCheckedChange={() => toggleActive(o)} />
                              <button onClick={() => { setEditing(o); setDialogOpen(true); }} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label="Edit"><Pencil size={14} /></button>
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

      <OfferDialog
        open={dialogOpen}
        editing={editing}
        saving={saveMut.isPending}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={(data) => saveMut.mutate({ id: editing?.id, data })}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-[380px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[#0f1e3d]">Delete this offer?</DialogTitle></DialogHeader>
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
      <div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[#eef5ff] text-[#0057ff]"><Ticket size={15} /></span><h3 className="font-display text-[14px] font-black tracking-tight text-[#102347]">Coupon tester</h3></div>
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
  const ring = tone === "blue" ? "bg-[#eef5ff] text-[#0057ff]" : tone === "violet" ? "bg-violet-50 text-violet-600" : "bg-emerald-50 text-emerald-600";
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-[9px] ${ring}`}>{icon}</span>
      </div>
      <p className="mt-1.5 font-display text-[24px] font-black leading-none text-[#102347]">{value}</p>
    </div>
  );
}

function OfferDialog({ open, editing, saving, onClose, onSubmit }: { open: boolean; editing: Offer | null; saving: boolean; onClose: () => void; onSubmit: (data: OfferInput) => void }) {
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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader><DialogTitle className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">{editing ? "Edit Offer" : "Create Offer"}</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-3.5">
          <Fld label="Offer title" err={form.formState.errors.title?.message}><Input className="h-10" placeholder="Diwali Sale" {...form.register("title")} /></Fld>
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Coupon code (optional)"><Input className="h-10 uppercase" placeholder="DIWALI10" {...form.register("code")} /></Fld>
            <Fld label="Discount type">
              <Select value={type} onValueChange={(v) => form.setValue("type", v as OfferFormData["type"])}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="percentage">Percentage (%)</SelectItem><SelectItem value="flat">Flat (₹)</SelectItem></SelectContent>
              </Select>
            </Fld>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Fld label={type === "flat" ? "Discount (₹)" : "Discount (%)"} err={form.formState.errors.value?.message}><Input className="h-10" type="number" step="0.01" {...form.register("value")} /></Fld>
            <Fld label="Min bill (₹)"><Input className="h-10" type="number" step="0.01" {...form.register("minBillAmount")} /></Fld>
          </div>
          {type === "percentage" && <Fld label="Max discount cap (₹)" hint="0 = no cap"><Input className="h-10" type="number" step="0.01" {...form.register("maxDiscount")} /></Fld>}
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Valid from"><Input className="h-10" type="date" {...form.register("validFrom")} /></Fld>
            <Fld label="Valid to"><Input className="h-10" type="date" {...form.register("validTo")} /></Fld>
          </div>
          <div className="grid grid-cols-2 items-end gap-3">
            <Fld label="Usage limit" hint="0 = unlimited"><Input className="h-10" type="number" {...form.register("usageLimit")} /></Fld>
            <label className="flex h-10 items-center justify-between rounded-[8px] border border-[#eef2f8] px-3">
              <span className="text-[12px] font-semibold text-[#344668]">Active</span>
              <Switch checked={form.watch("active")} onCheckedChange={(v) => form.setValue("active", v)} />
            </label>
          </div>
          <div className="flex gap-2.5 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving} style={{ background: "linear-gradient(180deg,#0057ff 0%,#0047e8 100%)" }} className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : editing ? "Save changes" : "Create offer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
