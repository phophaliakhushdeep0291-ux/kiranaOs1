import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useListProducts, type Product } from "@/lib/api/client";
import { PanelResizeHandle, usePanelResize } from "@/hooks/use-panel-resize";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Boxes, ChevronLeft, ChevronRight, FolderTree, Layers, MoreVertical, Pencil, Plus, Power, Search, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isDeletedProduct } from "@/features/core/products/pages/product-pricing";
import { descendantIds, loadCategories, mergeCategories, newCategoryId, saveCategories, type ShopCategory } from "@/features/core/inventory/category-store";
import { useSettingsPrefs } from "@/features/core/settings/use-settings-prefs";
import { useAppLanguage } from "@/features/core/settings/i18n";

const ROWS_PER_PAGE = 10;

export default function CategoriesPage() {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const { prefs, patch: patchSettings, hydrated: settingsHydrated } = useSettingsPrefs();
  const products = useListProducts({ limit: 1000 }, {
    query: { placeholderData: (p: Product[] | undefined) => p ?? [], staleTime: 2 * 60_000 },
  });
  const [cats, setCats] = useState<ShopCategory[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShopCategory | null>(null);
  const seededRef = useRef(false);
  const { width: panelWidth, isResizing, isDesktop, onResizeStart } = usePanelResize("kirana:category-panel-width");

  const productList = useMemo(() => (products.data ?? []).filter((p) => !isDeletedProduct(p)), [products.data]);

  // Load (and seed from product categories on first run)
  useEffect(() => {
    if (seededRef.current) return;
    let active = true;
    (async () => {
      if (!settingsHydrated) return;
      const cloudCategories = Array.isArray(prefs.categories) ? prefs.categories as ShopCategory[] : null;
      const localCategories = await loadCategories();
      const stored = mergeCategories(cloudCategories, localCategories);
      if (!active) return;
      if (stored && stored.length) {
        setCats(stored);
        void saveCategories(stored);
        if (JSON.stringify(stored) !== JSON.stringify(cloudCategories ?? [])) {
          void patchSettings({ categories: stored }, { immediate: true });
        }
        seededRef.current = true;
        return;
      }
      if (!products.data) return; // wait for products to seed from
      const names = [...new Set(productList.map((p) => (p.category ?? "general").trim() || "general"))];
      const now = new Date().toISOString();
      const seeded: ShopCategory[] = names.map((name) => ({ id: newCategoryId(), name, parentId: null, status: "active", createdAt: now, updatedAt: now, deletedAt: null }));
      setCats(seeded);
      void saveCategories(seeded);
      void patchSettings({ categories: seeded }, { immediate: true });
      seededRef.current = true;
    })();
    return () => { active = false; };
  }, [patchSettings, prefs.categories, products.data, productList, settingsHydrated]);

  // The shop query can arrive after IndexedDB hydration. Merge that later cloud
  // value instead of letting the first local render permanently win this mount.
  useEffect(() => {
    if (!seededRef.current || !Array.isArray(prefs.categories)) return;
    setCats((current) => {
      const merged = mergeCategories(prefs.categories as ShopCategory[], current);
      if (JSON.stringify(merged) === JSON.stringify(current)) return current;
      void saveCategories(merged);
      if (JSON.stringify(merged) !== JSON.stringify(prefs.categories)) void patchSettings({ categories: merged });
      return merged;
    });
  }, [patchSettings, prefs.categories]);

  function persist(next: ShopCategory[]) {
    setCats(next);
    void saveCategories(next);
    void patchSettings({ categories: next });
  }

  function productCount(name: string) {
    const n = name.trim().toLowerCase();
    return productList.filter((p) => ((p.category ?? "general").trim().toLowerCase()) === n).length;
  }
  const visibleCats = useMemo(() => cats.filter((category) => !category.deletedAt), [cats]);
  const nameById = useMemo(() => new Map(visibleCats.map((c) => [c.id, c.name])), [visibleCats]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleCats
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.parentId && (nameById.get(c.parentId) ?? "").toLowerCase().includes(q)))
      .sort((a, b) => (a.parentId === b.parentId ? a.name.localeCompare(b.name) : a.parentId ? 1 : -1));
  }, [visibleCats, search, nameById]);

  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  useEffect(() => { setPage(1); }, [search]);
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);
  const firstRow = rows.length === 0 ? 0 : (safePage - 1) * ROWS_PER_PAGE + 1;
  const lastRow = Math.min(safePage * ROWS_PER_PAGE, rows.length);

  const stats = {
    total: visibleCats.length,
    root: visibleCats.filter((c) => !c.parentId).length,
    sub: visibleCats.filter((c) => c.parentId).length,
    products: productList.length,
  };

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: ShopCategory) => { setEditing(c); setDialogOpen(true); };

  function saveCategory(values: { name: string; parentId: string | null; status: "active" | "inactive" }) {
    const name = values.name.trim();
    if (!name) { toast({ title: t("inventory.categories.nameRequired"), variant: "destructive" }); return; }
    const dupe = visibleCats.find((c) => c.name.trim().toLowerCase() === name.toLowerCase() && c.id !== editing?.id);
    if (dupe) { toast({ title: t("inventory.categories.exists"), variant: "destructive" }); return; }
    if (editing) {
      persist(cats.map((c) => (c.id === editing.id ? { ...c, name, parentId: values.parentId, status: values.status, updatedAt: new Date().toISOString() } : c)));
      toast({ title: t("inventory.categories.updated") });
    } else {
      const now = new Date().toISOString();
      persist([...cats, { id: newCategoryId(), name, parentId: values.parentId, status: values.status, createdAt: now, updatedAt: now, deletedAt: null }]);
      toast({ title: t("inventory.categories.added") });
    }
    setDialogOpen(false);
  }

  function toggleStatus(c: ShopCategory) {
    persist(cats.map((x) => (x.id === c.id ? { ...x, status: x.status === "active" ? "inactive" : "active", updatedAt: new Date().toISOString() } : x)));
  }
  function removeCategory(c: ShopCategory) {
    // Keep a tombstone so another device cannot resurrect a deleted category.
    const now = new Date().toISOString();
    persist(cats.map((x) => x.id === c.id
      ? { ...x, deletedAt: now, updatedAt: now }
      : x.parentId === c.id ? { ...x, parentId: null, updatedAt: now } : x));
    toast({ title: t("inventory.categories.deleted") });
  }

  const cards = [
    { icon: <Layers size={18} />, cls: "bg-violet-50 text-violet-600", label: "Total Categories", value: stats.total, sub: "Active categories" },
    { icon: <FolderTree size={18} />, cls: "bg-blue-50 text-blue-600", label: "Root Categories", value: stats.root, sub: "Top level categories" },
    { icon: <FolderTree size={18} />, cls: "bg-amber-50 text-amber-600", label: "Sub Categories", value: stats.sub, sub: "Child categories" },
    { icon: <Boxes size={18} />, cls: "bg-emerald-50 text-emerald-600", label: "Products", value: stats.products, sub: "Under categories" },
  ];

  return (
    <div
      className={`app-docked-page ${isResizing ? "" : "transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"}`}
      style={dialogOpen && isDesktop ? { paddingRight: panelWidth + 24 } : undefined}
    >
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="flex items-center gap-3.5 rounded-[14px] border border-[#e6ecf4] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] ${c.cls}`}>{c.icon}</span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[#6d7c98]">{c.label}</p>
              <p className="font-display text-[22px] font-black leading-tight tracking-tight text-[var(--brand-ink)]">{c.value.toLocaleString("en-IN")}</p>
              <p className="text-[11px] text-[#9aa6bb]">{c.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mt-3.5 flex flex-col gap-3 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7a9a]" />
          <Input
            className="h-11 rounded-[10px] border-[#e3eaf3] bg-[#f8fafd] pl-10 text-[13px] font-medium text-[var(--brand-ink)] placeholder:text-[#6b7a9a] focus-visible:border-[var(--brand)] focus-visible:bg-white focus-visible:ring-0"
            placeholder="Search categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={openAdd} className="h-11 shrink-0 gap-1.5 rounded-[10px] px-5 text-[13px] font-bold shadow-[0_8px_18px_rgba(0,77,255,0.22)]">
          <Plus size={16} /> Add Category
        </Button>
      </div>

      {/* Table */}
      <div className="mt-3.5 overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="app-scrollbar overflow-x-auto">
        <table className="min-w-[620px] w-full text-left text-[13px]">
          <thead>
            <tr className="border-b-2 border-[#e6ecf4] bg-[#f9fbfd] text-[11px] font-bold uppercase tracking-wide text-[#7a89a3]">
              <th className="px-4 py-3 font-bold">{t("inventory.categories.name")}</th>
              <th className="px-3 py-3 font-bold">{t("inventory.categories.parent")}</th>
              <th className="px-3 py-3 text-right font-bold">{t("inventory.categories.products")}</th>
              <th className="px-3 py-3 text-center font-bold">{t("inventory.col.status")}</th>
              <th className="px-3 py-3 text-center font-bold">{t("inventory.col.action")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-16 text-center">
                <p className="text-sm font-bold text-[#13274d]">{t("inventory.categories.empty")}</p>
                <p className="mt-1 text-xs text-[#536383]">{t("inventory.categories.emptyHelp")}</p>
              </td></tr>
            ) : (
              pagedRows.map((c) => (
                <tr key={c.id} className="border-b border-[#f1f4f8] last:border-0 transition-colors hover:bg-[#f9fbfe]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#f4f7fb] text-[#536383]">
                        <FolderTree size={15} />
                      </span>
                      <span className="font-extrabold capitalize text-[#14284e]">{c.name.replace(/_/g, " ")}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {c.parentId ? (
                      <span className="capitalize text-[#45577a]">{(nameById.get(c.parentId) ?? "—").replace(/_/g, " ")}</span>
                    ) : (
                      <span className="text-[#9aa6bb]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-bold text-[#13274d]">{productCount(c.name).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-flex items-center gap-1.5 rounded-[7px] px-2 py-[3px] text-[11px] font-bold ${c.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${c.status === "active" ? "bg-emerald-500" : "bg-slate-400"}`} />
                      {c.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-[#f1f4f8] data-[state=open]:bg-[#eef4ff] data-[state=open]:text-[var(--brand)]" aria-label={`Actions for ${c.name}`}>
                          <MoreVertical size={16} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => openEdit(c)}><Pencil size={14} className="mr-2" /> {t("inventory.edit")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleStatus(c)}><Power size={14} className="mr-2" /> {c.status === "active" ? "Deactivate" : "Activate"}</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => removeCategory(c)}><Trash2 size={14} className="mr-2" /> {t("inventory.delete")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>

        {rows.length > 0 && (
          <div className="flex flex-col items-center gap-3 border-t border-[#eef1f6] px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-0">
            <p className="text-[12px] text-[#6d7c98] sm:justify-self-start">
              Showing <span className="font-bold text-[#13274d]">{firstRow}</span> to <span className="font-bold text-[#13274d]">{lastRow}</span> of <span className="font-bold text-[#13274d]">{rows.length}</span> categories
            </p>
            <div className="sm:justify-self-center"><Pagination page={safePage} totalPages={totalPages} onChange={setPage} /></div>
            <span className="text-[11px] text-[#9aa6bb] sm:justify-self-end">{ROWS_PER_PAGE} per page</span>
          </div>
        )}
      </div>

      <CategoryDialog open={dialogOpen} editing={editing} cats={visibleCats} width={panelWidth} onResizeStart={onResizeStart} onOpenChange={setDialogOpen} onSave={saveCategory} />
    </div>
  );
}

function CategoryDialog({
  open, editing, cats, width, onResizeStart, onOpenChange, onSave,
}: {
  open: boolean;
  editing: ShopCategory | null;
  cats: ShopCategory[];
  width: number;
  onResizeStart: (e: ReactMouseEvent) => void;
  onOpenChange: (o: boolean) => void;
  onSave: (v: { name: string; parentId: string | null; status: "active" | "inactive" }) => void;
}) {
  const { t } = useAppLanguage();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("none");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setParentId(editing?.parentId ?? "none");
      setStatus(editing?.status ?? "active");
    }
  }, [open, editing]);

  // valid parents: exclude self + descendants (no cycles)
  const blocked = editing ? descendantIds(editing.id, cats) : new Set<string>();
  const parentOptions = cats.filter((c) => c.id !== editing?.id && !blocked.has(c.id));

  return (
    <aside
      style={{ width }}
      className={`app-slide-panel fixed right-0 top-0 z-[80] flex h-[100dvh] w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog"
      aria-label={editing ? "Edit category" : "Add category"}
      aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">{editing ? "Edit Category" : "Add Category"}</h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">{editing ? "Update this category." : "Create a new product category."}</p>
        </div>
        <button onClick={() => onOpenChange(false)} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
        <div>
          <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("inventory.categories.name")}<span className="ml-0.5 text-rose-500">*</span></Label>
          <Input className="h-10" placeholder="e.g. Beverages" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("inventory.categories.parent")}</Label>
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("inventory.categories.none")}</SelectItem>
              {parentOptions.map((c) => <SelectItem key={c.id} value={c.id} className="capitalize">{c.name.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("inventory.col.status")}</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t("inventory.status.active")}</SelectItem>
              <SelectItem value="inactive">{t("inventory.status.inactive")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#eef1f6] bg-white px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5 shadow-[0_-12px_30px_rgba(15,35,80,0.06)]">
        <div className="grid grid-cols-2 gap-2.5">
          <Button type="button" variant="outline" className="h-11 min-w-0 rounded-[10px] font-bold" onClick={() => onOpenChange(false)}>{t("inventory.cancel")}</Button>
          <Button
            type="button"
            onClick={() => onSave({ name, parentId: parentId === "none" ? null : parentId, status })}
            style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
            className="h-11 min-w-0 rounded-[10px] font-black text-white hover:opacity-95"
          >
            {editing ? "Update Category" : "Add Category"}
          </Button>
        </div>
      </div>
    </aside>
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
    <div className="flex items-center gap-1.5 lg:mouse:gap-1">
      <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} className="grid h-11 w-11 place-items-center rounded-lg border border-[#e3eaf3] text-[#536383] transition-colors hover:bg-[#f7f9fd] disabled:opacity-40 lg:mouse:h-8 lg:mouse:w-8" aria-label="Previous"><ChevronLeft size={15} /></button>
      {pages.map((p, i) => p === "…" ? <span key={`e${i}`} className="px-1.5 text-[12px] text-[#9aa6bb]">…</span> : (
        <button key={p} onClick={() => onChange(p)} aria-current={p === page ? "page" : undefined}
            className={`grid h-11 min-w-11 place-items-center rounded-lg px-2 text-[12px] font-bold transition-colors lg:mouse:h-8 lg:mouse:min-w-8 ${p === page ? "bg-[var(--brand)] text-white shadow-[0_4px_10px_rgba(0,87,255,0.25)]" : "border border-[#e3eaf3] text-[#45577a] hover:bg-[#f7f9fd]"}`}>{p}</button>
      ))}
      <button onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="grid h-11 w-11 place-items-center rounded-lg border border-[#e3eaf3] text-[#536383] transition-colors hover:bg-[#f7f9fd] disabled:opacity-40 lg:mouse:h-8 lg:mouse:w-8" aria-label="Next"><ChevronRight size={15} /></button>
    </div>
  );
}
