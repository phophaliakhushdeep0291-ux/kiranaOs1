import { useEffect, useMemo, useState } from "react";
import { useListProducts, type Product } from "@/lib/api/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertTriangle, Boxes, ChevronLeft, ChevronRight, IndianRupee, Layers, MinusCircle, MoreVertical, PackageX, Plus, PlusCircle, Search } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { usePanelResize } from "@/hooks/use-panel-resize";
import { getProductEmoji } from "@/features/billing/pages/components/BillingSearch";
import { averageCost, fromBaseQty, isDeletedProduct, isLowStock, productDisplayUnit } from "@/features/products/pages/product-pricing";
import { productMatchesSearch } from "@/features/products/product-reliability";
import { StockMovementDialog } from "./StockMovementDialog";

const ROWS_PER_PAGE = 10;

function rs(value: number) {
  return `₹${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const CATEGORY_BADGE = [
  "bg-blue-50 text-blue-700", "bg-emerald-50 text-emerald-700", "bg-purple-50 text-purple-700",
  "bg-amber-50 text-amber-700", "bg-rose-50 text-rose-700", "bg-cyan-50 text-cyan-700",
  "bg-indigo-50 text-indigo-700", "bg-teal-50 text-teal-700",
];
function categoryBadge(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return CATEGORY_BADGE[h % CATEGORY_BADGE.length];
}

export function StockStatusView({ mode }: { mode: "in" | "out" }) {
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [extraF, setExtraF] = useState("all"); // suppliers (in) / item types (out)
  const [page, setPage] = useState(1);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveMode, setMoveMode] = useState<"in" | "out">(mode);
  const [movePreselect, setMovePreselect] = useState<string | undefined>(undefined);
  const { width: panelWidth, isDesktop, onResizeStart } = usePanelResize("kirana:stock-panel-width");
  const debouncedSearch = useDebounce(search.trim(), 150);

  const products = useListProducts({ limit: 1000 }, {
    query: { placeholderData: (p: Product[] | undefined) => p ?? [], staleTime: 2 * 60_000 },
  });

  const all = useMemo(() => (products.data ?? []).filter((p) => !isDeletedProduct(p)), [products.data]);
  const scoped = useMemo(
    () => all.filter((p) => (mode === "in" ? Number(p.stockBaseQty ?? 0) > 0 : Number(p.stockBaseQty ?? 0) <= 0)),
    [all, mode],
  );

  const suppliers = useMemo(() => [...new Set(scoped.map((p) => (p.brand ?? "").trim()).filter(Boolean))].sort(), [scoped]);

  const rows = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return scoped
      .filter((p) => {
        if (statusF === "all") return true;
        const low = isLowStock(p) && Number(p.stockBaseQty ?? 0) > 0;
        if (statusF === "low") return low;
        if (statusF === "in") return !low;
        return true; // "out" handled by scope
      })
      .filter((p) => {
        if (extraF === "all") return true;
        if (mode === "in") return (p.brand ?? "").trim() === extraF;
        return extraF === "loose" ? !!p.isLooseItem : !p.isLooseItem;
      })
      .filter((p) => productMatchesSearch(p, q));
  }, [scoped, statusF, extraF, mode, debouncedSearch]);

  const stats = useMemo(() => {
    const totalQty = scoped.reduce((s, p) => s + fromBaseQty(p.stockBaseQty, productDisplayUnit(p)), 0);
    const totalValue = scoped.reduce((s, p) => s + fromBaseQty(p.stockBaseQty, productDisplayUnit(p)) * averageCost(p), 0);
    const cats = new Set(scoped.map((p) => (p.category ?? "general").trim() || "general"));
    const lowCount = all.filter((p) => isLowStock(p) && Number(p.stockBaseQty ?? 0) > 0).length;
    return { count: scoped.length, totalQty: Math.round(totalQty), totalValue, cats: cats.size, lowCount };
  }, [scoped, all]);

  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  useEffect(() => { setPage(1); }, [debouncedSearch, statusF, extraF]);
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);
  const firstRow = rows.length === 0 ? 0 : (safePage - 1) * ROWS_PER_PAGE + 1;
  const lastRow = Math.min(safePage * ROWS_PER_PAGE, rows.length);

  function openMove(m: "in" | "out", productId?: string) {
    setMoveMode(m);
    setMovePreselect(productId);
    setMoveOpen(true);
  }

  const cards = mode === "in"
    ? [
        { icon: <Boxes size={18} />, cls: "bg-blue-50 text-blue-600", label: "Items In Stock", value: stats.count.toLocaleString("en-IN"), sub: "Available to sell" },
        { icon: <Layers size={18} />, cls: "bg-violet-50 text-violet-600", label: "Total Quantity", value: stats.totalQty.toLocaleString("en-IN"), sub: "Units on hand" },
        { icon: <IndianRupee size={18} />, cls: "bg-emerald-50 text-emerald-600", label: "Stock Value", value: rs(stats.totalValue), sub: "At cost price" },
        { icon: <AlertTriangle size={18} />, cls: "bg-amber-50 text-amber-600", label: "Low Stock", value: stats.lowCount.toLocaleString("en-IN"), sub: "Needs attention" },
      ]
    : [
        { icon: <PackageX size={18} />, cls: "bg-rose-50 text-rose-600", label: "Out of Stock", value: stats.count.toLocaleString("en-IN"), sub: "Unavailable" },
        { icon: <Layers size={18} />, cls: "bg-violet-50 text-violet-600", label: "Categories Affected", value: stats.cats.toLocaleString("en-IN"), sub: "Across catalogue" },
        { icon: <AlertTriangle size={18} />, cls: "bg-amber-50 text-amber-600", label: "Low Stock", value: stats.lowCount.toLocaleString("en-IN"), sub: "Running low" },
        { icon: <Boxes size={18} />, cls: "bg-blue-50 text-blue-600", label: "Total Products", value: all.length.toLocaleString("en-IN"), sub: "In catalogue" },
      ];

  return (
    <div
      className="min-h-full bg-[#f7f9fd] px-4 py-4 transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={moveOpen && isDesktop ? { paddingRight: panelWidth + 16 } : undefined}
    >
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="flex items-center gap-3.5 rounded-[14px] border border-[#e6ecf4] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] ${c.cls}`}>{c.icon}</span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[#6d7c98]">{c.label}</p>
              <p className="font-display text-[22px] font-black leading-tight tracking-tight text-[#0f1e3d]">{c.value}</p>
              <p className="text-[11px] text-[#9aa6bb]">{c.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mt-3.5 flex flex-col gap-3 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7a9a]" aria-hidden="true" />
          <Input
            className="h-11 rounded-[10px] border-[#e3eaf3] bg-[#f8fafd] pl-10 text-[13px] font-medium text-[#0f2147] placeholder:text-[#6b7a9a] focus-visible:border-[#0057ff] focus-visible:bg-white focus-visible:ring-0"
            placeholder="Search by product name, barcode or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* extra filter: suppliers (in) / types (out) */}
        <Select value={extraF} onValueChange={setExtraF}>
          <SelectTrigger className="h-11 w-full rounded-[10px] border-[#e3eaf3] text-[13px] font-semibold md:w-44">
            <SelectValue placeholder={mode === "in" ? "All Suppliers" : "All Types"} />
          </SelectTrigger>
          <SelectContent>
            {mode === "in" ? (
              <>
                <SelectItem value="all">All Suppliers</SelectItem>
                {suppliers.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </>
            ) : (
              <>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="packed">Packed</SelectItem>
                <SelectItem value="loose">Loose</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>

        {/* status filter */}
        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="h-11 w-full rounded-[10px] border-[#e3eaf3] text-[13px] font-semibold md:w-40">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {mode === "in" ? (
              <>
                <SelectItem value="in">In Stock</SelectItem>
                <SelectItem value="low">Low Stock</SelectItem>
              </>
            ) : (
              <SelectItem value="out">Out of Stock</SelectItem>
            )}
          </SelectContent>
        </Select>

        <Button
          onClick={() => openMove(mode)}
          style={{ background: mode === "in" ? "linear-gradient(180deg,#005dff 0%,#0047e8 100%)" : "linear-gradient(180deg,#f43f5e 0%,#e11d48 100%)" }}
          className="h-11 shrink-0 gap-1.5 rounded-[10px] px-5 text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(15,23,42,0.12)] hover:opacity-95"
        >
          <Plus size={16} /> {mode === "in" ? "New Stock In" : "New Stock Out"}
        </Button>
      </div>

      {/* Table */}
      <div className="mt-3.5 overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-[13px]">
            <thead>
              <tr className="border-b-2 border-[#e6ecf4] bg-[#f9fbfd] text-[11px] font-bold uppercase tracking-wide text-[#7a89a3]">
                <th className="px-4 py-3 font-bold">Product</th>
                <th className="px-3 py-3 font-bold">Category</th>
                <th className="px-3 py-3 font-bold">SKU / Barcode</th>
                <th className="px-3 py-3 font-bold">Unit</th>
                <th className="px-3 py-3 text-center font-bold">Stock</th>
                <th className="px-3 py-3 text-right font-bold">Stock Value</th>
                <th className="px-3 py-3 text-center font-bold">Action</th>
              </tr>
            </thead>
            <tbody>
              {products.isLoading && rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-[#536383]">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center">
                  <p className="text-sm font-bold text-[#13274d]">{mode === "in" ? "No items in stock" : "Nothing is out of stock 🎉"}</p>
                  <p className="mt-1 text-xs text-[#536383]">{mode === "in" ? "Add stock to your products to see them here." : "All your products currently have stock."}</p>
                </td></tr>
              ) : (
                pagedRows.map((p) => {
                  const unit = productDisplayUnit(p);
                  const qty = fromBaseQty(p.stockBaseQty, unit);
                  const value = qty * averageCost(p);
                  const cat = (p.category ?? "general").trim() || "general";
                  const low = isLowStock(p) && qty > 0;
                  const brand = p.brand ?? p.aliases?.[0] ?? "";
                  return (
                    <tr key={p.id} className="border-b border-[#f1f4f8] last:border-0 transition-colors hover:bg-[#f9fbfe]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[#f4f7fb] text-lg">
                            {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-full w-full object-contain" /> : getProductEmoji(p.name, p.category)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-extrabold text-[#14284e]">{p.name}</p>
                            {brand && <p className="truncate text-[11px] text-[#8a97ad]">{brand}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${categoryBadge(cat)}`}>{cat.replace(/_/g, " ")}</span>
                      </td>
                      <td className="px-3 py-3"><span className="font-mono text-[12px] text-[#45577a]">{p.barcode ?? p.sku ?? "—"}</span></td>
                      <td className="px-3 py-3 capitalize text-[#45577a]">{unit}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`font-bold ${mode === "out" ? "text-rose-600" : low ? "text-amber-600" : "text-[#13274d]"}`}>{qty}</span>
                          {mode === "out" ? <StatusBadge tone="rose">Out of Stock</StatusBadge> : low ? <StatusBadge tone="amber">Low Stock</StatusBadge> : <StatusBadge tone="emerald">In Stock</StatusBadge>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-extrabold text-[#13274d]">{mode === "out" ? "—" : rs(value)}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-[#f1f4f8] data-[state=open]:bg-[#eef4ff] data-[state=open]:text-[#0057ff]" aria-label={`Actions for ${p.name}`}>
                                <MoreVertical size={16} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onClick={() => openMove("in", p.id)}><PlusCircle size={14} className="mr-2 text-emerald-600" /> Stock In</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openMove("out", p.id)} disabled={qty <= 0}><MinusCircle size={14} className="mr-2 text-rose-600" /> Stock Out</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div className="flex flex-col items-center gap-3 border-t border-[#eef1f6] px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-0">
            <p className="text-[12px] text-[#6d7c98] sm:justify-self-start">
              Showing <span className="font-bold text-[#13274d]">{firstRow}</span> to <span className="font-bold text-[#13274d]">{lastRow}</span> of <span className="font-bold text-[#13274d]">{rows.length.toLocaleString("en-IN")}</span> {mode === "in" ? "items" : "out-of-stock items"}
            </p>
            <div className="sm:justify-self-center"><Pagination page={safePage} totalPages={totalPages} onChange={setPage} /></div>
            <span className="text-[11px] text-[#9aa6bb] sm:justify-self-end">{ROWS_PER_PAGE} per page</span>
          </div>
        )}
      </div>

      <StockMovementDialog mode={moveMode} open={moveOpen} onOpenChange={setMoveOpen} initialProductId={movePreselect} width={panelWidth} onResizeStart={onResizeStart} />
    </div>
  );
}

function StatusBadge({ tone, children }: { tone: "emerald" | "amber" | "rose"; children: React.ReactNode }) {
  const map = {
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
  } as const;
  const dot = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500" } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[7px] px-2 py-[3px] text-[11px] font-bold ${map[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} />
      {children}
    </span>
  );
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const pages: (number | "…")[] = [];
  if (totalPages <= 7) for (let i = 1; i <= totalPages; i++) pages.push(i);
  else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} className="grid h-8 w-8 place-items-center rounded-lg border border-[#e3eaf3] text-[#536383] transition-colors hover:bg-[#f7f9fd] disabled:opacity-40" aria-label="Previous"><ChevronLeft size={15} /></button>
      {pages.map((p, i) => p === "…" ? <span key={`e${i}`} className="px-1.5 text-[12px] text-[#9aa6bb]">…</span> : (
        <button key={p} onClick={() => onChange(p)} className={`grid h-8 min-w-8 place-items-center rounded-lg px-2 text-[12px] font-bold transition-colors ${p === page ? "bg-[#0057ff] text-white shadow-[0_4px_10px_rgba(0,87,255,0.25)]" : "border border-[#e3eaf3] text-[#45577a] hover:bg-[#f7f9fd]"}`}>{p}</button>
      ))}
      <button onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="grid h-8 w-8 place-items-center rounded-lg border border-[#e3eaf3] text-[#536383] transition-colors hover:bg-[#f7f9fd] disabled:opacity-40" aria-label="Next"><ChevronRight size={15} /></button>
    </div>
  );
}
