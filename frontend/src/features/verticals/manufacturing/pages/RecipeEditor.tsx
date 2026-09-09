import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useAuth } from "@/features/core/auth/useAuth";
import { useOfflineStatus } from "@/features/core/sync";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api/http";
import type { Product } from "@/types/api";
import { recipePayload, type RecipeDraft } from "../recipe-draft";

const selectClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm font-normal";
const emptyMaterial = () => ({ key: crypto.randomUUID(), productId: "", quantity: "1", wastage: "0" });
const errors = { finished: "manufacturing.recipe.errorFinished", name: "manufacturing.recipe.errorName", quantity: "manufacturing.recipe.errorQuantity", materials: "manufacturing.recipe.errorMaterials", wastage: "manufacturing.recipe.errorWastage" } as const;

export default function RecipeEditor({ products }: { products: Product[] }) {
  const { t } = useAppLanguage(); const { user } = useAuth(); const { isOnline } = useOfflineStatus();
  const { toast } = useToast(); const client = useQueryClient();
  const [draft, setDraft] = useState<RecipeDraft>(() => ({ name: "", finishedProductId: "", output: "1", materials: [emptyMaterial()] }));
  const [validation, setValidation] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof recipePayload>) => apiRequest("/manufacturing/boms", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async () => {
      setDraft({ name: "", finishedProductId: "", output: "1", materials: [emptyMaterial()] });
      toast({ title: t("manufacturing.bom.createdTitle"), description: t("manufacturing.bom.createdDetail") });
      await client.invalidateQueries({ queryKey: ["manufacturing"] });
    },
  });
  const canManage = user?.role === "owner" || user?.role === "admin";
  const finishedProducts = products.filter((product) => product.batchTrackingEnabled);
  const changeMaterial = (key: string, field: "productId" | "quantity" | "wastage", value: string) => setDraft((current) => ({ ...current, materials: current.materials.map((row) => row.key === key ? { ...row, [field]: value } : row) }));
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white" id="new-bom">
    <div className="border-b border-slate-100 p-4 sm:p-5"><h2 className="font-display font-black text-slate-900">{t("manufacturing.bom.createTitle")}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{t("manufacturing.recipe.help")}</p></div>
    <form className="space-y-4 p-4 sm:p-5" onSubmit={(event) => {
      event.preventDefault(); setValidation(null);
      try { mutation.mutate(recipePayload(draft, products)); }
      catch (error) { setValidation(t(errors[(error as Error).message as keyof typeof errors] ?? "manufacturing.recipe.errorMaterials")); }
    }}>
      {!canManage && <p className="text-sm text-slate-600">{t("manufacturing.recipe.ownerOnly")}</p>}
      {!isOnline && <p role="status" className="text-sm text-amber-800">{t("manufacturing.production.offline")}</p>}
      {!finishedProducts.length && <p className="text-sm text-slate-600">{t("manufacturing.recipe.setup")} <Link href="/products" className="font-semibold text-teal-700 underline">{t("manufacturing.recipe.openProducts")}</Link></p>}
      <fieldset disabled={!canManage || mutation.isPending} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block min-w-0 space-y-1.5 text-xs font-bold text-slate-600"><span>{t("manufacturing.bom.name")}</span><Input className="h-11" required minLength={2} maxLength={160} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="block min-w-0 space-y-1.5 text-xs font-bold text-slate-600"><span>{t("manufacturing.bom.finishedGood")}</span><select className={selectClass} required value={draft.finishedProductId} onChange={(e) => setDraft({ ...draft, finishedProductId: e.target.value })}><option value="">{t("manufacturing.product.select")}</option>{finishedProducts.filter((product) => !draft.materials.some((row) => row.productId === product.id)).map((product) => <option key={product.id} value={product.id}>{product.name} ({product.baseUnit})</option>)}</select></label>
          <label className="block min-w-0 space-y-1.5 text-xs font-bold text-slate-600"><span>{t("manufacturing.bom.standardOutput")}</span><Input className="h-11" type="number" required min="0.01" max="1000000000" step="0.01" value={draft.output} onChange={(e) => setDraft({ ...draft, output: e.target.value })} /></label>
        </div>
        <div className="space-y-3">
          {draft.materials.map((row, index) => <fieldset key={row.key} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3"><legend className="px-1 text-sm font-bold">{t("manufacturing.recipe.materialNumber", { number: index + 1 })}</legend>
            <label className="block min-w-0 space-y-1.5 text-xs font-bold text-slate-600"><span>{t("manufacturing.bom.material")}</span><select className={selectClass} required value={row.productId} onChange={(e) => changeMaterial(row.key, "productId", e.target.value)}><option value="">{t("manufacturing.product.select")}</option>{products.filter((product) => product.id !== draft.finishedProductId && !draft.materials.some((other) => other.key !== row.key && other.productId === product.id)).map((product) => <option key={product.id} value={product.id}>{product.name} ({product.baseUnit})</option>)}</select></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="block min-w-0 space-y-1.5 text-xs font-bold text-slate-600"><span>{t("manufacturing.bom.materialQty")}</span><Input className="h-11" type="number" required min="0.01" max="1000000000" step="0.01" value={row.quantity} onChange={(e) => changeMaterial(row.key, "quantity", e.target.value)} /></label><label className="block min-w-0 space-y-1.5 text-xs font-bold text-slate-600"><span>{t("manufacturing.bom.wastage")}</span><Input className="h-11" type="number" required min="0" max="100" step="0.01" value={row.wastage} onChange={(e) => changeMaterial(row.key, "wastage", e.target.value)} /></label></div>
            {draft.materials.length > 1 && <Button type="button" variant="ghost" className="min-h-11 gap-2 text-rose-700" aria-label={t("manufacturing.recipe.removeNumber", { number: index + 1 })} onClick={() => setDraft((current) => ({ ...current, materials: current.materials.filter((item) => item.key !== row.key) }))}><Trash2 size={15} />{t("manufacturing.recipe.remove")}</Button>}
          </fieldset>)}
          <Button type="button" variant="outline" className="min-h-11 w-full gap-2" disabled={draft.materials.length >= 100 || !draft.materials.every((row) => row.productId) || products.filter((product) => product.id !== draft.finishedProductId).length <= draft.materials.length} onClick={() => setDraft((current) => ({ ...current, materials: [...current.materials, emptyMaterial()] }))}><Plus size={16} />{t("manufacturing.recipe.add")}</Button>
        </div>
      </fieldset>
      {validation && <p role="alert" className="text-sm text-rose-700">{validation}</p>}
      {mutation.error && <p role="alert" className="text-sm text-rose-700">{mutation.error instanceof Error ? mutation.error.message : t("manufacturing.bom.failedDetail")}</p>}
      <Button type="submit" className="min-h-12 w-full gap-2" disabled={!canManage || !isOnline || mutation.isPending || !finishedProducts.length}>{mutation.isPending && <Loader2 className="animate-spin" size={16} />}{t(mutation.isPending ? "manufacturing.bom.saving" : "manufacturing.bom.createAction")}</Button>
    </form>
  </section>;
}
