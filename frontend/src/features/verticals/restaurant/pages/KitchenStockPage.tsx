import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle, ChefHat, CircleSlash, Loader2, Package, Plus, RefreshCw, Trash2, TrendingDown, Utensils,
} from "lucide-react";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import type { DishRecipeComponent, KitchenStock, MenuBoard, MenuDish, Product } from "@/types/api";
import {
  deleteRecipe, getKitchenStock, getMenuBoard, getRecipe, readCatalogueProducts, saveRecipe,
} from "../service/restaurant-api";

/**
 * What is left in the kitchen, and what it means for tonight's menu.
 *
 * A restaurant that runs on a retail stock screen is flying blind. That screen
 * counts dishes, and a dish is not a thing anybody buys or stores — the kitchen
 * buys chicken, cream and paneer, and those are what run out at 8:40pm with a
 * full room. So this page answers the two questions a cook actually has, and
 * keeps them apart because they are not the same question:
 *
 *   WHAT IS RUNNING OUT   → go and buy this
 *   WHAT CAN'T WE SERVE   → take this off the board, now
 *
 * One low ingredient empties several dishes, so neither list can be read off the
 * other. Nothing here decides for the kitchen: a dish that has run out is
 * reported, never silently 86'd, because a stock figure that drifted by 200 g
 * must not be allowed to empty a menu on its own.
 */

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function qtyLabel(qty: number, unit: string | null): string {
  const rounded = Math.round(qty * 100) / 100;
  return `${rounded.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
}

export default function KitchenStockPage() {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [stock, setStock] = useState<KitchenStock | null>(null);
  const [board, setBoard] = useState<MenuBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingDish, setEditingDish] = useState<MenuDish | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [nextStock, nextBoard, catalogue] = await Promise.all([
        getKitchenStock(),
        getMenuBoard(),
        readCatalogueProducts(),
      ]);
      setStock(nextStock);
      setBoard(nextBoard);
      setProducts(catalogue);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("restaurant.kitchenStock.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const dishes = useMemo(
    () => board?.courses.flatMap((section) => section.dishes) ?? [],
    [board],
  );
  const withoutRecipe = useMemo(() => {
    const known = new Set(stock?.dishes.map((row) => row.dishProductId) ?? []);
    return dishes.filter((dish) => !known.has(dish.id));
  }, [dishes, stock]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-[#64748b]">
        <Loader2 className="mr-2 animate-spin" size={18} /> {t("restaurant.kitchenStock.reading")}
      </div>
    );
  }

  const summary = stock?.summary;
  const alerting = (summary?.ingredientsOut ?? 0) + (summary?.ingredientsLow ?? 0) + (summary?.dishesOut ?? 0);

  return (
    <div className="space-y-5 p-4 lg:p-6" data-testid="kitchen-stock-page">
      <PageHeader
        title={t("restaurant.kitchenStock.title")}
        description={t("restaurant.kitchenStock.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] font-bold" onClick={() => void refresh()}>
              <RefreshCw size={15} /> {t("restaurant.kitchenStock.refresh")}
            </Button>
            <Button variant="outline" className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] font-bold" onClick={() => navigate("/menu")}>
              <Utensils size={15} /> {t("restaurant.kitchenStock.menu")}
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] p-3 text-[13px] text-[#b91c1c]">{error}</div>
      ) : null}

      {alerting > 0 ? (
        <div
          data-testid="kitchen-alert"
          className="flex items-start gap-2.5 rounded-2xl border border-[#fed7aa] bg-[#fff7ed] p-3.5"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#ea580c]" />
          <div className="text-[13px] leading-relaxed text-[#9a3412]">
            <span className="font-black">{t("restaurant.kitchenStock.beforeService")} </span>
            {[
              summary?.ingredientsOut ? `${summary.ingredientsOut} ingredient${summary.ingredientsOut === 1 ? " has" : "s have"} run out` : null,
              summary?.ingredientsLow ? `${summary.ingredientsLow} running low` : null,
              summary?.dishesOut ? `${summary.dishesOut} dish${summary.dishesOut === 1 ? "" : "es"} can't be made` : null,
            ].filter(Boolean).join(" · ")}.
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<CircleSlash size={15} />} label={t("restaurant.kitchenStock.statOut")} value={String(summary?.ingredientsOut ?? 0)} alarming={Boolean(summary?.ingredientsOut)} />
        <Stat icon={<TrendingDown size={15} />} label={t("restaurant.kitchenStock.statLow")} value={String(summary?.ingredientsLow ?? 0)} alarming={Boolean(summary?.ingredientsLow)} />
        <Stat icon={<Utensils size={15} />} label={t("restaurant.kitchenStock.statDishesOff")} value={String(summary?.dishesOut ?? 0)} alarming={Boolean(summary?.dishesOut)} />
        <Stat icon={<ChefHat size={15} />} label={t("restaurant.kitchenStock.statWithRecipes")} value={String(summary?.dishesWithRecipes ?? 0)} />
      </div>

      <section className="space-y-2">
        <h2 className="text-[12px] font-black uppercase tracking-wider text-[#64748b]">{t("restaurant.kitchenStock.runningOut")}</h2>
        {(stock?.ingredients.length ?? 0) === 0 ? (
          <EmptyCard>
            {t("restaurant.kitchenStock.noIngredients")}
          </EmptyCard>
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-white">
            {stock?.ingredients.map((row) => (
              <div key={row.productId} className="flex items-center gap-3 border-b px-3.5 py-2.5 last:border-b-0">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black uppercase",
                  CHIP_TONES[row.status === "out" ? "red" : row.status === "low" ? "amber" : "green"])}>
                  {row.status === "out" ? "Out" : row.status === "low" ? "Low" : "OK"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-[var(--brand-ink)]">{row.name}</div>
                  <div className="text-[11px] text-[#64748b]">
                    used in {row.usedInDishes} dish{row.usedInDishes === 1 ? "" : "es"}
                    {row.threshold > 0 ? ` · alert at ${qtyLabel(row.threshold, row.baseUnit)}` : ""}
                  </div>
                </div>
                <div className={cn("shrink-0 text-right font-display text-[15px] font-black",
                  row.status === "out" ? "text-[#dc2626]" : row.status === "low" ? "text-[#d97706]" : "text-[var(--brand-ink)]")}>
                  {qtyLabel(row.stockBaseQty, row.baseUnit)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[12px] font-black uppercase tracking-wider text-[#64748b]">{t("restaurant.kitchenStock.canServe")}</h2>
        {(stock?.dishes.length ?? 0) === 0 ? (
          <EmptyCard>{t("restaurant.kitchenStock.noRecipes")}</EmptyCard>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {stock?.dishes.map((row) => {
              const dish = dishes.find((item) => item.id === row.dishProductId);
              return (
                <button
                  key={row.dishProductId}
                  type="button"
                  onClick={() => dish && setEditingDish(dish)}
                  className="rounded-2xl border bg-white p-3.5 text-left"
                  data-testid={`kitchen-dish-${row.dishProductId}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate font-display text-[15px] font-black text-[var(--brand-ink)]">{row.name}</span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase",
                      CHIP_TONES[row.status === "out" ? "red" : row.status === "low" ? "amber" : row.status === "unknown" ? "gray" : "green"])}>
                      {row.portionsPossible === null ? "no limit" : `${row.portionsPossible} left`}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748b]">
                    {row.componentCount} ingredient{row.componentCount === 1 ? "" : "s"}
                    {row.menuCourse ? ` · ${row.menuCourse}` : ""}
                  </div>
                  {row.blockedBy.length > 0 ? (
                    <p className="mt-1.5 rounded-lg bg-[#fef2f2] px-2 py-1 text-[11px] font-semibold text-[#b91c1c]">
                      {t("restaurant.kitchenStock.waitingOn", { items: row.blockedBy.slice(0, 3).join(", ") })}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {withoutRecipe.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-[12px] font-black uppercase tracking-wider text-[#64748b]">
            {t("restaurant.kitchenStock.noRecipeYet")}
          </h2>
          <p className="text-[12px] text-[#64748b]">
            {t("restaurant.kitchenStock.noRecipeHelp")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {withoutRecipe.slice(0, 40).map((dish) => (
              <button
                key={dish.id}
                type="button"
                onClick={() => setEditingDish(dish)}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold text-[#52627e]"
              >
                <Plus size={12} /> {dish.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {editingDish ? (
        <RecipeEditor
          dish={editingDish}
          products={products}
          onClose={() => setEditingDish(null)}
          onSaved={async (message) => {
            setEditingDish(null);
            await refresh();
            toast({ title: message });
          }}
        />
      ) : null}
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed p-8 text-center text-[13px] text-[#64748b]">{children}</div>;
}

function Stat({ icon, label, value, alarming }: { icon: React.ReactNode; label: string; value: string; alarming?: boolean }) {
  return (
    <div className={cn("rounded-2xl border bg-white p-3.5", alarming && "border-[#fed7aa] bg-[#fff7ed]")}>
      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-[#64748b]">
        {icon} {label}
      </div>
      <div className={cn("mt-1 font-display text-[20px] font-black", alarming ? "text-[#c2410c]" : "text-[var(--brand-ink)]")}>{value}</div>
    </div>
  );
}

interface DraftComponent extends DishRecipeComponent {
  key: string;
}

/**
 * What goes into one dish.
 *
 * Written per PORTION, in the ingredient's own base unit, which is the same unit
 * stock is kept in — so the number a cook types is the number that comes off the
 * shelf, with no conversion anywhere to get wrong. The unit is shown next to the
 * field rather than chosen, because a recipe in which one line is grams and
 * another is kilos is a recipe that empties a fridge by a factor of a thousand.
 */
function RecipeEditor({
  dish, products, onClose, onSaved,
}: {
  dish: MenuDish;
  products: Product[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const { t } = useAppLanguage();
  const [rows, setRows] = useState<DraftComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [cost, setCost] = useState(0);

  useEffect(() => {
    let active = true;
    getRecipe(dish.id)
      .then((recipe) => {
        if (!active) return;
        setRows(recipe.components.map((component, index) => ({ ...component, key: `${component.ingredientProductId}-${index}` })));
        setCost(recipe.ingredientCost);
      })
      .catch(() => { if (active) setRows([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dish.id]);

  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const chosen = useMemo(() => new Set(rows.map((row) => row.ingredientProductId)), [rows]);
  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return products
      // A dish cannot be an ingredient of itself: it would deplete twice on every
      // sale, once as stock and once as its own ingredient.
      .filter((product) => product.id !== dish.id && !chosen.has(product.id))
      .filter((product) => product.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [products, search, chosen, dish.id]);

  function addIngredient(product: Product) {
    setRows((current) => [...current, {
      key: `${product.id}-${Date.now()}`,
      ingredientProductId: product.id,
      ingredientName: product.name,
      baseUnit: product.baseUnit ?? null,
      qtyBase: 0,
      wastagePct: 0,
      optional: false,
    }]);
    setSearch("");
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{t("restaurant.kitchenStock.whatGoesInto", { dish: dish.name })}</DialogTitle></DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-[#64748b]">
            <Loader2 className="animate-spin" size={16} /> {t("restaurant.kitchenStock.loadingRecipe")}
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <p className="text-[12px] leading-relaxed text-[#64748b]">
              {t("restaurant.kitchenStock.perPortionHelp")}
            </p>

            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed p-5 text-center text-[12px] text-[#64748b]">
                {t("restaurant.kitchenStock.emptyRecipe")}
              </div>
            ) : null}

            {rows.map((row) => {
              const product = byId.get(row.ingredientProductId);
              const unit = row.baseUnit ?? product?.baseUnit ?? "";
              return (
                <div key={row.key} className="rounded-xl border p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--brand-ink)]">
                      {product?.name ?? row.ingredientName}
                      {!product ? <span className="ml-1 text-[11px] font-normal text-[#dc2626]">{t("restaurant.kitchenStock.notInCatalogue")}</span> : null}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${row.ingredientName}`}
                      onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                      className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-lg text-[#94a3b8] hover:bg-[#f1f5fb]"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">{t("restaurant.kitchenStock.perPortion", { unit: unit || "unit" })}</Label>
                      <Input
                        value={String(row.qtyBase ?? 0)}
                        inputMode="decimal"
                        onChange={(event) => setRows((current) => current.map((item) =>
                          item.key === row.key ? { ...item, qtyBase: Math.max(0, Number(event.target.value) || 0) } : item))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">{t("restaurant.kitchenStock.wastage")}</Label>
                      <Input
                        value={String(row.wastagePct ?? 0)}
                        inputMode="decimal"
                        onChange={(event) => setRows((current) => current.map((item) =>
                          item.key === row.key ? { ...item, wastagePct: Math.max(0, Math.min(90, Number(event.target.value) || 0)) } : item))}
                      />
                    </div>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-[12px] text-[#52627e]">
                    <Switch
                      checked={row.optional}
                      onCheckedChange={(next) => setRows((current) => current.map((item) =>
                        item.key === row.key ? { ...item, optional: next } : item))}
                      aria-label={`${row.ingredientName} is optional`}
                    />
                    {t("restaurant.kitchenStock.garnish")}
                  </label>
                </div>
              );
            })}

            <div className="space-y-1.5">
              <Label>{t("restaurant.kitchenStock.addIngredient")}</Label>
              <Input value={search} placeholder={t("restaurant.kitchenStock.ingredientPlaceholder")} onChange={(event) => setSearch(event.target.value)} />
              {candidates.length > 0 ? (
                <div className="overflow-hidden rounded-xl border">
                  {candidates.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addIngredient(product)}
                      className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-[#f8fafc]"
                    >
                      <Package size={14} className="text-[#94a3b8]" />
                      <span className="min-w-0 flex-1 truncate">{product.name}</span>
                      <span className="text-[11px] text-[#94a3b8]">
                        {qtyLabel(Number(product.stockBaseQty ?? 0), product.baseUnit ?? null)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {cost > 0 ? (
              <p className="text-[12px] text-[#64748b]">
                {t("restaurant.kitchenStock.lastCost", { amount: rupees(cost) })}
                {dish.price > 0 ? ` against a ${rupees(dish.price)} price` : ""}.
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2">
          {rows.length > 0 ? (
            <Button
              variant="ghost"
              className="mr-auto text-[#b91c1c]"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                await deleteRecipe(dish.id).catch(() => undefined);
                setSaving(false);
                await onSaved(`Recipe removed from ${dish.name}`);
              }}
            >
              {t("restaurant.kitchenStock.removeRecipe")}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>{t("restaurant.kitchenStock.cancel")}</Button>
          <Button
            disabled={saving || loading}
            onClick={async () => {
              setSaving(true);
              try {
                await saveRecipe(dish.id, rows);
                await onSaved(`Recipe saved for ${dish.name}`);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save recipe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
