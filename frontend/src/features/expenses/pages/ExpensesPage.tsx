import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePanelResize, PanelResizeHandle } from "@/hooks/use-panel-resize";
import { cn } from "@/lib/utils";
import {
  ArrowDown, ArrowUp, CalendarDays, Clock3, Download, Home, Loader2, Megaphone, MoreHorizontal,
  Package, Pencil, PieChart as PieIcon, Plus, Receipt, Search, Smartphone, Trash2, Truck, Users, Wallet, Wrench, X, Zap,
} from "lucide-react";
import { listExpenses, getExpenseOverview, createExpense, updateExpense, deleteExpense } from "@/features/expenses/api";
import { useOfflineStatus } from "@/features/sync";
import { CHIP_TONES } from "@/lib/chip-tones";
import type { Expense, ExpenseInput } from "@/types/api";

const CATEGORIES = ["Rent", "Salaries", "Utilities", "Stock Purchase", "Transport", "Maintenance", "Marketing", "Office Supplies", "Mobile & Internet", "Misc"];
const MODES: { value: string; label: string }[] = [
  { value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }, { value: "bank", label: "Bank Transfer" }, { value: "card", label: "Card" }, { value: "other", label: "Other" },
];
const MODE_BADGE: Record<string, string> = {
  cash: CHIP_TONES.green, upi: CHIP_TONES.violet, bank: CHIP_TONES.blue, card: CHIP_TONES.blue, other: CHIP_TONES.gray,
};
const PALETTE = ["var(--brand)", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#64748b"];
const CATEGORY_ICON: Record<string, typeof Home> = {
  Rent: Home, Salaries: Users, Utilities: Zap, "Stock Purchase": Package, Transport: Truck,
  Maintenance: Wrench, Marketing: Megaphone, "Office Supplies": Receipt, "Mobile & Internet": Smartphone, Misc: MoreHorizontal,
};

function inr(n: number | undefined) { return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`; }
function fmtDate(iso?: string | null) { return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }
function monthLabel(key: string) { const [y, m] = key.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short" }); }
function pctDelta(current: number, previous: number) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
function rangeFor(option: string) {
  const now = new Date();
  if (option === "this-month") return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: undefined };
  if (option === "last-month") return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString() };
  if (option === "last-3-months") return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString(), to: undefined };
  return { from: undefined, to: undefined };
}

const expenseFormSchema = z.object({
  title: z.string().trim().min(1, "Description is required").max(160),
  amount: z.coerce.number().positive("Enter an amount"),
  category: z.string().min(1),
  paymentMode: z.enum(["cash", "upi", "bank", "card", "other"]),
  status: z.enum(["paid", "pending"]),
  spentAt: z.string().min(1, "Date is required"),
  vendor: z.string().max(160).optional(),
  notes: z.string().max(500).optional(),
  recurring: z.boolean(),
  recurringInterval: z.enum(["daily", "weekly", "monthly"]),
  nextDueOn: z.string().optional(),
});
type ExpenseFormData = z.infer<typeof expenseFormSchema>;

export default function ExpensesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineStatus();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [rangeOption, setRangeOption] = useState("this-month");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const { width: panelWidth, isResizing, isDesktop, onResizeStart } = usePanelResize("kirana:expenses-panel-width", { defaultWidth: 420 });

  const range = useMemo(() => rangeFor(rangeOption), [rangeOption]);
  const filters = { ...range, search: search.trim() || undefined, category: category === "all" ? undefined : category };
  const expensesQ = useQuery({ queryKey: ["expenses", filters], queryFn: () => listExpenses(filters) });
  const overviewQ = useQuery({ queryKey: ["expense-overview"], queryFn: getExpenseOverview });

  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["expenses"] }); void queryClient.invalidateQueries({ queryKey: ["expense-overview"] }); };

  // Expenses are online-first (unlike bills). Offline they can't be saved yet,
  // so say so plainly instead of a misleading "Try again" that won't help.
  const offlineNotice = () => toast({
    title: "You're offline",
    description: "Expenses need a connection right now. Reconnect and save again — your typed details stay in the form.",
    variant: "destructive",
  });

  const saveMut = useMutation({
    mutationFn: (vars: { id?: string; data: ExpenseInput }) => (vars.id ? updateExpense(vars.id, vars.data) : createExpense(vars.data)),
    onSuccess: () => { invalidate(); setPanelOpen(false); setEditing(null); toast({ title: editing ? "Expense updated" : "Expense saved" }); },
    onError: (err: unknown) => {
      if (!isOnline) return offlineNotice();
      toast({ title: "Could not save", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteExpense(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "Expense moved to recycle bin" }); },
    onError: (err: unknown) => {
      if (!isOnline) return offlineNotice();
      toast({ title: "Could not delete", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    },
  });

  const rows = expensesQ.data ?? [];
  const ov = overviewQ.data;
  const topCategory = ov ? Object.entries(ov.byCategory).sort((a, b) => b[1] - a[1])[0] : undefined;
  const todayDelta = ov ? pctDelta(ov.today, ov.yesterday) : null;
  const monthDelta = ov ? pctDelta(ov.month, ov.lastMonth) : null;

  const donutData = useMemo(() => {
    if (!ov) return [];
    return Object.entries(ov.byCategory).sort((a, b) => b[1] - a[1]).map(([name, value], i) => ({ name, value, color: PALETTE[i % PALETTE.length] }));
  }, [ov]);
  const trendData = useMemo(() => (ov?.trend ?? []).map((t) => ({ ...t, label: monthLabel(t.month) })), [ov]);
  const trendDelta = useMemo(() => {
    const t = ov?.trend ?? [];
    if (t.length < 2) return null;
    return pctDelta(t[t.length - 1].total, t[0].total);
  }, [ov]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  function exportCsv() {
    const header = ["Date", "Description", "Category", "Vendor", "Payment Mode", "Status", "Amount", "Recorded By", "Notes"];
    const lines = rows.map((e) => [fmtDate(e.spentAt), e.title, e.category, e.vendor ?? "", e.paymentMode, e.status, e.amount, e.recordedBy ?? "", e.notes ?? ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "kirana-expenses.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function openAdd() { setEditing(null); setPanelOpen(true); }
  function openEdit(e: Expense) { setEditing(e); setPanelOpen(true); }

  return (
    <div
      className={cn("app-docked-page", isResizing ? "" : "transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]")}
      style={panelOpen && isDesktop ? { paddingRight: panelWidth + 24 } : undefined}
    >
      <div className="space-y-4">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
          <Kpi icon={<Wallet size={16} />} iconBg="bg-[var(--brand-soft)] text-[var(--brand)]" label="Today's Expenses" value={inr(ov?.today)}
            sub={todayDelta == null ? "vs yesterday" : `${Math.abs(todayDelta)}% vs yesterday`} subTone={todayDelta == null ? "muted" : todayDelta <= 0 ? "good" : "bad"} loading={overviewQ.isLoading} />
          <Kpi icon={<CalendarDays size={16} />} iconBg="bg-violet-50 text-violet-600" label="This Month's Expenses" value={inr(ov?.month)}
            sub={monthDelta == null ? "vs last month" : `${Math.abs(monthDelta)}% vs last month`} subTone={monthDelta == null ? "muted" : monthDelta <= 0 ? "good" : "bad"} loading={overviewQ.isLoading} />
          <Kpi icon={<Clock3 size={16} />} iconBg="bg-amber-50 text-amber-600" label="Pending Payouts" value={inr(ov?.pendingTotal)}
            sub={`${ov?.pendingCount ?? 0} payment${(ov?.pendingCount ?? 0) === 1 ? "" : "s"} pending`} subTone="warn" loading={overviewQ.isLoading} />
          <Kpi icon={<PieIcon size={16} />} iconBg="bg-emerald-50 text-emerald-600" label="Top Expense Category" value={topCategory?.[0] ?? "—"}
            sub={topCategory && ov?.month ? `${inr(topCategory[1])} (${Math.round((topCategory[1] / ov.month) * 100)}%)` : "No expenses yet"} subTone="muted" loading={overviewQ.isLoading} />
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,35,80,0.04)] lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <Input className="h-10 pl-9" placeholder="Search by description, vendor or notes…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={rangeOption} onValueChange={(v) => { setRangeOption(v); setPage(1); }}>
            <SelectTrigger className="h-10 w-full lg:w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="this-month">This Month</SelectItem>
              <SelectItem value="last-month">Last Month</SelectItem>
              <SelectItem value="last-3-months">Last 3 Months</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
            <SelectTrigger className="h-10 w-full lg:w-[170px]"><SelectValue placeholder="All Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" className="h-10 gap-2 rounded-[10px] font-bold" onClick={exportCsv} disabled={rows.length === 0}><Download size={15} /> Export</Button>
          <Button onClick={openAdd} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-10 gap-2 rounded-[10px] font-bold text-white hover:opacity-95">
            <Plus size={16} /> Add Expense
          </Button>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4 min-[430px]:grid-cols-2 xl:grid-cols-[380px_1fr]">
          {/* Category donut */}
          <div className="rounded-[14px] border border-[#e6ecf4] bg-white p-5 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
            <h3 className="font-display text-[14px] font-black tracking-tight text-[#102347]">Expenses by Category</h3>
            <p className="text-[11px] text-[#64748b]">This month</p>
            {donutData.length === 0 ? (
              <p className="py-12 text-center text-[12px] text-[#94a3b8]">No expenses this month yet.</p>
            ) : (
              <div className="mt-2 flex items-center gap-4">
                <div className="relative h-[150px] w-[150px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={72} paddingAngle={2} strokeWidth={0}>
                        {donutData.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => inr(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <div className="text-center">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#94a3b8]">Total</p>
                      <p className="font-display text-[15px] font-black text-[#102347]">{inr(ov?.month)}</p>
                    </div>
                  </div>
                </div>
                <ul className="min-w-0 flex-1 space-y-1.5">
                  {donutData.slice(0, 6).map((d) => (
                    <li key={d.name} className="flex items-center gap-2 text-[11.5px]">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                      <span className="flex-1 truncate font-semibold text-[#344668]">{d.name}</span>
                      <span className="shrink-0 font-bold text-[#102347]">{inr(d.value)}</span>
                      <span className="shrink-0 text-[10px] text-[#94a3b8]">({ov?.month ? Math.round((d.value / ov.month) * 100) : 0}%)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Monthly trend */}
          <div className="rounded-[14px] border border-[#e6ecf4] bg-white p-5 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-[14px] font-black tracking-tight text-[#102347]">Monthly Spending Trend</h3>
                <p className="text-[11px] text-[#64748b]">Last 6 months</p>
              </div>
            </div>
            <div className="mt-2 h-[170px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v: number) => (v >= 1000 ? `₹${Math.round(v / 1000)}K` : `₹${v}`)} width={48} />
                  <Tooltip formatter={(v: number) => [inr(v), "Spent"]} labelStyle={{ fontWeight: 700 }} />
                  <Line type="monotone" dataKey="total" stroke="var(--brand)" strokeWidth={2.5} dot={{ r: 3.5, fill: "#fff", stroke: "var(--brand)", strokeWidth: 2 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-[#eef2f8] pt-2.5 text-[12px]">
              <span className="text-[#64748b]">Average monthly expense: <span className="font-bold text-[#102347]">{inr(ov?.monthlyAverage)}</span></span>
              {trendDelta != null && (
                <span className={cn("flex items-center gap-1 font-bold", trendDelta <= 0 ? "text-emerald-600" : "text-rose-500")}>
                  {trendDelta <= 0 ? <ArrowDown size={13} /> : <ArrowUp size={13} />}{Math.abs(trendDelta)}% vs 6 months ago
                </span>
              )}
            </div>
          </div>
        </div>

        {/* All Expenses table */}
        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex items-center gap-2 border-b border-[#eef2f8] px-5 py-3.5">
            <h3 className="font-display text-[14px] font-black tracking-tight text-[#102347]">All Expenses</h3>
            <span className="text-[11px] text-[#94a3b8]">{rows.length === 0 ? "" : `Showing ${(safePage - 1) * pageSize + 1} to ${Math.min(safePage * pageSize, rows.length)} of ${rows.length} expenses`}</span>
          </div>
          {expensesQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : expensesQ.isError ? (
            <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load expenses. Check your connection and retry.</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Receipt size={22} /></span>
              <p className="text-[13px] font-bold text-[#102347]">No expenses found</p>
              <p className="text-[12px] text-[#64748b]">Add rent, salary, utilities and other costs to track your profit.</p>
            </div>
          ) : (
            <>
              <div className="space-y-2.5 p-3 md:hidden">
                {pageRows.map((e) => {
                  const Icon = CATEGORY_ICON[e.category] ?? MoreHorizontal;
                  const color = donutData.find((d) => d.name === e.category)?.color ?? "#64748b";
                  return (
                    <article key={e.id} className="rounded-[16px] border border-[#e4ebf4] bg-white p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
                      <div className="flex items-start gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]" style={{ background: `${color}1a`, color }}><Icon size={18} /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-extrabold text-[#07133f]">{e.title}</p>
                          <p className="mt-1 truncate text-xs font-medium text-[#53617d]">{e.category}{e.vendor ? ` • ${e.vendor}` : ""}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", MODE_BADGE[e.paymentMode] ?? MODE_BADGE.other)}>{MODES.find((m) => m.value === e.paymentMode)?.label ?? e.paymentMode}</span>
                            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", e.status === "pending" ? CHIP_TONES.amber : CHIP_TONES.green)}>{e.status === "pending" ? "Pending" : "Paid"}</span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[15px] font-black text-[#07133f]">{inr(e.amount)}</p>
                          <p className="mt-1 text-[11px] font-medium text-[#71809b]">{fmtDate(e.spentAt)}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="outline" className="h-9 rounded-[10px] text-[11px] font-bold" onClick={() => openEdit(e)}><Pencil size={13} className="mr-1.5" /> Edit</Button>
                        <Button variant="outline" className="h-9 rounded-[10px] border-rose-200 text-[11px] font-bold text-rose-600 hover:bg-rose-50" onClick={() => setDeleting(e)}><Trash2 size={13} className="mr-1.5" /> Delete</Button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="app-table-scroll hidden overflow-x-auto md:block">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-bold">Date</th>
                      <th className="px-4 py-2.5 text-left font-bold">Category</th>
                      <th className="px-4 py-2.5 text-left font-bold">Vendor / Payee</th>
                      <th className="px-4 py-2.5 text-left font-bold">Description</th>
                      <th className="px-4 py-2.5 text-left font-bold">Payment Mode</th>
                      <th className="px-4 py-2.5 text-right font-bold">Amount</th>
                      <th className="px-4 py-2.5 text-left font-bold">Recorded By</th>
                      <th className="px-4 py-2.5 text-left font-bold">Status</th>
                      <th className="px-4 py-2.5 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((e, i) => {
                      const Icon = CATEGORY_ICON[e.category] ?? MoreHorizontal;
                      const color = donutData.find((d) => d.name === e.category)?.color ?? "#64748b";
                      return (
                        <tr key={e.id} className={i < pageRows.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                          <td className="whitespace-nowrap px-4 py-3 text-[#52627e]">{fmtDate(e.spentAt)}</td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2 font-bold text-[#102347]">
                              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px]" style={{ background: `${color}1a`, color }}><Icon size={13} /></span>
                              {e.category}
                            </span>
                          </td>
                          <td className="max-w-[160px] truncate px-4 py-3 text-[#344668]">{e.vendor || "—"}</td>
                          <td className="max-w-[200px] truncate px-4 py-3 text-[#344668]" title={e.notes ?? undefined}>{e.title}</td>
                          <td className="px-4 py-3"><span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", MODE_BADGE[e.paymentMode] ?? MODE_BADGE.other)}>{MODES.find((m) => m.value === e.paymentMode)?.label ?? e.paymentMode}</span></td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-black text-[#102347]">{inr(e.amount)}</td>
                          <td className="max-w-[120px] truncate px-4 py-3 text-[#52627e]">{e.recordedBy || "—"}</td>
                          <td className="px-4 py-3">
                            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", e.status === "pending" ? CHIP_TONES.amber : CHIP_TONES.green)}>{e.status === "pending" ? "Pending" : "Paid"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              <button onClick={() => openEdit(e)} className="grid h-7 w-7 place-items-center rounded-[7px] text-[#536583] hover:bg-[#eef2f8]" aria-label="Edit"><Pencil size={13} /></button>
                              <button onClick={() => setDeleting(e)} className="grid h-7 w-7 place-items-center rounded-[7px] text-rose-500 hover:bg-rose-50" aria-label="Delete"><Trash2 size={13} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef2f8] px-4 py-2.5 sm:flex-row">
                <div className="flex items-center gap-1">
                  <PageBtn disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</PageBtn>
                  {Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => p === 1 || p === pageCount || Math.abs(p - safePage) <= 1).reduce<(number | "…")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1]) > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, []).map((p, i) => p === "…"
                    ? <span key={`gap-${i}`} className="px-1 text-[12px] text-[#94a3b8]">…</span>
                    : <PageBtn key={p} active={p === safePage} onClick={() => setPage(p)}>{p}</PageBtn>)}
                  <PageBtn disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>›</PageBtn>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#64748b]">
                  Rows per page
                  <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                    <SelectTrigger className="h-7 w-[64px] text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{[10, 25, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <ExpensePanel
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
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[#0f1e3d]">Delete this expense?</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[#52627e]">"{deleting?.title}" ({deleting ? inr(deleting.amount) : ""}) will move to the recycle bin. You can restore it later.</p>
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

function Kpi({ icon, iconBg, label, value, sub, subTone, loading }: { icon: React.ReactNode; iconBg: string; label: string; value: string; sub: string; subTone: "good" | "bad" | "warn" | "muted"; loading?: boolean }) {
  const subClass = subTone === "good" ? "text-emerald-600" : subTone === "bad" ? "text-rose-500" : subTone === "warn" ? "text-amber-600" : "text-[#94a3b8]";
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center gap-2.5">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[10px]", iconBg)}>{icon}</span>
        <p className="text-[11.5px] font-semibold text-[#64748b]">{label}</p>
      </div>
      <p className="mt-2 truncate font-display text-[22px] font-black leading-none text-[#102347]">{loading ? "…" : value}</p>
      <p className={cn("mt-1.5 flex items-center gap-1 text-[11px] font-bold", subClass)}>
        {subTone === "good" && <ArrowDown size={11} />}
        {subTone === "bad" && <ArrowUp size={11} />}
        {sub}
      </p>
    </div>
  );
}

function PageBtn({ children, active, disabled, onClick }: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn("grid h-7 min-w-7 place-items-center rounded-[7px] px-1.5 text-[12px] font-bold transition-colors",
        active ? "bg-[var(--brand)] text-white" : "text-[#52627e] hover:bg-[#eef2f8] disabled:opacity-40 disabled:hover:bg-transparent")}>
      {children}
    </button>
  );
}

/* ── Add / Edit docked panel ── */
function ExpensePanel({ open, editing, saving, width, onResizeStart, onClose, onSubmit }: {
  open: boolean; editing: Expense | null; saving: boolean; width: number;
  onResizeStart: (e: React.MouseEvent) => void; onClose: () => void; onSubmit: (data: ExpenseInput) => void;
}) {
  const form = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseFormSchema),
    values: {
      title: editing?.title ?? "",
      amount: editing?.amount ?? ("" as unknown as number),
      category: editing?.category ?? "Rent",
      paymentMode: (editing?.paymentMode as ExpenseFormData["paymentMode"]) ?? "cash",
      status: (editing?.status as ExpenseFormData["status"]) ?? "paid",
      spentAt: (editing?.spentAt ?? new Date().toISOString()).slice(0, 10),
      vendor: editing?.vendor ?? "",
      notes: editing?.notes ?? "",
      recurring: Boolean(editing && editing.recurringInterval !== "none"),
      recurringInterval: (editing?.recurringInterval && editing.recurringInterval !== "none" ? editing.recurringInterval : "monthly") as ExpenseFormData["recurringInterval"],
      nextDueOn: editing?.nextDueOn ? editing.nextDueOn.slice(0, 10) : "",
    },
  });
  const recurring = form.watch("recurring");

  function submit(v: ExpenseFormData) {
    onSubmit({
      title: v.title,
      amount: v.amount,
      category: v.category,
      paymentMode: v.paymentMode,
      status: v.status,
      spentAt: new Date(v.spentAt).toISOString(),
      vendor: v.vendor?.trim() || undefined,
      notes: v.notes?.trim() || undefined,
      recurringInterval: v.recurring ? v.recurringInterval : "none",
      nextDueOn: v.recurring && v.nextDueOn ? new Date(v.nextDueOn).toISOString() : undefined,
    });
  }

  return (
    <aside
      style={{ width }}
      className={`app-slide-panel fixed right-0 top-0 z-[80] flex h-full w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog" aria-label={editing ? "Edit expense" : "Add new expense"} aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">{editing ? "Edit Expense" : "Add New Expense"}</h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">{editing ? "Update this business expense" : "Record a new business expense"}</p>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <form onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <Fld label="Category *">
            <Select value={form.watch("category")} onValueChange={(v) => form.setValue("category", v)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Fld>
          <Fld label="Vendor / Payee"><Input className="h-10" placeholder="Shree Ganesh Properties" {...form.register("vendor")} /></Fld>
          <Fld label="Amount *" err={form.formState.errors.amount?.message}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-[#64748b]">₹</span>
              <Input className="h-10 pl-7" type="number" step="0.01" min="0" {...form.register("amount")} />
            </div>
          </Fld>
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Payment Mode *">
              <Select value={form.watch("paymentMode")} onValueChange={(v) => form.setValue("paymentMode", v as ExpenseFormData["paymentMode"])}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </Fld>
            <Fld label="Payment Date *" err={form.formState.errors.spentAt?.message}><Input className="h-10" type="date" {...form.register("spentAt")} /></Fld>
          </div>
          <Fld label="Description *" err={form.formState.errors.title?.message}><Input className="h-10" placeholder="Shop Rent – May 2024" {...form.register("title")} /></Fld>
          <Fld label="Status">
            <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v as ExpenseFormData["status"])}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="paid">Paid</SelectItem><SelectItem value="pending">Pending payout</SelectItem></SelectContent>
            </Select>
          </Fld>
          <Fld label="Notes (Optional)"><Input className="h-10" placeholder="Payment for shop rent – May 2024" {...form.register("notes")} /></Fld>

          <div className="flex items-center justify-between rounded-[10px] border border-[#e7edf7] px-3.5 py-2.5">
            <div>
              <p className="text-[13px] font-bold text-[#102347]">Recurring Expense</p>
              <p className="text-[11px] text-[#64748b]">Repeats on a schedule (rent, salary…)</p>
            </div>
            <Switch checked={recurring} onCheckedChange={(v) => form.setValue("recurring", v)} />
          </div>
          {recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Repeat Every">
                <Select value={form.watch("recurringInterval")} onValueChange={(v) => form.setValue("recurringInterval", v as ExpenseFormData["recurringInterval"])}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent>
                </Select>
              </Fld>
              <Fld label="Next Due On"><Input className="h-10" type="date" {...form.register("nextDueOn")} /></Fld>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#eef1f6] bg-white px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5 shadow-[0_-12px_30px_rgba(15,35,80,0.06)]">
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="outline" className="h-11 min-w-0 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-11 min-w-0 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Receipt size={15} /> Save Expense</>}
            </Button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function Fld({ label, err, children }: { label: string; err?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{label}</Label>
      {children}
      {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}
