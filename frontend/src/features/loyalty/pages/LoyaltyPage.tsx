import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, CheckCircle2, Gift, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

interface Program { active: boolean; pointsPerRupee: number; redemptionPaisePerPoint: number; minimumRedeemPoints: number; pointsExpireDays: number; tiers: Array<{ name: string; minLifetimePoints: number }>; configured?: boolean }
interface Account { id: string; pointsBalance: number; lifetimeEarned: number; lifetimeRedeemed: number; tier: string; nextTier: { name: string; minLifetimePoints: number } | null; pointsToNextTier: number; expiresAt: string | null; customer: { id: string; name: string; mobile?: string | null } }
interface AccountsPage { accounts: Account[]; total: number; limit: number; offset: number; hasMore: boolean }

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.05)]";

export default function LoyaltyPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const programQ = useQuery({ queryKey: ["loyalty-program"], queryFn: () => apiRequest<Program>("/loyalty/program") });
  const accountsQ = useQuery({ queryKey: ["loyalty-accounts"], queryFn: () => apiRequest<AccountsPage>("/loyalty/accounts?limit=200") });
  const accountRows = accountsQ.data?.accounts ?? [];
  const [active, setActive] = useState(false);
  const [earnRate, setEarnRate] = useState("1");
  const [pointValue, setPointValue] = useState("25");
  const [minimum, setMinimum] = useState("100");
  const [expiryDays, setExpiryDays] = useState("365");
  const [silverAt, setSilverAt] = useState("1000");
  const [goldAt, setGoldAt] = useState("5000");
  const [ownerPin, setOwnerPin] = useState("");

  useEffect(() => {
    if (!programQ.data) return;
    setActive(programQ.data.active); setEarnRate(String(programQ.data.pointsPerRupee)); setPointValue(String(programQ.data.redemptionPaisePerPoint)); setMinimum(String(programQ.data.minimumRedeemPoints)); setExpiryDays(String(programQ.data.pointsExpireDays ?? 365)); setSilverAt(String(programQ.data.tiers?.[1]?.minLifetimePoints ?? 1000)); setGoldAt(String(programQ.data.tiers?.[2]?.minLifetimePoints ?? 5000));
  }, [programQ.data]);

  const save = useMutation({
    mutationFn: () => apiRequest<Program>("/loyalty/program", { method: "PUT", ownerPin, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active, pointsPerRupee: Number(earnRate), redemptionPaisePerPoint: Number(pointValue), minimumRedeemPoints: Number(minimum), pointsExpireDays: Number(expiryDays), tiers: [{ name: "Bronze", minLifetimePoints: 0 }, { name: "Silver", minLifetimePoints: Number(silverAt) }, { name: "Gold", minLifetimePoints: Number(goldAt) }], ownerPin }) }),
    onSuccess: () => { setOwnerPin(""); void queryClient.invalidateQueries({ queryKey: ["loyalty-program"] }); toast({ title: "Loyalty program saved", description: active ? "Named customers will earn points automatically on new bills." : "New point earning is paused; existing balances remain safe." }); },
    onError: (error: Error) => toast({ title: "Settings not saved", description: error.message, variant: "destructive" }),
  });
  const totals = useMemo(() => accountRows.reduce((sum, row) => ({ members: sum.members + 1, balance: sum.balance + row.pointsBalance, earned: sum.earned + row.lifetimeEarned, redeemed: sum.redeemed + row.lifetimeRedeemed }), { members: 0, balance: 0, earned: 0, redeemed: 0 }), [accountRows]);
  const discountPerPoint = Number(pointValue || 0) / 100;
  const summaryCards: Array<{ label: string; value: number; Icon: LucideIcon }> = [
    { label: "Members", value: totals.members, Icon: Users },
    { label: "Points outstanding", value: totals.balance, Icon: Award },
    { label: "Lifetime earned", value: totals.earned, Icon: Sparkles },
    { label: "Lifetime redeemed", value: totals.redeemed, Icon: Gift },
  ];

  return <div className="space-y-5 pb-10">
    <section className="overflow-hidden rounded-[24px] bg-[radial-gradient(circle_at_top_right,#f5d0fe_0,transparent_35%),linear-gradient(135deg,#2e1065,#6b21a8)] p-6 text-white shadow-[0_24px_60px_rgba(88,28,135,0.2)] sm:p-8">
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div className="max-w-2xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-purple-100"><Sparkles size={14} /> Retention, backed by a real ledger</div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Customer loyalty</h1><p className="mt-2 max-w-xl text-sm leading-6 text-purple-100/90">Automatically earn points on identified-customer bills, reverse them on cancellation, and keep an auditable lifetime balance. Coupons and points remain separate so discounts cannot be silently doubled.</p></div><div className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${programQ.data?.active ? "bg-emerald-400/20 text-emerald-100" : "bg-white/10 text-purple-100"}`}>{programQ.data?.active ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}{programQ.data?.active ? "Program active" : "Program paused"}</div></div>
    </section>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{summaryCards.map(({ label, value, Icon }) => <div key={label} className={`${card} p-5`}><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p><Icon size={18} className="text-purple-600" /></div><p className="mt-3 text-3xl font-black text-slate-900">{value.toLocaleString("en-IN")}</p></div>)}</div>

    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <section className={`${card} p-5`}><div className="mb-5"><h2 className="text-base font-black text-slate-900">Program rules</h2><p className="mt-1 text-xs leading-5 text-slate-500">Changes affect future earning and redemption only.</p></div><div className="space-y-4"><div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3"><div><p className="text-sm font-black text-slate-800">Enable automatic earning</p><p className="mt-0.5 text-xs text-slate-500">Only bills linked to a customer</p></div><Switch checked={active} onCheckedChange={setActive} /></div><div className="space-y-2"><Label>Points earned per ₹1</Label><Input type="number" min="0.01" step="0.01" value={earnRate} onChange={(event) => setEarnRate(event.target.value)} /></div><div className="space-y-2"><Label>Value of one point (paise)</Label><Input type="number" min="1" step="1" value={pointValue} onChange={(event) => setPointValue(event.target.value)} /><p className="text-xs text-slate-500">Current value: ₹{discountPerPoint.toFixed(2)} per point</p></div><div className="space-y-2"><Label>Minimum points to redeem</Label><Input type="number" min="1" step="1" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></div><div className="space-y-2"><Label>Expire after inactivity (days)</Label><Input type="number" min="0" max="3650" value={expiryDays} onChange={(event) => setExpiryDays(event.target.value)} /><p className="text-xs text-slate-500">Use 0 to disable. Expiry creates an auditable ledger entry.</p></div><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Silver at</Label><Input type="number" min="1" value={silverAt} onChange={(event) => setSilverAt(event.target.value)} /></div><div className="space-y-2"><Label>Gold at</Label><Input type="number" min="2" value={goldAt} onChange={(event) => setGoldAt(event.target.value)} /></div></div><div className="space-y-2"><Label>Owner PIN to save</Label><Input type="password" inputMode="numeric" maxLength={4} value={ownerPin} onChange={(event) => setOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4 digits" /></div><Button className="w-full bg-purple-700 font-black hover:bg-purple-800" disabled={ownerPin.length !== 4 || save.isPending || Number(earnRate) <= 0 || Number(pointValue) < 1 || Number(minimum) < 1 || Number(expiryDays) < 0 || Number(silverAt) <= 0 || Number(goldAt) <= Number(silverAt)} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save loyalty rules"}</Button></div></section>

      <section className={`${card} overflow-hidden`}><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-base font-black text-slate-900">Member balances</h2><p className="mt-1 text-xs text-slate-500">Customers appear after their first points-earning bill.{accountsQ.data?.hasMore ? ` Showing top ${accountRows.length} of ${accountsQ.data.total} members by balance.` : ""}</p></div><div className="divide-y divide-slate-100">{accountRows.map((account) => <div key={account.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_110px_130px] sm:items-center"><div className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-purple-100 text-sm font-black text-purple-700">{account.customer.name.slice(0, 2).toUpperCase()}</span><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-black text-slate-900">{account.customer.name}</p><span className="rounded-full bg-purple-50 px-2 py-0.5 text-[9px] font-black uppercase text-purple-700">{account.tier}</span></div><p className="text-xs text-slate-500">{account.customer.mobile || "No mobile"}{account.nextTier ? ` · ${account.pointsToNextTier.toLocaleString("en-IN")} to ${account.nextTier.name}` : " · Top tier"}</p>{account.expiresAt ? <p className="text-[10px] text-amber-600">Expires {new Date(account.expiresAt).toLocaleDateString("en-IN")}</p> : null}</div></div><div className="sm:text-right"><p className="text-sm font-black text-purple-700">{account.pointsBalance.toLocaleString("en-IN")}</p><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">available</p></div><div className="sm:text-right"><p className="text-xs font-bold text-slate-700">₹{(account.pointsBalance * discountPerPoint).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p><p className="text-[10px] text-slate-400">redemption value</p></div></div>)}{!accountsQ.isLoading && !accountRows.length && <div className="p-12 text-center"><Gift className="mx-auto text-slate-300" size={34} /><p className="mt-3 text-sm font-black text-slate-700">No loyalty members yet</p><p className="mt-1 text-xs text-slate-500">Enable the program and bill a named customer to start.</p></div>}</div></section>
    </div>

    <section className={`${card} flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between`}>
      <div><h2 className="text-sm font-black text-slate-900">Redemptions happen at checkout</h2><p className="mt-1 text-xs text-slate-500">Select a saved customer on Billing, open Loyalty points, and redeem there. The points and bill commit atomically and cancellation restores them.</p></div>
      <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-emerald-700">Checkout protected</span>
    </section>
  </div>;
}
