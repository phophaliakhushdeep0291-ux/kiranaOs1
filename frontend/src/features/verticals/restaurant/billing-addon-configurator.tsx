import { useMemo, useState } from "react";
import { Check, Minus, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { registerProductConfigurator, type ProductConfiguratorProps } from "@/features/core/billing/product-configurators";
import { getStoredBusinessType } from "@/features/core/settings/business-type-store";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { cn } from "@/lib/utils";
import type { MenuAddonGroup, MenuDish } from "@/types/api";
import { getMenuBoard } from "./service/restaurant-api";

let menuPromise: Promise<MenuDish[]> | null = null;

async function loadGroups(productId: string): Promise<MenuAddonGroup[] | null> {
  menuPromise ??= getMenuBoard().then((board) => board.courses.flatMap((section) => section.dishes));
  const dish = (await menuPromise).find((row) => row.id === productId);
  return dish?.addonGroups?.length ? dish.addonGroups : null;
}

function AddonConfigurator({ product, data, onConfirm, onCancel }: ProductConfiguratorProps) {
  const { t } = useAppLanguage();
  const groups = data as MenuAddonGroup[];
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [attempted, setAttempted] = useState(false);

  const validation = useMemo(() => groups.map((group) => {
    const count = group.options.reduce((sum, option) => sum + (selected[option.id] ?? 0), 0);
    const valid = count >= group.minSelect && (group.maxSelect <= 0 || count <= group.maxSelect);
    return { group, count, valid };
  }), [groups, selected]);
  const valid = validation.every((row) => row.valid);
  const extra = groups.flatMap((group) => group.options).reduce((sum, option) => sum + option.price * (selected[option.id] ?? 0), 0);

  function setQuantity(group: MenuAddonGroup, optionId: string, next: number) {
    const currentGroupCount = group.options.reduce((sum, option) => sum + (selected[option.id] ?? 0), 0);
    const previous = selected[optionId] ?? 0;
    const ceiling = group.maxSelect > 0 ? group.maxSelect : 20;
    const clamped = Math.max(0, Math.min(20, next));
    if (currentGroupCount - previous + clamped > ceiling) return;
    setSelected((current) => {
      if (clamped === 0) {
        const { [optionId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [optionId]: clamped };
    });
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 size={18} /> {t("restaurant.addons.configure", { product: product.name })}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {validation.map(({ group, count, valid: groupValid }) => (
            <section key={group.id} className={cn("rounded-2xl border p-3.5", attempted && !groupValid && "border-rose-300 bg-rose-50/50")}>
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="text-[13px] font-black text-[var(--brand-ink)]">{group.name}</h3><p className="mt-0.5 text-[10.5px] text-[#64748b]">{group.minSelect > 0 ? t("restaurant.addons.chooseAtLeast", { count: group.minSelect }) : t("restaurant.addons.optional")}{group.maxSelect > 0 ? t("restaurant.addons.upTo", { count: group.maxSelect }) : ""}</p></div>
                <span className={cn("rounded-full px-2 py-1 text-[10px] font-black", groupValid ? "bg-emerald-50 text-emerald-700" : "bg-[#f1f5f9] text-[#64748b]")}>{t("restaurant.addons.chosen", { count })}</span>
              </div>
              <div className="mt-3 space-y-2">
                {group.options.map((option) => {
                  const quantity = selected[option.id] ?? 0;
                  return (
                    <div key={option.id} className={cn("flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2", quantity > 0 ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "bg-white")}>
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setQuantity(group, option.id, quantity > 0 ? 0 : 1)}>
                        <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border", quantity > 0 && "border-[var(--brand)] bg-[var(--brand)] text-white")}>{quantity > 0 ? <Check size={12} /> : null}</span>
                        <span className="min-w-0"><span className="block truncate text-[12px] font-bold">{option.name}</span><span className="text-[10.5px] text-[#64748b]">{option.price > 0 ? `+₹${option.price.toLocaleString("en-IN")}` : t("restaurant.addons.noExtraCharge")}</span></span>
                      </button>
                      {quantity > 0 ? (
                        <div className="flex items-center gap-1"><Button size="icon" variant="outline" className="h-11 w-11" aria-label={`Decrease ${option.name}`} onClick={() => setQuantity(group, option.id, quantity - 1)}><Minus size={14} /></Button><span className="w-5 text-center text-[12px] font-black">{quantity}</span><Button size="icon" variant="outline" className="h-11 w-11" aria-label={`Increase ${option.name}`} onClick={() => setQuantity(group, option.id, quantity + 1)}><Plus size={14} /></Button></div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {attempted && !groupValid ? <p className="mt-2 text-[11px] font-bold text-rose-700">{t("restaurant.addons.chooseError", { requirement: group.minSelect > count ? t("restaurant.addons.atLeast", { count: group.minSelect }) : t("restaurant.addons.noMoreThan", { count: group.maxSelect }) })}</p> : null}
            </section>
          ))}
        </div>
        <DialogFooter className="gap-2 max-sm:!flex-col sm:justify-between">
          <div className="mr-auto text-left"><p className="text-[10px] uppercase tracking-wide text-[#64748b]">{t("restaurant.addons.optionsAdd")}</p><p className="text-[15px] font-black">₹{extra.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p></div>
          <Button variant="outline" onClick={onCancel}>{t("restaurant.addons.cancel")}</Button>
          <Button onClick={() => {
            setAttempted(true);
            if (!valid) return;
            onConfirm({
              addons: groups.flatMap((group) => group.options
                .filter((option) => (selected[option.id] ?? 0) > 0)
                .map((option) => ({ optionId: option.id, groupName: group.name, name: option.name, price: option.price, quantity: selected[option.id] }))),
            });
          }}>{t("restaurant.addons.addToBill")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function registerRestaurantAddonConfigurator() {
  registerProductConfigurator({
    id: "restaurant-addons",
    appliesTo: () => getStoredBusinessType() === "restaurant",
    load: (product) => loadGroups(product.id),
    Component: AddonConfigurator,
  });
}

registerRestaurantAddonConfigurator();
