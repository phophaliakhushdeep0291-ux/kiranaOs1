import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listCustomers, recordUdharPayment, udharSummary } from "../lib/api";
import { inr } from "../lib/money";
import { toast } from "sonner";
import { Users, Wallet } from "lucide-react";

export default function Customers() {
  const qc = useQueryClient();
  const cs = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const su = useQuery({ queryKey: ["udhar-summary"], queryFn: udharSummary });

  const [amounts, setAmounts] = useState({});
  const [modes, setModes] = useState({});

  const pay = useMutation({
    mutationFn: ({ customerId, amount, mode }) => recordUdharPayment({ customerId, amount, mode }),
    onSuccess: () => {
      toast.success("Repayment recorded");
      qc.invalidateQueries();
      setAmounts({});
    },
    onError: (e) => toast.error(e?.response?.data?.error || e.message),
  });

  const rows = (cs.data || []).filter((c) => Number(c.udharAmount || 0) > 0);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-violet-600 text-white grid place-items-center">
          <Users size={18} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold" data-testid="customers-title">Customers · Udhar</h1>
          <p className="text-sm text-slate-500" data-testid="udhar-total">
            Total outstanding: <b>{inr(su.data?.totalOutstanding ?? 0)}</b>
            {" "}· {rows.length} customer(s) owe you
          </p>
        </div>
      </header>

      <section className="card divide-y divide-slate-100" data-testid="customers-list">
        {cs.isLoading && <div className="p-6 text-slate-500">Loading…</div>}
        {rows.length === 0 && !cs.isLoading && (
          <div className="p-6 text-slate-400">No outstanding udhar — nicely done.</div>
        )}
        {rows.map((c) => {
          const amt = amounts[c.id] ?? "";
          const mode = modes[c.id] ?? "cash";
          return (
            <div key={c.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4" data-testid={`customer-row-${c.id}`}>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-xs text-slate-500">{c.mobile || "no mobile"}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400 uppercase">Outstanding</div>
                <div className="font-semibold text-amber-700" data-testid={`customer-udhar-${c.id}`}>{inr(c.udharAmount)}</div>
              </div>
              <div className="flex gap-2 items-center">
                <select
                  value={mode}
                  onChange={(e) => setModes({ ...modes, [c.id]: e.target.value })}
                  className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  data-testid={`repay-mode-${c.id}`}
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                </select>
                <input
                  type="number"
                  inputMode="decimal"
                  className="w-28 border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  placeholder="Amount"
                  value={amt}
                  onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                  data-testid={`repay-amount-${c.id}`}
                />
                <button
                  className="btn btn-primary text-sm"
                  disabled={!amt || Number(amt) <= 0 || pay.isPending}
                  onClick={() => pay.mutate({ customerId: c.id, amount: Number(amt), mode })}
                  data-testid={`repay-submit-${c.id}`}
                >
                  <Wallet size={14} /> Repay
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
