import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listProducts, listCustomers, confirmBill, uuid } from "../lib/api";
import { inr } from "../lib/money";
import { toast } from "sonner";
import { Plus, Minus, Search, Trash2, Wallet, Smartphone, Coins } from "lucide-react";

function paymentModeToBillType(mode) {
  return mode === "udhar" ? "udhar_entry" : "normal_sale";
}

export default function Billing() {
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const customers = useQuery({ queryKey: ["customers"], queryFn: listCustomers });

  const [q, setQ] = useState("");
  const [cart, setCart] = useState([]); // [{productId, name, quantity, rate, ...}]
  const [mode, setMode] = useState("cash"); // cash | upi | udhar
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");

  const filtered = useMemo(() => {
    const list = products.data ?? [];
    if (!q) return list.slice(0, 12);
    const needle = q.toLowerCase();
    return list.filter((p) => (p.name || "").toLowerCase().includes(needle)).slice(0, 12);
  }, [q, products.data]);

  const total = cart.reduce((s, c) => s + c.quantity * c.rate, 0);

  function addToCart(p) {
    const rate = p.defaultPricePerRateUnit ?? p.sellingPrice ?? 0;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, {
        productId: p.id,
        name: p.name,
        quantity: 1,
        rate,
        unit: p.rateUnit || p.baseUnit || "pcs",
      }];
    });
  }
  function updateQty(idx, delta) {
    setCart((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: Math.max(1, next[idx].quantity + delta) };
      return next;
    });
  }
  function removeLine(idx) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error("Cart is empty");
      if (mode === "udhar" && !customerId) throw new Error("Select a customer for udhar bills");
      const idempotencyKey = uuid();
      const payload = {
        billType: paymentModeToBillType(mode),
        gstMode: "none",
        customerId: customerId || undefined,
        customerName: customerName || "Walk-in",
        items: cart.map((c) => ({
          productId: c.productId,
          name: c.name,
          quantity: c.quantity,
          enteredUnit: c.unit,
          ratePerRateUnit: c.rate,
          gstRate: 0,
        })),
        payments: mode === "udhar" ? [] : [{ mode, amount: total }],
        actualAmount: total,
        buyerPaidAmount: mode === "udhar" ? 0 : total,
        creditAmount: mode === "udhar" ? total : 0,
        idempotencyKey,
      };
      return confirmBill(payload);
    },
    onSuccess: (data) => {
      toast.success(`Bill ${data.billNo || "created"} — ${inr(total)}`);
      setCart([]);
      setCustomerId(""); setCustomerName("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(e?.response?.data?.error || e.message),
  });

  return (
    <div className="p-4 md:p-6 grid lg:grid-cols-[1fr_400px] gap-4">
      {/* Products */}
      <section className="card p-4 space-y-3">
        <header className="flex items-center gap-2">
          <Search size={16} className="text-slate-400" />
          <input
            placeholder="Search products…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 border border-slate-200 rounded-md px-3 py-1.5"
            data-testid="billing-product-search"
          />
        </header>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {products.isLoading && <div className="text-slate-500">Loading…</div>}
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              className="text-left card p-3 hover:border-violet-400 hover:bg-violet-50 transition"
              data-testid={`product-tile-${p.id}`}
            >
              <div className="font-medium text-sm">{p.name}</div>
              <div className="text-xs text-slate-500 mt-1">₹{p.defaultPricePerRateUnit ?? p.sellingPrice ?? 0} / {p.rateUnit || p.baseUnit || "pcs"}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Cart */}
      <section className="card p-4 flex flex-col">
        <header className="pb-3 border-b border-slate-200">
          <div className="font-semibold" data-testid="cart-heading">Cart</div>
          <div className="text-xs text-slate-500">{cart.length} item(s)</div>
        </header>

        <div className="flex-1 overflow-y-auto py-3 -mx-4 px-4 space-y-2 min-h-[200px]">
          {cart.length === 0 && <div className="text-sm text-slate-400 text-center py-8">Tap a product to add</div>}
          {cart.map((c, i) => (
            <div key={i} className="flex items-center gap-2" data-testid={`cart-line-${i}`}>
              <div className="flex-1">
                <div className="text-sm font-medium">{c.name}</div>
                <div className="text-xs text-slate-500">₹{c.rate} × {c.quantity} {c.unit}</div>
              </div>
              <button onClick={() => updateQty(i, -1)} className="p-1 border border-slate-200 rounded" data-testid={`qty-minus-${i}`}><Minus size={14} /></button>
              <span className="w-6 text-center text-sm">{c.quantity}</span>
              <button onClick={() => updateQty(i, +1)} className="p-1 border border-slate-200 rounded" data-testid={`qty-plus-${i}`}><Plus size={14} /></button>
              <button onClick={() => removeLine(i)} className="p-1 text-red-500" data-testid={`line-remove-${i}`}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 pt-3 space-y-3">
          <div className="flex items-center justify-between text-lg">
            <span className="text-slate-600">Total</span>
            <span className="font-semibold" data-testid="cart-total">{inr(total)}</span>
          </div>

          {mode === "udhar" && (
            <div className="space-y-2">
              <select
                className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm"
                value={customerId}
                onChange={(e) => {
                  const cid = e.target.value;
                  setCustomerId(cid);
                  const found = (customers.data || []).find((c) => c.id === cid);
                  setCustomerName(found?.name || "");
                }}
                data-testid="udhar-customer-select"
              >
                <option value="">— pick customer —</option>
                {(customers.data || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} · ₹{c.udharAmount}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => setMode("cash")}  className={`btn ${mode === "cash"  ? "btn-primary" : "btn-ghost"} justify-center text-sm`} data-testid="mode-cash"><Wallet size={14} /> Cash</button>
            <button onClick={() => setMode("upi")}   className={`btn ${mode === "upi"   ? "btn-primary" : "btn-ghost"} justify-center text-sm`} data-testid="mode-upi"><Smartphone size={14} /> UPI</button>
            <button onClick={() => setMode("udhar")} className={`btn ${mode === "udhar" ? "btn-primary" : "btn-ghost"} justify-center text-sm`} data-testid="mode-udhar"><Coins size={14} /> Udhar</button>
          </div>

          <button
            className="btn btn-primary w-full justify-center"
            onClick={() => submit.mutate()}
            disabled={submit.isPending || cart.length === 0}
            data-testid="bill-submit"
          >
            {submit.isPending ? "Saving…" : `Save ${mode} bill · ${inr(total)}`}
          </button>
        </div>
      </section>
    </div>
  );
}
