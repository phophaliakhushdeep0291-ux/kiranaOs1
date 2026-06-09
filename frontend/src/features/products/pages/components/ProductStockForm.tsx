import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductFormData } from "../product-form-state";

interface ProductStockFormProps {
  form: UseFormReturn<ProductFormData>;
}

export function ProductStockForm({ form }: ProductStockFormProps) {
  return (
    <>
      <div className="rounded-lg border bg-emerald-50 p-3 text-sm text-emerald-900">
        Stock tracking is always on, including loose items like kg, gram, litre and ml. This keeps billing, reports and low-stock alerts reliable.
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div><Label>Opening/current stock</Label><Input type="number" step="0.01" className="mt-1" {...form.register("stockQuantity")} /></div>
        <div><Label>Low-stock alert</Label><Input type="number" step="0.01" className="mt-1" {...form.register("lowStockAlert")} /></div>
      </div>
      <div className="rounded-xl border bg-muted/40 p-3">
        <p className="font-medium text-sm">Batch/expiry support</p>
        <p className="text-xs text-muted-foreground">Locked for higher plan. Architecture is ready to attach batch number, expiry date and purchase lot to movements.</p>
      </div>
    </>
  );
}
