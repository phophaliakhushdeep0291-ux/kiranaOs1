import { useEffect, useMemo, useState } from "react";
import { Loader2, Package, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { cn } from "@/lib/utils";
import type { MenuAddonGroup, MenuAddonGroupInput, Product } from "@/types/api";
import { readCatalogueProducts, removeAddonGroup, saveAddonGroup } from "../../service/restaurant-api";

type DraftOption = MenuAddonGroupInput["options"][number];

const blankGroup = (): MenuAddonGroupInput => ({
  name: "",
  minSelect: 0,
  maxSelect: 1,
  isActive: true,
  options: [{ name: "", price: 0, linkedProductId: null, linkedQtyBase: 1 }],
});

function toDraft(group: MenuAddonGroup): MenuAddonGroupInput {
  return {
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    sortOrder: group.sortOrder,
    isActive: group.isActive,
    options: group.options.map((option) => ({
      id: option.id,
      name: option.name,
      price: option.price,
      linkedProductId: option.linkedProductId,
      linkedQtyBase: option.linkedQtyBase,
      sortOrder: option.sortOrder,
    })),
  };
}

export function AddonManagerDialog({
  open, groups, onClose, onChanged,
}: {
  open: boolean;
  groups: MenuAddonGroup[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const { t } = useAppLanguage();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MenuAddonGroupInput>(blankGroup);
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void readCatalogueProducts().then(setProducts);
  }, [open]);

  const sortedProducts = useMemo(
    () => [...products].filter((product) => product.deletedAt == null).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  function edit(group: MenuAddonGroup | null) {
    setEditingId(group?.id ?? null);
    setDraft(group ? toDraft(group) : blankGroup());
    setDeleteId(null);
  }

  function patchOption(index: number, patch: Partial<DraftOption>) {
    setDraft((current) => ({
      ...current,
      options: current.options.map((option, row) => row === index ? { ...option, ...patch } : option),
    }));
  }

  async function save() {
    const cleaned = {
      ...draft,
      name: draft.name.trim(),
      options: draft.options
        .map((option, index) => ({ ...option, name: option.name.trim(), sortOrder: index }))
        .filter((option) => option.name),
    };
    if (!cleaned.name || cleaned.options.length === 0) {
      toast({ title: t("restaurant.addons.validationError"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const saved = await saveAddonGroup(editingId, cleaned);
      await onChanged();
      edit(saved);
      toast({ title: t("restaurant.addons.saved", { name: saved.name }), description: t("restaurant.addons.savedHelp") });
    } catch (error) {
      toast({ title: t("restaurant.addons.saveError"), description: error instanceof Error ? error.message : t("restaurant.addons.tryAgain"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(group: MenuAddonGroup) {
    if (deleteId !== group.id) {
      setDeleteId(group.id);
      return;
    }
    setSaving(true);
    try {
      await removeAddonGroup(group.id);
      await onChanged();
      if (editingId === group.id) edit(null);
      setDeleteId(null);
      toast({ title: t("restaurant.addons.removed", { name: group.name }), description: t("restaurant.addons.removedHelp") });
    } catch (error) {
      toast({ title: t("restaurant.addons.removeError"), description: error instanceof Error ? error.message : t("restaurant.addons.tryAgain"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings2 size={18} /> {t("restaurant.addons.library")}</DialogTitle>
        </DialogHeader>
        <p className="text-[12px] leading-relaxed text-[#64748b]">
          {t("restaurant.addons.libraryHelp")}
        </p>

        <div className="grid gap-4 md:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="space-y-2 rounded-2xl border bg-[#f8fafc] p-3">
            <Button className="w-full gap-2" variant="outline" onClick={() => edit(null)}><Plus size={14} /> {t("restaurant.addons.newGroup")}</Button>
            {groups.length === 0 ? <p className="px-1 py-5 text-center text-[12px] text-[#64748b]">{t("restaurant.addons.noGroups")}</p> : null}
            {groups.map((group) => (
              <div key={group.id} className={cn("rounded-xl border bg-white p-2.5", editingId === group.id && "border-[var(--brand)] ring-2 ring-[var(--brand-soft)]")}>
                <button type="button" className="w-full text-left" onClick={() => edit(group)}>
                  <span className="block truncate text-[13px] font-black text-[var(--brand-ink)]">{group.name}</span>
                  <span className="mt-0.5 block text-[10.5px] text-[#64748b]">{t("restaurant.addons.choiceCount", { count: group.options.length, requirement: group.minSelect > 0 ? t("restaurant.addons.chooseCount", { count: group.minSelect }) : t("restaurant.addons.optional") })}</span>
                </button>
                <button type="button" disabled={saving} onClick={() => void remove(group)} className={cn("mt-2 inline-flex items-center gap-1 text-[10.5px] font-bold", deleteId === group.id ? "text-rose-700" : "text-[#94a3b8] hover:text-rose-600")}>
                  <Trash2 size={11} /> {deleteId === group.id ? t("restaurant.addons.removeConfirm") : t("restaurant.addons.remove")}
                </button>
              </div>
            ))}
          </aside>

          <section className="space-y-4 rounded-2xl border p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_90px_90px]">
              <div><Label>{t("restaurant.addons.groupName")}</Label><Input className="mt-1" value={draft.name} placeholder={t("restaurant.addons.extrasPlaceholder")} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></div>
              <div><Label>{t("restaurant.addons.minimum")}</Label><Input className="mt-1" type="number" min="0" max="40" value={draft.minSelect ?? 0} onChange={(event) => setDraft((current) => ({ ...current, minSelect: Number(event.target.value) }))} /></div>
              <div><Label>{t("restaurant.addons.maximum")}</Label><Input className="mt-1" type="number" min="0" max="40" value={draft.maxSelect ?? 0} onChange={(event) => setDraft((current) => ({ ...current, maxSelect: Number(event.target.value) }))} /></div>
            </div>
            <div className="flex items-center justify-between rounded-xl border bg-[#f8fafc] px-3 py-2">
              <div><p className="text-[12px] font-bold">{t("restaurant.addons.available")}</p><p className="text-[10.5px] text-[#64748b]">{t("restaurant.addons.availableHelp")}</p></div>
              <Switch checked={draft.isActive !== false} onCheckedChange={(isActive) => setDraft((current) => ({ ...current, isActive }))} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>{t("restaurant.addons.choices")}</Label><span className="text-[10.5px] text-[#64748b]">{t("restaurant.addons.zeroPriceHelp")}</span></div>
              {draft.options.map((option, index) => (
                <div key={option.id ?? `new-${index}`} className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-[minmax(120px,1fr)_100px_minmax(140px,1fr)_90px_auto] sm:items-end">
                  <div><Label className="text-[10px]">{t("restaurant.addons.choice")}</Label><Input className="mt-1" value={option.name} placeholder={t("restaurant.addons.choicePlaceholder")} onChange={(event) => patchOption(index, { name: event.target.value })} /></div>
                  <div><Label className="text-[10px]">{t("restaurant.addons.addPrice")}</Label><Input className="mt-1" type="number" min="0" step="0.01" value={option.price} onChange={(event) => patchOption(index, { price: Number(event.target.value) })} /></div>
                  <div>
                    <Label className="text-[10px]">{t("restaurant.addons.usesStock")}</Label>
                    <select className="mt-1 h-11 w-full rounded-md border bg-white px-2 text-[12px]" value={option.linkedProductId ?? ""} onChange={(event) => patchOption(index, { linkedProductId: event.target.value || null })}>
                      <option value="">{t("restaurant.addons.noStockMovement")}</option>
                      {sortedProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                  </div>
                  <div><Label className="text-[10px]">{t("restaurant.addons.quantityUsed")}</Label><Input className="mt-1" type="number" min="0.001" step="0.001" disabled={!option.linkedProductId} value={option.linkedQtyBase ?? 1} onChange={(event) => patchOption(index, { linkedQtyBase: Number(event.target.value) })} /></div>
                  <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("restaurant.addons.removeChoice", { choice: option.name || t("restaurant.addons.choice") })} disabled={draft.options.length === 1} onClick={() => setDraft((current) => ({ ...current, options: current.options.filter((_, row) => row !== index) }))}><Trash2 size={15} /></Button>
                </div>
              ))}
              <Button variant="outline" className="gap-2" onClick={() => setDraft((current) => ({ ...current, options: [...current.options, { name: "", price: 0, linkedProductId: null, linkedQtyBase: 1 }] }))}><Plus size={14} /> {t("restaurant.addons.addChoice")}</Button>
            </div>
            <div className="rounded-xl bg-[#eff6ff] p-3 text-[11px] leading-relaxed text-[#1d4ed8]"><Package className="mr-1 inline" size={13} /> {t("restaurant.addons.stockHelp")}</div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("restaurant.addons.done")}</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? <><Loader2 className="animate-spin" size={14} /> {t("restaurant.addons.saving")}</> : t("restaurant.addons.saveGroup")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
