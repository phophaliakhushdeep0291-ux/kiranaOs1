import type { UseFormReturn } from "react-hook-form";
import type { Product } from "@/lib/api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DuplicateProductWarning } from "@/features/products/product-reliability";
import { UNITS } from "../product-pricing";
import type { ProductFormData } from "../product-form-state";
import { ProductAliasSuggestions } from "./ProductAliasSuggestions";
import { ProductPricingForm } from "./ProductPricingForm";
import { ProductStockForm } from "./ProductStockForm";
import { useBusinessType } from "@/features/settings/business-types";
import { cn } from "@/lib/utils";

interface ProductFormModalProps {
  open: boolean;
  editing: Product | null;
  form: UseFormReturn<ProductFormData>;
  duplicateWarnings: DuplicateProductWarning[];
  aliasSuggestions: string[];
  aiAliasLoading: boolean;
  aiAliasError: string | null;
  needsOwnerPinForPrice: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ProductFormData) => void;
  onAppendAlias: (alias: string) => void;
  onAppendAllLocalAliases: () => void;
  onAskGroqForAliases: () => void;
}

export function ProductFormModal({
  open,
  editing,
  form,
  duplicateWarnings,
  aliasSuggestions,
  aiAliasLoading,
  aiAliasError,
  needsOwnerPinForPrice,
  isPending,
  onOpenChange,
  onSubmit,
  onAppendAlias,
  onAppendAllLocalAliases,
  onAskGroqForAliases,
}: ProductFormModalProps) {
  const { def } = useBusinessType();
  const otherUnits = UNITS.filter((u) => !def.primaryUnits.includes(u));
  const suggestedCategories = def.categories.filter((c) => c !== "all" && c !== "other");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] max-w-4xl flex-col overflow-hidden p-0 sm:p-6">
        <DialogHeader className="shrink-0 border-b border-[#e6ecf4] px-4 py-4 sm:border-0 sm:p-0"><DialogTitle>{editing ? "Edit product" : "Add product"}</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-0 sm:py-0">
          <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-foreground/80">
            Voice fill is active while this form is open. Say: <span className="font-semibold">{def.voiceExample}</span>.
          </div>
          <Tabs defaultValue="basic">
            <TabsList className="grid grid-cols-3 w-full"><TabsTrigger value="basic">Basic</TabsTrigger><TabsTrigger value="pricing">Pricing</TabsTrigger><TabsTrigger value="stock">Stock</TabsTrigger></TabsList>
            <TabsContent value="basic" className="space-y-4 pt-4">
              <div className="grid md:grid-cols-2 gap-3">
                <div><Label>Name *</Label><Input className="mt-1" {...form.register("name")} placeholder="Product name" />{form.formState.errors.name && <p className="text-xs text-destructive mt-1">{form.formState.errors.name.message}</p>}</div>
                <div>
                  <Label>Category</Label>
                  <Input className="mt-1" {...form.register("category")} placeholder={suggestedCategories[0] ?? "general"} />
                  {suggestedCategories.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {suggestedCategories.slice(0, 7).map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => form.setValue("category", cat)}
                          className={cn(
                            "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                            form.watch("category") === cat
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          )}
                        >
                          {cat.replace(/_/g, " ")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <Label>Unit</Label>
                  <Select value={form.watch("unit")} onValueChange={(value) => form.setValue("unit", value)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {def.primaryUnits.map((unit) => (
                        <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                      ))}
                      {otherUnits.length > 0 && (
                        <>
                          <div className="my-1 h-px bg-border" />
                          {otherUnits.map((unit) => (
                            <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Barcode / SKU optional</Label><Input className="mt-1" {...form.register("barcode")} placeholder="Scan or type barcode" /></div>
              </div>
              <ProductAliasSuggestions
                form={form}
                aliasSuggestions={aliasSuggestions}
                duplicateWarnings={duplicateWarnings}
                aiAliasLoading={aiAliasLoading}
                aiAliasError={aiAliasError}
                onAppendAlias={onAppendAlias}
                onAppendAllLocalAliases={onAppendAllLocalAliases}
                onAskGroqForAliases={onAskGroqForAliases}
              />
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div><p className="font-medium text-sm">Active product</p><p className="text-xs text-muted-foreground">Inactive products stay saved but are hidden from billing.</p></div>
                <Switch checked={form.watch("isActive")} onCheckedChange={(value) => form.setValue("isActive", value)} />
              </div>
            </TabsContent>
            <TabsContent value="pricing" className="space-y-4 pt-4">
              <ProductPricingForm form={form} needsOwnerPinForPrice={needsOwnerPinForPrice} />
            </TabsContent>
            <TabsContent value="stock" className="space-y-4 pt-4">
              <ProductStockForm form={form} />
            </TabsContent>
          </Tabs>
          </div>
          <div className="sticky bottom-0 z-10 grid shrink-0 grid-cols-2 gap-3 border-t border-[#e6ecf4] bg-white/98 px-4 py-3 shadow-[0_-10px_24px_rgba(15,35,80,0.08)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-4 sm:shadow-none">
            <Button type="button" variant="outline" className="h-12 sm:h-10" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="h-12 sm:h-10" disabled={isPending}>{isPending ? "Saving..." : editing ? "Update product" : "Create product"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
