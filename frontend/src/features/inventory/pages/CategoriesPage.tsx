import { useMemo, useState } from "react";
import { useListProducts, type Product } from "@/lib/api/client";
import { Input } from "@/components/ui/input";
import { Boxes, FolderTree, Layers, Search, TrendingUp } from "lucide-react";
import { isDeletedProduct } from "@/features/products/pages/product-pricing";

const BADGE = [
  "bg-blue-50 text-blue-700", "bg-emerald-50 text-emerald-700", "bg-purple-50 text-purple-700",
  "bg-amber-50 text-amber-700", "bg-rose-50 text-rose-700", "bg-cyan-50 text-cyan-700",
  "bg-indigo-50 text-indigo-700", "bg-teal-50 text-teal-700",
];
function badge(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return BADGE[h % BADGE.length];
}

export default function CategoriesPage() {
  const [search, setSearch] = useState("");
  const products = useListProducts({ limit: 1000 }, {
    query: { placeholderData: (p: Product[] | undefined) => p ?? [], staleTime: 2 * 60_000 },
  });

  const all = useMemo(() => (products.data ?? []).filter((p) => !isDeletedProduct(p)), [products.data]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    all.forEach((p) => {
      const c = (p.category ?? "general").trim() || "general";
      map.set(c, (map.get(c) ?? 0) + 1);
    });
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [all]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories;
  }, [categories, search]);

  const total = all.length;
  const largest = categories[0];
  const avg = categories.length ? Math.round(total / categories.length) : 0;

  const cards = [
    { icon: <Layers size={18} />, cls: "bg-violet-50 text-violet-600", label: "Total Categories", value: categories.length.toLocaleString("en-IN"), sub: "In use" },
    { icon: <Boxes size={18} />, cls: "bg-blue-50 text-blue-600", label: "Total Products", value: total.toLocaleString("en-IN"), sub: "Across categories" },
    { icon: <TrendingUp size={18} />, cls: "bg-emerald-50 text-emerald-600", label: "Largest Category", value: largest ? String(largest.count) : "0", sub: largest ? largest.name.replace(/_/g, " ") : "—" },
    { icon: <FolderTree size={18} />, cls: "bg-amber-50 text-amber-600", label: "Avg / Category", value: avg.toLocaleString("en-IN"), sub: "Products each" },
  ];

  return (
    <div className="min-h-full bg-[#f7f9fd] px-4 py-4">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="flex items-center gap-3.5 rounded-[14px] border border-[#e6ecf4] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] ${c.cls}`}>{c.icon}</span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[#6d7c98]">{c.label}</p>
              <p className="font-display text-[22px] font-black leading-tight tracking-tight text-[#0f1e3d]">{c.value}</p>
              <p className="truncate text-[11px] capitalize text-[#9aa6bb]">{c.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3.5 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7a9a]" />
          <Input
            className="h-11 rounded-[10px] border-[#e3eaf3] bg-[#f8fafd] pl-10 text-[13px] font-medium text-[#0f2147] placeholder:text-[#6b7a9a] focus-visible:border-[#0057ff] focus-visible:bg-white focus-visible:ring-0"
            placeholder="Search categories"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3.5 overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b-2 border-[#e6ecf4] bg-[#f9fbfd] text-[11px] font-bold uppercase tracking-wide text-[#7a89a3]">
              <th className="px-4 py-3 font-bold">Category</th>
              <th className="px-3 py-3 text-right font-bold">Products</th>
              <th className="px-3 py-3 font-bold">Share of catalogue</th>
              <th className="px-3 py-3 text-center font-bold">Status</th>
            </tr>
          </thead>
          <tbody>
            {products.isLoading && rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-16 text-center text-sm text-[#536383]">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-16 text-center">
                <p className="text-sm font-bold text-[#13274d]">No categories yet</p>
                <p className="mt-1 text-xs text-[#536383]">Categories appear here as you assign them to products.</p>
              </td></tr>
            ) : (
              rows.map((c) => {
                const share = total ? Math.round((c.count / total) * 100) : 0;
                return (
                  <tr key={c.name} className="border-b border-[#f1f4f8] last:border-0 transition-colors hover:bg-[#f9fbfe]">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-bold capitalize ${badge(c.name)}`}>{c.name.replace(/_/g, " ")}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-extrabold text-[#13274d]">{c.count.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-[#eef1f6]">
                          <div className="h-full rounded-full bg-[#0057ff]" style={{ width: `${share}%` }} />
                        </div>
                        <span className="text-[12px] font-semibold text-[#6d7c98]">{share}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Active</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
