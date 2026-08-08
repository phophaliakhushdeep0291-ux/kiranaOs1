import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Clock3, MessageCircle, Search, Users, WalletCards } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { offlineDB } from "@/lib/offline/db";
import { formatMoney, roundMoney } from "@/lib/money";
import { getLocalUdharSummaryAsync } from "@/features/core/payments/local-actions";
import { applyAuthoritativeUdharSummary, loadCustomersWithLedger, type CustomerWithLedger } from "@/features/core/customers/customer-ledger-data";
import { resolveAuthoritativeUdharSummary } from "@/features/core/ledger/authoritative-balances";
import { dedupeLedgerEntries, getLedgerCustomerId, getLedgerDate, normaliseLedgerType, type CustomerLedgerEntry } from "@/features/core/ledger/accounting";
import { customerMatchesUdharSearch } from "../udhar-search";
import { buildUdharReminderUrl } from "../reminder";
import { useAuth } from "@/features/core/auth/useAuth";
import { useToast } from "@/hooks/use-toast";

type SortMode = "amount" | "oldest" | "name";
interface UdharHomeData { customers: CustomerWithLedger[]; todayCollected: number; lastPaymentByCustomer: Map<string, string> }

function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function daysSince(value?: string) { if (!value) return null; return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)); }

async function loadUdharHome(): Promise<UdharHomeData> {
  const [localCustomers, localSummary, resolved, ledger] = await Promise.all([
    loadCustomersWithLedger(),
    getLocalUdharSummaryAsync(),
    resolveAuthoritativeUdharSummary().catch(() => null),
    offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []),
  ]);
  const summary = resolved?.summary ?? localSummary;
  const customers = applyAuthoritativeUdharSummary(localCustomers, summary).filter((customer) => customer.ledgerBalance > 0);
  const lastPaymentByCustomer = new Map<string, string>();
  let todayCollected = 0;
  const now = new Date();
  for (const entry of dedupeLedgerEntries(ledger)) {
    if (normaliseLedgerType(entry.type, entry.source_type) !== "PAYMENT") continue;
    if (entry.reversed_at || entry.reversedAt) continue;
    const customerId = getLedgerCustomerId(entry);
    const date = getLedgerDate(entry);
    if (customerId && (!lastPaymentByCustomer.get(customerId) || date > String(lastPaymentByCustomer.get(customerId)))) lastPaymentByCustomer.set(customerId, date);
    if (sameDay(new Date(date), now)) todayCollected = roundMoney(todayCollected + Math.abs(Number(entry.amount ?? 0)));
  }
  return { customers, todayCollected, lastPaymentByCustomer };
}

export default function UdharPage() {
  const queryClient = useQueryClient();
  const { shop } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("amount");
  const query = useQuery({ queryKey: ["udhar-home"], queryFn: loadUdharHome, staleTime: 1_500 });
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["udhar-home"] });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => { window.removeEventListener("kirana:local-data-changed", refresh); window.removeEventListener("kirana:sync-queue-updated", refresh); };
  }, [queryClient]);

  const rows = useMemo(() => (query.data?.customers ?? []).filter((customer) => customerMatchesUdharSearch(customer, search)).sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "hi");
    if (sort === "oldest") return String(query.data?.lastPaymentByCustomer.get(a.id) ?? "").localeCompare(String(query.data?.lastPaymentByCustomer.get(b.id) ?? ""));
    return b.ledgerBalance - a.ledgerBalance || a.name.localeCompare(b.name, "hi");
  }), [query.data, search, sort]);
  const total = roundMoney((query.data?.customers ?? []).reduce((sum, customer) => sum + customer.ledgerBalance, 0));

  function remind(customer: CustomerWithLedger) {
    const popup = window.open(buildUdharReminderUrl(shop?.name ?? "हमारी दुकान", customer.name, customer.mobile, customer.ledgerBalance), "_blank", "noopener,noreferrer");
    toast({ title: popup ? "WhatsApp खुला" : "WhatsApp नहीं खुला", description: `${customer.name}: ${formatMoney(customer.ledgerBalance)}`, variant: popup ? undefined : "destructive" });
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl overflow-x-hidden px-3 pb-28 pt-3 sm:px-5 md:pb-8" data-testid="udhar-home">
      <header className="rounded-2xl bg-[#0f3f8f] p-4 text-white shadow-lg sm:p-5">
        <p className="text-sm font-bold text-blue-100">उधार खाता</p><h1 className="mt-1 text-2xl font-black">किससे कितना लेना है</h1>
        <div className="mt-4 grid grid-cols-1 gap-2 min-[390px]:grid-cols-3">
          <Metric icon={<WalletCards size={20} />} label="कुल बाकी" value={formatMoney(total)} />
          <Metric icon={<Users size={20} />} label="ग्राहक" value={String(query.data?.customers.length ?? 0)} />
          <Metric icon={<ArrowRight size={20} />} label="आज आया" value={formatMoney(query.data?.todayCollected ?? 0)} />
        </div>
      </header>
      <section className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_190px]">
        <label className="relative min-w-0"><Search className="absolute left-3 top-3.5 text-slate-400" size={18} /><Input className="h-12 w-full pl-10 text-base" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="नाम या फोन खोजें" aria-label="नाम या फोन खोजें" /></label>
        <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}><SelectTrigger className="h-12 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="amount">सबसे ज्यादा बाकी</SelectItem><SelectItem value="oldest">सबसे पुराना</SelectItem><SelectItem value="name">नाम से</SelectItem></SelectContent></Select>
      </section>
      <section className="mt-3 space-y-2" aria-label="बाकी उधार वाले ग्राहक">
        {rows.map((customer) => { const age = daysSince(query.data?.lastPaymentByCustomer.get(customer.id)); return <article key={customer.id} className="grid min-h-[76px] min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <Link href={`/customers/${encodeURIComponent(customer.id)}`} className="min-w-0 rounded-xl py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"><p className="truncate text-base font-black text-slate-900">{customer.name}</p><p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><Clock3 size={14} />{age === null ? "अब तक भुगतान नहीं" : age === 0 ? "आज भुगतान" : `${age} दिन पहले भुगतान`}</p><p className="mt-1 text-xl font-black text-rose-600">{formatMoney(customer.ledgerBalance)}</p></Link>
          <Button type="button" size="icon" className="h-12 w-12 shrink-0 rounded-xl bg-[#16a34a] hover:bg-[#15803d]" aria-label={`${customer.name} को ${formatMoney(customer.ledgerBalance)} का WhatsApp रिमाइंडर`} onClick={() => remind(customer)}><MessageCircle size={21} /></Button>
        </article>; })}
        {!query.isLoading && rows.length === 0 ? <div className="rounded-2xl border border-dashed p-10 text-center text-slate-500">कोई बाकी उधार नहीं मिला।</div> : null}
      </section>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="min-w-0 rounded-xl bg-white/10 p-3"><div className="flex items-center gap-2 text-blue-100">{icon}<span className="text-xs font-bold">{label}</span></div><p className="mt-1 truncate text-xl font-black sm:text-2xl">{value}</p></div>; }
