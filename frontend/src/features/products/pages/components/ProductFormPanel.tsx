import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { UseFormReturn } from "react-hook-form";
import { PanelResizeHandle } from "@/hooks/use-panel-resize";
import type { Product } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Package, Plus, Scale, ScanLine, Sparkles, Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBusinessType } from "@/features/settings/business-types";
import { getLocalProductAliasSuggestions, splitProductAliases, uniqueProductAliases } from "@/features/products/product-reliability";
import { fetchGroqAliasSuggestions } from "../product-aliases";
import { UNITS } from "../product-pricing";
import type { ProductFormData } from "../product-form-state";

const GST_RATES = [0, 5, 12, 18, 28];

interface ProductFormPanelProps {
  open: boolean;
  editing: Product | null;
  form: UseFormReturn<ProductFormData>;
  isPending: boolean;
  stayOpen: boolean;
  width: number;
  onResizeStart: (e: ReactMouseEvent) => void;
  onStayOpenChange: (value: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ProductFormData) => void;
}

async function fileToResizedDataUrl(file: File, max = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unsupported"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = () => reject(new Error("Invalid image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

export function ProductFormPanel({
  open,
  editing,
  form,
  isPending,
  stayOpen,
  width,
  onResizeStart,
  onStayOpenChange,
  onOpenChange,
  onSubmit,
}: ProductFormPanelProps) {
  const { toast } = useToast();
  const { def } = useBusinessType();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const categories = def.categories.filter((c) => c !== "all");
  const imageUrl = form.watch("imageUrl");
  const description = form.watch("description") ?? "";
  const isLoose = !!form.watch("isLooseItem");
  const err = form.formState.errors;

  /* aliases */
  const aliasesText = form.watch("aliasesText") ?? "";
  const currentAliases = splitProductAliases(aliasesText);
  const suggestions = uniqueProductAliases([...aiSuggestions, ...getLocalProductAliasSuggestions(form.watch("name"), form.watch("category"))])
    .filter((a) => !currentAliases.map((x) => x.toLowerCase()).includes(a.toLowerCase()))
    .slice(0, 12);
  function appendAlias(alias: string) {
    form.setValue("aliasesText", uniqueProductAliases([...currentAliases, alias]).join(", "), { shouldDirty: true });
  }
  function removeAlias(alias: string) {
    form.setValue("aliasesText", currentAliases.filter((a) => a !== alias).join(", "), { shouldDirty: true });
  }
  async function askAi() {
    const name = form.getValues("name").trim();
    if (!name) {
      toast({ title: "Product name required", description: "Type the product name first, then ask AI.", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    try {
      const s = await fetchGroqAliasSuggestions(name, form.getValues("category"), form.getValues("unit"));
      if (s.length === 0) {
        setAiSuggestions(getLocalProductAliasSuggestions(name, form.getValues("category")));
        toast({ title: "No AI names returned", description: "Showing local suggestions instead." });
      } else {
        setAiSuggestions(s);
        toast({ title: "AI names ready", description: `${s.slice(0, 6).join(", ")}${s.length > 6 ? "…" : ""}` });
      }
    } catch {
      setAiSuggestions(getLocalProductAliasSuggestions(name, form.getValues("category")));
      toast({ title: "AI unavailable", description: "Showing local suggestions instead.", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  }

  /* avg cost + margin */
  const cost = Number(form.watch("costPrice") || 0);
  const selling = Number(form.watch("sellingPrice") || 0);
  const margin = selling > 0 ? Math.round(((selling - cost) / selling) * 1000) / 10 : 0;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setImgError("Image must be under 2MB.");
      return;
    }
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      form.setValue("imageUrl", dataUrl, { shouldDirty: true });
      setImgError(null);
    } catch {
      setImgError("Could not read image. Try another file.");
    }
  }

  const CategoryField = (
    <Field label="Category" required>
      <Select value={form.watch("category")} onValueChange={(v) => form.setValue("category", v, { shouldDirty: true })}>
        <SelectTrigger className="h-10"><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent>
          {categories.map((c) => <SelectItem key={c} value={c} className="capitalize">{c.replace(/_/g, " ")}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
  const UnitField = (
    <Field label="Unit Type" required>
      <Select value={form.watch("unit")} onValueChange={(v) => form.setValue("unit", v, { shouldDirty: true })}>
        <SelectTrigger className="h-10"><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent>
          {def.primaryUnits.map((u) => <SelectItem key={u} value={u} className="capitalize">{u}</SelectItem>)}
          <div className="my-1 h-px bg-border" />
          {UNITS.filter((u) => !def.primaryUnits.includes(u)).map((u) => <SelectItem key={u} value={u} className="capitalize">{u}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <aside
      style={{ width }}
      className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[76px] lg:h-[calc(100vh-76px)] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog"
      aria-label={editing ? "Edit product" : "Add new product"}
      aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">
            {editing ? "Edit Product" : "Add New Product"}
          </h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">
            {editing ? "Update the details of this product" : "Fill in the details to add a new product"}
          </p>
        </div>
        <button onClick={() => onOpenChange(false)} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-[#f1f4f8]" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Product type: Packed / Loose */}
          <div className="mb-5 grid grid-cols-2 gap-2 rounded-[12px] border border-[#e6ecf4] bg-[#f7f9fc] p-1">
            <TypeButton active={!isLoose} icon={<Package size={16} />} label="Packed Item" onClick={() => form.setValue("isLooseItem", false, { shouldDirty: true })} />
            <TypeButton active={isLoose} icon={<Scale size={16} />} label="Loose Item" onClick={() => form.setValue("isLooseItem", true, { shouldDirty: true })} />
          </div>

          {/* Basic Information */}
          <Section title="Basic Information">
            <Field label="Product Name" required error={err.name?.message}>
              <Input className="h-10" placeholder={isLoose ? "e.g. Sugar (loose)" : "e.g. Tata Salt 1kg"} {...form.register("name")} />
            </Field>

            {/* Category + Brand (brand hidden for loose) */}
            {isLoose ? (
              CategoryField
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {CategoryField}
                <Field label="Brand">
                  <Input className="h-10" placeholder="e.g. Tata" {...form.register("brand")} />
                </Field>
              </div>
            )}

            {/* SKU/Barcode + Unit (SKU hidden for loose) */}
            {isLoose ? (
              UnitField
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="SKU / Barcode" required>
                  <div className="relative">
                    <Input className="h-10 pr-9" placeholder="Scan or type" {...form.register("barcode")} />
                    <ScanLine size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7a9a]" />
                  </div>
                </Field>
                {UnitField}
              </div>
            )}

            <Field label="HSN (Optional)">
              <Input className="h-10" placeholder="e.g. 25010010" {...form.register("hsn")} />
            </Field>
          </Section>

          {/* Aliases */}
          <Section title="Aliases & Local Names">
            <Field label="Alternate names (comma separated)">
              <Input className="h-10" placeholder="namak, salt, साल्ट" {...form.register("aliasesText")} />
            </Field>
            {currentAliases.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {currentAliases.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-full bg-[#eef4ff] px-2.5 py-1 text-[11px] font-bold text-[#0057ff]">
                    {a}
                    <button type="button" onClick={() => removeAlias(a)} aria-label={`Remove ${a}`} className="text-[#0057ff]/60 hover:text-[#0057ff]"><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#6d7c98]">{suggestions.length > 0 ? "Suggestions — tap to add" : "Generate name variations"}</p>
              <button
                type="button"
                onClick={() => void askAi()}
                disabled={aiLoading}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#d8c9ff] bg-[#f3ecff] px-2.5 py-1 text-[11px] font-extrabold text-[#7c3aed] transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                AI Suggest
              </button>
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((a) => (
                  <button key={a} type="button" onClick={() => appendAlias(a)} className="inline-flex items-center gap-1 rounded-full border border-[#e3eaf3] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#45577a] transition-colors hover:border-[#0057ff]/40 hover:text-[#0057ff]">
                    <Plus size={11} /> {a}
                  </button>
                ))}
              </div>
            )}
          </Section>

          {/* Pricing */}
          <Section title="Pricing">
            <div className="grid grid-cols-2 gap-3">
              <Field label="MRP (₹)" required>
                <Input className="h-10" type="number" inputMode="decimal" step="0.01" placeholder="0.00" {...form.register("mrp")} />
              </Field>
              <Field label="Cost Price (₹)" required>
                <Input className="h-10" type="number" inputMode="decimal" step="0.01" placeholder="0.00" {...form.register("costPrice")} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Selling Price (₹)" required error={err.sellingPrice?.message}>
                <Input className="h-10" type="number" inputMode="decimal" step="0.01" placeholder="0.00" {...form.register("sellingPrice")} />
              </Field>
              <Field label="GST Rate">
                <Select value={String(form.watch("gstRate") ?? 0)} onValueChange={(v) => form.setValue("gstRate", Number(v), { shouldDirty: true })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-[10px] border border-[#e6ecf4] bg-[#f8fafd] px-3 py-2 text-[12px]">
              <span className="font-semibold text-[#6d7c98]">Avg. cost</span>
              <span className="font-black text-[#13274d]">₹{cost.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="font-semibold text-[#6d7c98]">Margin</span>
              <span className={`font-black ${margin < 0 ? "text-rose-600" : "text-emerald-600"}`}>{margin}%</span>
            </div>
          </Section>

          {/* Stock & Inventory */}
          <Section title="Stock & Inventory">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Opening Stock" required>
                <Input className="h-10" type="number" inputMode="decimal" placeholder="0" {...form.register("stockQuantity")} />
              </Field>
              <Field label="Low Stock Alert">
                <Input className="h-10" type="number" inputMode="decimal" placeholder="0" {...form.register("lowStockAlert")} />
              </Field>
              <Field label="Reorder Level">
                <Input className="h-10" type="number" inputMode="decimal" placeholder="0" {...form.register("reorderLevel")} />
              </Field>
            </div>
          </Section>

          {/* Product Image */}
          <Section title="Product Image">
            <div className="flex items-center gap-3">
              <div className="grid h-[84px] w-[84px] shrink-0 place-items-center overflow-hidden rounded-[12px] border border-[#e6ecf4] bg-[#f7f9fc]">
                {imageUrl ? <img src={imageUrl} alt="Product" className="h-full w-full object-contain" /> : <Upload size={20} className="text-[#9aa6bb]" />}
              </div>
              <button type="button" onClick={() => fileRef.current?.click()} className="flex h-[84px] flex-1 flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-[#cdd9ea] bg-[#fafbfe] text-center transition-colors hover:border-[#0057ff]/50">
                <Upload size={18} className="text-[#0057ff]" />
                <span className="text-[12px] font-bold text-[#0057ff]">{imageUrl ? "Replace Image" : "Upload Image"}</span>
                <span className="text-[10px] text-[#9aa6bb]">PNG, JPG up to 2MB</span>
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
            </div>
            <p className="mt-1.5 text-[10px] text-[#9aa6bb]">Recommended size: 512x512px{imageUrl ? " · stored on this device and synced." : ""}</p>
            {imageUrl && (
              <button type="button" onClick={() => form.setValue("imageUrl", "", { shouldDirty: true })} className="mt-1 text-[11px] font-semibold text-rose-600 hover:underline">Remove image</button>
            )}
            {imgError && <p className="mt-1 text-[11px] text-rose-600">{imgError}</p>}
          </Section>

          {/* Additional Information */}
          <Section title="Additional Information">
            <Field label="Description (Optional)">
              <textarea
                {...form.register("description")}
                maxLength={250}
                rows={3}
                placeholder="Enter product description..."
                className="w-full resize-none rounded-[10px] border border-[#e3eaf3] bg-white px-3 py-2 text-[13px] text-[#0f2147] placeholder:text-[#6b7a9a] focus:border-[#0057ff] focus:outline-none focus:ring-0"
              />
              <p className="mt-1 text-right text-[10px] text-[#9aa6bb]">{description.length}/250</p>
            </Field>
          </Section>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-[#eef1f6] px-5 py-3.5">
          {!editing && (
            <label className="mb-3 flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-[#45577a]">
              <input type="checkbox" checked={stayOpen} onChange={(e) => onStayOpenChange(e.target.checked)} className="h-4 w-4 rounded border-[#cdd9ea] accent-[#0057ff]" />
              Keep panel open to add another product
            </label>
          )}
          <div className="flex gap-2.5">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="submit"
              disabled={isPending}
              style={{ background: "linear-gradient(180deg, #005dff 0%, #0047e8 100%)" }}
              className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white shadow-[0_10px_22px_rgba(0,77,255,0.28)] hover:opacity-95"
            >
              {isPending ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : editing ? "Update Product" : "Save Product"}
            </Button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function TypeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 items-center justify-center gap-2 rounded-[9px] text-[13px] font-bold transition-all ${
        active ? "bg-white text-[#0057ff] shadow-[0_2px_8px_rgba(15,23,42,0.08)]" : "text-[#6d7c98] hover:text-[#13274d]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-3 text-[13px] font-black text-[#13274d]">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">
        {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
      </Label>
      {children}
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
