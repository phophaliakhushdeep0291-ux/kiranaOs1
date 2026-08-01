import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFeature } from "@/features/subscription";
import type { ProductFormData } from "../product-form-state";
import { useAppLanguage } from "@/features/settings/i18n";

interface ProductStockFormProps {
  form: UseFormReturn<ProductFormData>;
}

export function ProductStockForm({ form }: ProductStockFormProps) {
  const { t } = useAppLanguage();
  const batchFeature = useFeature("batch_expiry");
  const batchTracking = form.watch("batchTrackingEnabled");
  return (
    <>
      <div className="rounded-lg border bg-emerald-50 p-3 text-sm text-emerald-900">
        Stock tracking is always on, including loose items like kg, gram, litre and ml. This keeps billing, reports and low-stock alerts reliable.
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div><Label>Opening/current stock</Label><Input type="number" step="0.01" className="mt-1" {...form.register("stockQuantity")} /></div>
        <div><Label>Low-stock alert</Label><Input type="number" step="0.01" className="mt-1" {...form.register("lowStockAlert")} /></div>
      </div>
      <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/40 p-3">
        <div><p className="font-medium text-sm">{t("products.form.batchExpiryTitle")}</p><p className="text-xs text-muted-foreground">Require a batch number and expiry when this product is received. Checkout automatically uses the earliest-expiring saleable stock.</p>{!batchFeature.loading && !batchFeature.allowed && <p className="mt-1 text-xs font-semibold text-amber-700">Available on {batchFeature.requiredPlan.name}.</p>}</div>
        <Switch checked={batchTracking} disabled={batchFeature.loading || !batchFeature.allowed} onCheckedChange={(checked) => form.setValue("batchTrackingEnabled", checked, { shouldDirty: true })} aria-label={t("products.form.batchExpiry")} />
      </div>
    </>
  );
}
