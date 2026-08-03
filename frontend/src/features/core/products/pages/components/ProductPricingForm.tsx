import type { UseFormReturn } from "react-hook-form";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductFormData } from "../product-form-state";

interface ProductPricingFormProps {
  form: UseFormReturn<ProductFormData>;
  needsOwnerPinForPrice: boolean;
}

export function ProductPricingForm({ form, needsOwnerPinForPrice }: ProductPricingFormProps) {
  return (
    <>
      <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        Keep pricing simple. Customer-specific price is handled directly while billing; no separate confusing table is needed here.
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <div><Label>Average cost price</Label><Input type="number" step="0.01" className="mt-1" {...form.register("costPrice")} /><p className="text-xs text-muted-foreground mt-1">Auto-updates from purchase entries using weighted average.</p></div>
        <div><Label>Selling price *</Label><Input type="number" step="0.01" className="mt-1" {...form.register("sellingPrice")} /></div>
        <div><Label>Minimum selling price</Label><Input type="number" step="0.01" className="mt-1" {...form.register("minimumSellingPrice")} /></div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border p-3 space-y-3">
          <div className="flex items-center justify-between"><Label>Retail selling price</Label><Badge variant="outline">normal buyer</Badge></div>
          <Input type="number" step="0.01" {...form.register("retailPrice")} />
          <div><Label className="text-xs text-muted-foreground">Use retail price from quantity</Label><Input type="number" step="0.01" className="mt-1" {...form.register("retailFromQuantity")} /></div>
        </div>
        <div className="rounded-xl border p-3 space-y-3">
          <div className="flex items-center justify-between"><Label>Wholesale price</Label><Badge variant="outline">bulk buyer</Badge></div>
          <Input type="number" step="0.01" {...form.register("wholesalePrice")} />
          <div><Label className="text-xs text-muted-foreground">Use wholesale price from quantity</Label><Input type="number" step="0.01" className="mt-1" {...form.register("wholesaleFromQuantity")} /></div>
        </div>
      </div>
      {needsOwnerPinForPrice ? <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 flex gap-2"><ShieldAlert size={16} /> Selling below minimum price needs owner approval before saving.</div> : null}
    </>
  );
}
