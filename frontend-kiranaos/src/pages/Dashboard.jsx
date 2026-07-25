import { useQuery } from "@tanstack/react-query";
import { dailySales, paymentModes, udharSummary } from "../lib/api";
import { inrPaise, inr } from "../lib/money";
import { IndianRupee, Wallet, Smartphone, Coins, TrendingUp } from "lucide-react";

function todayIso() { return new Date().toISOString().slice(0, 10); }

function Card({ icon: Icon, label, value, tone = "neutral", testid }) {
  const toneClasses = {
    neutral: "bg-white",
    good: "bg-emerald-50",
    warn: "bg-amber-50",
    info: "bg-sky-50",
  }[tone];
  return (
    <div className={`card p-4 ${toneClasses}`} data-testid={testid}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 grid place-items-center">
          <Icon size={18} />
        </div>
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
          <div className="text-2xl font-semibold" data-testid={`${testid}-value`}>{value}</div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const t = todayIso();
  const sales = useQuery({ queryKey: ["daily-sales", t],   queryFn: () => dailySales(t, t) });
  const modes = useQuery({ queryKey: ["payment-modes", t], queryFn: () => paymentModes(t, t) });
  const udhar = useQuery({ queryKey: ["udhar-summary"],    queryFn: udharSummary });

  const totalSales   = sales.data?.totalSalesPaise ?? sales.data?.totals?.totalSalesPaise ?? 0;
  const cashSales    = sales.data?.cashSalesPaise  ?? sales.data?.totals?.cashSalesPaise  ?? 0;
  const upiSales     = sales.data?.upiSalesPaise   ?? sales.data?.totals?.upiSalesPaise   ?? 0;
  const udharSales   = sales.data?.udharSalesPaise ?? sales.data?.totals?.udharSalesPaise ?? 0;
  const profit       = sales.data?.grossProfitPaise ?? 0;
  const totalOut     = udhar.data?.totalOutstanding ?? 0;
  const cashInHand   = modes.data?.totalCashInHandPaise ?? cashSales;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold" data-testid="dashboard-title">Today</h1>
        <p className="text-sm text-slate-500">{new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card icon={IndianRupee} label="Sales"      value={inrPaise(totalSales)} tone="info"    testid="card-sales" />
        <Card icon={Wallet}      label="Cash today" value={inrPaise(cashSales)}  tone="good"    testid="card-cash" />
        <Card icon={Smartphone}  label="UPI today"  value={inrPaise(upiSales)}   tone="good"    testid="card-upi" />
        <Card icon={Coins}       label="Udhar out"  value={inr(totalOut)}        tone="warn"    testid="card-udhar" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="text-sm text-slate-500 flex items-center gap-2"><TrendingUp size={14} /> Gross profit today</div>
          <div className="mt-2 text-3xl font-semibold" data-testid="profit-value">{inrPaise(profit)}</div>
          <div className="mt-1 text-xs text-slate-400">Computed from bill-line cost snapshots — same source as the Reports page</div>
        </div>
        <div className="card p-5">
          <div className="text-sm text-slate-500">Cash in hand</div>
          <div className="mt-2 text-3xl font-semibold" data-testid="cash-in-hand">{inrPaise(cashInHand)}</div>
          <div className="mt-1 text-xs text-slate-400">Cash from bills + repayments − cash paid out</div>
        </div>
      </section>

      {(sales.isError || modes.isError || udhar.isError) && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded" data-testid="dashboard-error">
          Some tiles failed to load. Check the backend is reachable at REACT_APP_API_BASE.
        </div>
      )}
    </div>
  );
}
