import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Copy, CreditCard, Gift, History, Loader2, Plus, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { useListCustomers } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { disableGiftCard, issueGiftCard, listGiftCards, type GiftCard } from "./api";

type Approval = { type: "issue" } | { type: "disable"; card: GiftCard } | null;
const cardStyle = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.05)]";
const tones: Record<string, string> = { active: "bg-emerald-50 text-emerald-700 ring-emerald-200", depleted: "bg-slate-100 text-slate-600 ring-slate-200", disabled: "bg-rose-50 text-rose-700 ring-rose-200", expired: "bg-amber-50 text-amber-700 ring-amber-200" };

function money(value: number) { return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function txLabel(type: string) { return type === "issue" ? "Issued" : type === "redeem" ? "Redeemed" : type.startsWith("redemption_reversal") ? "Restored" : type.startsWith("restore_redeem") ? "Re-applied" : type.replaceAll("_", " "); }

export default function GiftCardsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const customers = useListCustomers();
  const cardsQ = useQuery({ queryKey: ["gift-cards"], queryFn: () => listGiftCards("all") });
  const [issueOpen, setIssueOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [customerId, setCustomerId] = useState("none");
  const [expiresOn, setExpiresOn] = useState("");
  const [note, setNote] = useState("");
  const [approval, setApproval] = useState<Approval>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [issued, setIssued] = useState<GiftCard | null>(null);
  const [selected, setSelected] = useState<GiftCard | null>(null);
  const [copied, setCopied] = useState(false);

  const cards = cardsQ.data ?? [];
  const metrics = useMemo(() => ({ active: cards.filter((row) => row.status === "active").length, available: cards.filter((row) => row.status === "active").reduce((sum, row) => sum + row.balance, 0), redeemed: cards.reduce((sum, row) => sum + Math.max(0, row.initialBalance - row.balance), 0) }), [cards]);

  const action = useMutation({
    mutationFn: async ({ ownerPin, reason }: { ownerPin: string; reason: string }) => {
      if (approval?.type === "issue") return issueGiftCard({ amount: Number(amount), ...(customerId !== "none" ? { customerId } : {}), ...(expiresOn ? { expiresOn } : {}), ...(note.trim() ? { note: note.trim() } : {}), ownerPin });
      if (approval?.type === "disable") return disableGiftCard(approval.card.id, { ownerPin, reason });
      throw new Error("No gift-card action selected.");
    },
    onSuccess: (data) => {
      const wasIssue = approval?.type === "issue"; setApproval(null); setApprovalError(null);
      void queryClient.invalidateQueries({ queryKey: ["gift-cards"] });
      if (wasIssue) { setIssueOpen(false); setIssued(data); setAmount(""); setCustomerId("none"); setExpiresOn(""); setNote(""); }
      else { setSelected(data); toast({ title: "Gift card disabled", description: "Its remaining value is retained in the audit ledger and cannot be spent." }); }
    },
    onError: (error: Error) => setApprovalError(error.message),
  });

  async function copyCode() {
    if (!issued?.code) return;
    try { await navigator.clipboard.writeText(issued.code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { toast({ title: "Copy unavailable", description: "Select the code and copy it manually.", variant: "destructive" }); }
  }

  return <div className="space-y-5 pb-10">
    <section className="overflow-hidden rounded-[24px] border border-pink-100 bg-[radial-gradient(circle_at_top_right,#fce7f3_0,transparent_38%),linear-gradient(135deg,#25103b,#651c57)] p-6 text-white shadow-[0_24px_60px_rgba(82,22,70,0.2)] sm:p-8"><div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div className="max-w-2xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-pink-100"><Sparkles size={14} /> Omnichannel stored value</div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Gift cards customers can trust</h1><p className="mt-2 max-w-xl text-sm leading-6 text-pink-100/90">Issue owner-approved store value, redeem it with cash at any branch, and keep every rupee linked to an immutable balance history.</p></div><Button className="bg-white font-black text-pink-700 hover:bg-pink-50" onClick={() => setIssueOpen(true)}><Plus size={16} /> Issue gift card</Button></div></section>

    <div className="grid gap-4 md:grid-cols-3"><div className={`${cardStyle} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Active cards</p><p className="mt-2 text-3xl font-black text-slate-900">{metrics.active}</p><p className="mt-1 text-xs text-slate-500">Spendable across all locations</p></div><div className={`${cardStyle} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Outstanding value</p><p className="mt-2 text-3xl font-black text-slate-900">{money(metrics.available)}</p><p className="mt-1 text-xs text-slate-500">Live balance, not a sales estimate</p></div><div className={`${cardStyle} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Value redeemed</p><p className="mt-2 text-3xl font-black text-slate-900">{money(metrics.redeemed)}</p><p className="mt-1 text-xs text-slate-500">Includes restored cancellation history</p></div></div>

    <section className={`${cardStyle} overflow-hidden`}><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-base font-black text-slate-900">Stored-value ledger</h2><p className="text-xs text-slate-500">Only the final four characters remain visible after issuance</p></div><ShieldCheck className="text-pink-600" size={20} /></div>
      <div className="divide-y divide-slate-100">{cards.map((row) => <button type="button" key={row.id} onClick={() => setSelected(row)} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-slate-50 sm:grid-cols-[1fr_180px_170px] sm:items-center"><div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-pink-50 text-pink-600"><Gift size={20} /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-sm font-black text-slate-900">•••• •••• {row.codeLast4}</p><span className={cn("rounded-full px-2 py-0.5 text-[9px] font-black uppercase ring-1", tones[row.status])}>{row.status}</span></div><p className="mt-1 truncate text-xs text-slate-500">{row.customer?.name ?? "Unassigned card"}{row.expiresAt ? ` · expires ${new Date(row.expiresAt).toLocaleDateString("en-IN")}` : " · no expiry"}</p></div></div><div><p className="text-[10px] font-bold uppercase text-slate-400">Available</p><p className="mt-0.5 text-lg font-black text-slate-900">{money(row.balance)}</p></div><div className="sm:text-right"><p className="text-xs font-bold text-slate-600">Issued {new Date(row.issuedAt).toLocaleDateString("en-IN")}</p><p className="mt-1 text-[11px] text-slate-400">Original {money(row.initialBalance)}</p></div></button>)}{!cardsQ.isLoading && !cards.length && <div className="p-12 text-center"><CreditCard className="mx-auto text-slate-300" size={34} /><p className="mt-3 text-sm font-black text-slate-700">No gift cards issued</p><p className="mt-1 text-xs text-slate-500">Issue controlled store value for refunds, rewards, or prepaid gifts.</p></div>}{cardsQ.isLoading && <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} /> Loading secure ledger…</div>}</div>
    </section>

    <Dialog open={issueOpen} onOpenChange={setIssueOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Issue gift card</DialogTitle><DialogDescription>The code is generated securely and shown once. Issuance requires owner approval and creates the opening ledger entry.</DialogDescription></DialogHeader><div className="space-y-4 py-2"><div className="space-y-2"><Label>Opening value</Label><Input type="number" min="1" max="100000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="₹500" /></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Assign customer (optional)</Label><Select value={customerId} onValueChange={setCustomerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned bearer card</SelectItem>{(customers.data ?? []).map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name}{customer.mobile ? ` · ${customer.mobile}` : ""}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Expiry (optional)</Label><Input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} min={new Date().toISOString().slice(0, 10)} /></div></div><div className="space-y-2"><Label>Issue note (optional)</Label><Input value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="Festival reward, return credit, prepaid gift…" /></div></div><DialogFooter><Button variant="outline" onClick={() => setIssueOpen(false)}>Cancel</Button><Button disabled={!Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > 100000} onClick={() => { setApprovalError(null); setApproval({ type: "issue" }); }}>Continue securely</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(issued)} onOpenChange={(open) => { if (!open) setIssued(null); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><Check className="text-emerald-600" /> Gift card ready</DialogTitle><DialogDescription>Share this code with the customer now. For security, Artha will show only the last four characters after closing.</DialogDescription></DialogHeader><div className="rounded-2xl bg-gradient-to-br from-pink-600 to-violet-700 p-5 text-white"><p className="text-xs font-bold uppercase tracking-[0.2em] text-pink-100">Artha Gift Card</p><p className="mt-5 select-all break-all font-mono text-xl font-black tracking-wider">{issued?.code}</p><div className="mt-5 flex items-end justify-between"><div><p className="text-[10px] uppercase text-pink-100">Available</p><p className="text-2xl font-black">{money(issued?.balance ?? 0)}</p></div><Gift size={30} className="text-pink-100" /></div></div><DialogFooter><Button variant="outline" onClick={() => void copyCode()}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy code"}</Button><Button onClick={() => setIssued(null)}>I have shared it</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Gift card •••• {selected?.codeLast4}</DialogTitle><DialogDescription>{selected?.customer ? `Assigned to ${selected.customer.name}` : "Unassigned bearer card"} · {selected ? money(selected.balance) : ""} available</DialogDescription></DialogHeader><div className="max-h-[420px] space-y-2 overflow-y-auto py-2">{(selected?.transactions ?? []).map((row) => <div key={row.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600"><History size={16} /></span><div className="min-w-0 flex-1"><p className="text-sm font-black capitalize text-slate-800">{txLabel(row.type)}</p><p className="truncate text-[11px] text-slate-500">{row.note || new Date(row.createdAt).toLocaleString("en-IN")}</p></div><div className="text-right"><p className={cn("text-sm font-black", row.amount < 0 ? "text-rose-600" : "text-emerald-700")}>{row.amount > 0 ? "+" : ""}{money(row.amount)}</p><p className="text-[10px] text-slate-400">{money(row.balanceAfter)} after</p></div></div>)}{!selected?.transactions?.length && <p className="py-6 text-center text-sm text-slate-500">No transaction history loaded.</p>}</div><DialogFooter>{selected?.status === "active" && <Button variant="outline" className="mr-auto text-rose-700" onClick={() => { setApprovalError(null); setApproval({ type: "disable", card: selected }); }}><Ban size={15} /> Disable</Button>}<Button onClick={() => setSelected(null)}>Close</Button></DialogFooter></DialogContent></Dialog>

    <OwnerPinModal open={Boolean(approval)} title={approval?.type === "issue" ? "Approve gift-card issuance" : "Disable gift card"} description={approval?.type === "issue" ? `Create ${money(Number(amount) || 0)} of spendable store value. The action and opening balance are audited.` : `Disable card ending ${approval?.type === "disable" ? approval.card.codeLast4 : ""}. Its remaining balance is retained but cannot be spent.`} confirmLabel={approval?.type === "issue" ? "Issue gift card" : "Disable card"} reasonRequired={approval?.type === "disable"} reasonLabel={approval?.type === "issue" ? "Approval note (optional)" : "Reason for disabling"} loading={action.isPending} error={approvalError} onCancel={() => { if (!action.isPending) { setApproval(null); setApprovalError(null); } }} onConfirm={(payload) => action.mutate(payload)} />
  </div>;
}
