import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Pencil, Plus, Receipt, Search, Trash2, TrendingDown, Wallet } from "lucide-react";
import { listExpenses, getExpenseSummary, createExpense, updateExpense, deleteExpense } from "@/features/expenses/api";
import type { Expense, ExpenseInput } from "@/types/api";

const CATEGORIES = ["Rent", "Salary", "Utilities", "Stock Purchase", "Transport", "Maintenance", "Marketing", "Misc"];
const MODES: { value: string; label: string }[] = [
  { value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }, { value: "bank", label: "Bank" }, { value: "card", label: "Card" }, { value: "other", label: "Other" },
];

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
  return { from, to };
}
function inr(n: number) { return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`; }
function fmtDate(iso?: string) { return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }

const expenseFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  amount: z.coerce.number().positive("Enter an amount"),
  category: z.string().min(1),
  paymentMode: z.enum(["cash", "upi", "bank", "card", "other"]),
  spentAt: z.string().min(1, "Date is required"),
  notes: z.string().max(500).optional(),
});
type ExpenseFormData = z.infer<typeof expenseFormSchema>;

export default function ExpensesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const range = useMemo(monthRange, []);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const filters = { ...range, search: search.trim() || undefined, category: category === "all" ? undefined : category };
  const expensesQ = useQuery({ queryKey: ["expenses", filters], queryFn: () => listExpenses(filters) });
  const summaryQ = useQuery({ queryKey: ["expense-summary", range], queryFn: () => getExpenseSummary(range) });

  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["expenses"] }); void queryClient.invalidateQueries({ queryKey: ["expense-summary"] }); };

  const saveMut = useMutation({
    mutationFn: (vars: { id?: string; data: ExpenseInput }) => (vars.id ? updateExpense(vars.id, vars.data) : createExpense(vars.data)),
    onSuccess: () => { invalidate(); setDialogOpen(false); setEditing(null); toast({ title: editing ? "Expense updated" : "Expense added" }); },
    onError: (err: unknown) => toast({ title: "Could not save", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteExpense(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "Expense moved to recycle bin" }); },
    onError: (err: unknown) => toast({ title: "Could not delete", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" }),
  });

  const rows = expensesQ.data ?? [];
  const summary = summaryQ.data;
  const topCategory = summary ? Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1])[0] : undefined;

  return (
    <div className="min-h-full bg-[#f7f9fd] px-4 py-4">
      <div className="mx-auto w-full max-w-[1200px] space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi icon={<TrendingDown size={16} />} label="Spent this month" value={summary ? inr(summary.total) : "—"} tone="rose" />
          <Kpi icon={<Receipt size={16} />} label="Expenses logged" value={summary ? String(summary.count) : "—"} tone="blue" />
          <Kpi icon={<Wallet size={16} />} label="Top category" value={topCategory ? topCategory[0] : "—"} sub={topCategory ? inr(topCategory[1]) : undefined} tone="violet" />
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,35,80,0.04)] sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <Input className="h-10 pl-9" placeholder="Search expenses…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-10 w-full sm:w-[180px]"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} style={{ background: "linear-gradient(180deg,#0057ff 0%,#0047e8 100%)" }} className="h-10 gap-2 rounded-[10px] font-bold text-white hover:opacity-95">
            <Plus size={16} /> Add Expense
          </Button>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="border-b border-[#eef2f8] px-5 py-3.5">
            <h3 className="font-display text-[14px] font-black tracking-tight text-[#102347]">This month's expenses</h3>
          </div>
          {expensesQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : expensesQ.isError ? (
            <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load expenses. Check your connection and retry.</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[#eef5ff] text-[#0057ff]"><Receipt size={22} /></span>
              <p className="text-[13px] font-bold text-[#102347]">No expenses yet</p>
              <p className="text-[12px] text-[#64748b]">Add rent, salary, utilities and other costs to track your profit.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-bold">Date</th>
                    <th className="px-5 py-2.5 text-left font-bold">Expense</th>
                    <th className="px-5 py-2.5 text-left font-bold">Category</th>
                    <th className="px-5 py-2.5 text-left font-bold">Mode</th>
                    <th className="px-5 py-2.5 text-right font-bold">Amount</th>
                    <th className="px-5 py-2.5 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e, i) => (
                    <tr key={e.id} className={i < rows.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                      <td className="whitespace-nowrap px-5 py-3 text-[#52627e]">{fmtDate(e.spentAt)}</td>
                      <td className="px-5 py-3">
                        <p className="font-bold text-[#102347]">{e.title}</p>
                        {e.notes && <p className="truncate text-[11px] text-[#94a3b8]">{e.notes}</p>}
                      </td>
                      <td className="px-5 py-3"><span className="rounded-[7px] bg-[#eef2f8] px-2 py-[3px] text-[11px] font-bold text-[#475569]">{e.category}</span></td>
                      <td className="px-5 py-3 capitalize text-[#52627e]">{e.paymentMode}</td>
                      <td className="px-5 py-3 text-right font-black text-[#102347]">{inr(e.amount)}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => { setEditing(e); setDialogOpen(true); }} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setDeleting(e)} className="grid h-8 w-8 place-items-center rounded-[8px] text-rose-500 hover:bg-rose-50" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ExpenseDialog
        open={dialogOpen}
        editing={editing}
        saving={saveMut.isPending}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
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

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone: "rose" | "blue" | "violet" }) {
  const ring = tone === "rose" ? "bg-rose-50 text-rose-600" : tone === "blue" ? "bg-[#eef5ff] text-[#0057ff]" : "bg-violet-50 text-violet-600";
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-[9px] ${ring}`}>{icon}</span>
      </div>
      <p className="mt-1.5 font-display text-[24px] font-black leading-none text-[#102347]">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-[#9aa6bb]">{sub}</p>}
    </div>
  );
}

function ExpenseDialog({ open, editing, saving, onClose, onSubmit }: { open: boolean; editing: Expense | null; saving: boolean; onClose: () => void; onSubmit: (data: ExpenseFormData) => void }) {
  const form = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseFormSchema),
    values: {
      title: editing?.title ?? "",
      amount: editing?.amount ?? ("" as unknown as number),
      category: editing?.category ?? "Misc",
      paymentMode: (editing?.paymentMode as ExpenseFormData["paymentMode"]) ?? "cash",
      spentAt: (editing?.spentAt ?? new Date().toISOString()).slice(0, 10),
      notes: editing?.notes ?? "",
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">{editing ? "Edit Expense" : "Add Expense"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => onSubmit({ ...v, spentAt: new Date(v.spentAt).toISOString() }))} className="space-y-3.5">
          <Fld label="Title" err={form.formState.errors.title?.message}><Input className="h-10" placeholder="Shop rent — June" {...form.register("title")} /></Fld>
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Amount (₹)" err={form.formState.errors.amount?.message}><Input className="h-10" type="number" step="0.01" min="0" {...form.register("amount")} /></Fld>
            <Fld label="Date" err={form.formState.errors.spentAt?.message}><Input className="h-10" type="date" {...form.register("spentAt")} /></Fld>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Category">
              <Select value={form.watch("category")} onValueChange={(v) => form.setValue("category", v)}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Fld>
            <Fld label="Payment mode">
              <Select value={form.watch("paymentMode")} onValueChange={(v) => form.setValue("paymentMode", v as ExpenseFormData["paymentMode"])}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </Fld>
          </div>
          <Fld label="Notes (optional)"><Input className="h-10" placeholder="Reference, bill no, etc." {...form.register("notes")} /></Fld>
          <div className="flex gap-2.5 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving} style={{ background: "linear-gradient(180deg,#0057ff 0%,#0047e8 100%)" }} className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : editing ? "Save changes" : "Add expense"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
