import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { UseFormReturn } from "react-hook-form";
import { PanelResizeHandle } from "@/hooks/use-panel-resize";
import type { Product } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Package, Plus, Scale, ScanLine, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBusinessType } from "@/features/settings/business-types";
import { getShopWorkflow } from "@/features/settings/shop-workflows";
import { useFeature } from "@/features/subscription";
import { getLocalProductAliasSuggestions, splitProductAliases, uniqueProductAliases } from "@/features/products/product-reliability";
import { fetchGroqAliasSuggestions } from "../product-aliases";
import { baseUnitFor, sellingUnitCode, sellingUnitConversion, sellingUnitName, UNITS } from "../product-pricing";
import type { ProductFormData } from "../product-form-state";
import { generateInternalEan13 } from "@/lib/barcode/ean13";

const GST_RATES = [0, 5, 12, 18, 28];
const PACK_MEASURE_UNITS = ["piece", "tablet", "gram", "kg", "ml", "litre"];
const PACK_SELLING_UNITS = ["piece", "packet", "pouch", "bottle", "box", "carton"];

const EMPTY_EXTRA_PACK = {
  unitType: "packet",
  packSizeValue: "500",
  packSizeUnit: "gram",
  price: "",
  barcode: "",
  openingQty: "",
};

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
  const { businessType, def } = useBusinessType();
  const workflow = getShopWorkflow(businessType);
  const productEntry = workflow.productEntry;
  const batchFeature = useFeature("batch_expiry");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [extraPackOpen, setExtraPackOpen] = useState(false);
  const [extraPack, setExtraPack] = useState(EMPTY_EXTRA_PACK);
  const categories = def.categories.filter((c) => c !== "all");
  const imageUrl = form.watch("imageUrl");
  const description = form.watch("description") ?? "";
  const batchTracking = form.watch("batchTrackingEnabled");
  const isLoose = !!form.watch("isLooseItem");
  const selectedUnit = form.watch("unit");
  const packSizeValue = Number(form.watch("packSizeValue") || 0);
  const packSizeUnit = form.watch("packSizeUnit");
  const showPackContent = !isLoose;
  const packBaseQuantity = sellingUnitConversion(packSizeValue, packSizeUnit);
  const packBaseUnit = baseUnitFor(packSizeUnit);
  const currentSellingUnitName = isLoose
    ? selectedUnit
    : sellingUnitName(selectedUnit, packSizeValue, packSizeUnit);
  const sellingUnits = form.watch("sellingUnits") ?? [];
  const packagingMode = form.watch("packagingMode") ?? "pooled";
  const alternateSellingUnits = sellingUnits.filter((row) => !row.isDefault);
  const err = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    setExtraPackOpen(false);
    setExtraPack(EMPTY_EXTRA_PACK);
  }, [editing?.id, open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.dataset.appMobileTaskOpen = "true";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      delete document.body.dataset.appMobileTaskOpen;
    };
  }, [open]);

  function addAlternatePack() {
    const size = Number(extraPack.packSizeValue);
    const price = Number(extraPack.price);
    if (!(size > 0) || !(price > 0)) {
      toast({
        title: "Pack size and price required",
        description: "Enter what the pack contains and its selling price.",
        variant: "destructive",
      });
      return;
    }
    const code = sellingUnitCode(extraPack.unitType, size, extraPack.packSizeUnit);
    const defaultCode = sellingUnitCode(selectedUnit, packSizeValue, packSizeUnit);
    if (code === defaultCode || sellingUnits.some((row) => row.unitCode === code)) {
      toast({ title: "Pack already added", description: "Choose a different unit or pack size.", variant: "destructive" });
      return;
    }
    form.setValue("sellingUnits", [
      ...sellingUnits,
      {
        name: sellingUnitName(extraPack.unitType, size, extraPack.packSizeUnit),
        unitType: extraPack.unitType,
        unitCode: code,
        packSizeValue: size,
        packSizeUnit: extraPack.packSizeUnit,
        conversionToBase: sellingUnitConversion(size, extraPack.packSizeUnit),
        barcode: extraPack.barcode.trim() || null,
        defaultPrice: price,
        minimumPrice: null,
        maximumPrice: null,
        costPrice: null,
        // In per-pack mode the opening quantity IS this pack's own count and must not
        // also be folded into the shared pool below, or the same goods would be
        // counted twice.
        ...(packagingMode === "per_pack"
          ? { onHandQty: Number(extraPack.openingQty) || 0, lowStockThreshold: null }
          : {}),
        isDefault: false,
        isActive: true,
      },
    ], { shouldDirty: true, shouldValidate: true });

    // Pooled only: opening quantity is a stock-IN expressed in this pack, not a second
    // count for it. Every pack size draws on one base-unit pool, so "20 x 500 g packets"
    // is 10,000 g added to that pool. Storing it per pack instead would create a number
    // nothing decrements on sale, which drifts from the real stock the moment you sell one.
    const openingQty = packagingMode === "per_pack" ? 0 : Number(extraPack.openingQty);
    if (openingQty > 0) {
      const packConversion = sellingUnitConversion(size, extraPack.packSizeUnit);
      const addedInDefaultUnits = packBaseQuantity > 0
        ? (openingQty * packConversion) / packBaseQuantity
        : 0;
      if (addedInDefaultUnits > 0) {
        const current = Number(form.getValues("stockQuantity")) || 0;
        const next = Math.round((current + addedInDefaultUnits) * 1000) / 1000;
        form.setValue("stockQuantity", next, { shouldDirty: true, shouldValidate: true });
        toast({
          title: `Added ${openingQty} x ${sellingUnitName(extraPack.unitType, size, extraPack.packSizeUnit)}`,
          description: `Opening stock is now ${next} ${currentSellingUnitName}. All pack sizes share this one stock.`,
        });
      }
    }

    setExtraPack(EMPTY_EXTRA_PACK);
    setExtraPackOpen(false);
  }

  function updatePackField(unitCode: string, field: "onHandQty" | "lowStockThreshold", raw: string) {
    const parsed = raw.trim() === "" ? null : Number(raw);
    form.setValue(
      "sellingUnits",
      sellingUnits.map((row) =>
        row.unitCode === unitCode
          ? { ...row, [field]: parsed !== null && Number.isFinite(parsed) ? parsed : null }
          : row,
      ),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function removeAlternatePack(unitCode: string) {
    form.setValue("sellingUnits", sellingUnits.filter((row) => row.unitCode !== unitCode), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

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
  // Margin as markup over cost: (sell - cost) / cost. Needs a positive cost to be meaningful.
  const margin = cost > 0 ? Math.round(((selling - cost) / cost) * 1000) / 10 : 0;

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
    <Field label={isLoose ? "Rate / Stock Unit" : "Sold As"} required>
      <Select value={form.watch("unit")} onValueChange={(v) => form.setValue("unit", v, { shouldDirty: true })}>
        <SelectTrigger className="h-10"><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent>
          {Array.from(new Set(def.primaryUnits)).map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          <div className="my-1 h-px bg-border" />
          {Array.from(new Set(UNITS)).filter((u) => !def.primaryUnits.includes(u)).map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <aside
      data-mobile-task-panel="product-form"
      style={{ width }}
      className={`app-slide-panel fixed inset-y-0 right-0 top-0 z-[90] flex h-[100dvh] w-full max-w-[100vw] flex-col border-l-0 border-[#e6ecf4] bg-white shadow-none transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:z-[80] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] lg:border-l lg:shadow-[-12px_0_40px_rgba(15,23,42,0.10)] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog"
      aria-label={editing ? "Edit product" : "Add new product"}
      aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">
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
        <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="mb-4 rounded-[12px] border border-[var(--brand-border)] bg-[var(--brand-softer)] p-3" data-testid="shop-product-entry-guide">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--brand)]">Optimized for {def.label}</p>
            <p className="mt-1 text-[11.5px] font-semibold leading-5 text-[#52627e]">{productEntry.helper}</p>
          </div>

          {/* Product type: Packed / Loose */}
          <div className="mb-5 grid grid-cols-2 gap-2 rounded-[12px] border border-[#e6ecf4] bg-[#f7f9fc] p-1">
            <TypeButton active={!isLoose} icon={<Package size={16} />} label="Packed Item" onClick={() => form.setValue("isLooseItem", false, { shouldDirty: true })} />
            <TypeButton active={isLoose} icon={<Scale size={16} />} label="Loose Item" onClick={() => form.setValue("isLooseItem", true, { shouldDirty: true })} />
          </div>

          {/* Basic Information */}
          <Section title="Basic Information">
            <Field label={productEntry.nameLabel} required error={err.name?.message}>
              <Input className="h-10" placeholder={isLoose ? productEntry.looseNamePlaceholder : productEntry.namePlaceholder} {...form.register("name")} />
            </Field>

            {/* Category + Brand (brand hidden for loose) */}
            {isLoose ? (
              CategoryField
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {CategoryField}
                <Field label={productEntry.brandLabel}>
                  <Input className="h-10" placeholder={productEntry.brandPlaceholder} {...form.register("brand")} />
                </Field>
              </div>
            )}

            {/* SKU/Barcode + Unit (SKU hidden for loose) */}
            {isLoose ? (
              UnitField
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={productEntry.identifierLabel} error={err.barcode?.message}>
                  <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Input className="h-10 pr-9" placeholder={productEntry.identifierPlaceholder} {...form.register("barcode")} />
                      <ScanLine size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7a9a]" />
                    </div>
                    <Button type="button" variant="outline" className="h-10 shrink-0 px-3" onClick={() => form.setValue("barcode", generateInternalEan13(), { shouldDirty: true, shouldValidate: true })}>
                      Generate
                    </Button>
                  </div>
                </Field>
                {UnitField}
              </div>
            )}

            {showPackContent ? (
              <div className="rounded-[12px] border border-[var(--brand-border)] bg-[var(--brand-softer)] p-3.5" data-testid="packed-unit-setup">
                <div className="mb-3 flex items-start gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e7f0ff] text-[var(--brand)]"><Package size={16} /></span>
                  <div>
                    <p className="text-[12px] font-black text-[#13274d]">Pack size used for billing and stock</p>
                    <p className="mt-0.5 text-[10.5px] font-semibold leading-relaxed text-[#6d7c98]">Example: a salt packet sold for Rs 28 contains 1 kg. Billing counts packets; inventory counts grams.</p>
                  </div>
                </div>

                <p className="mb-1.5 text-[11px] font-bold text-[#45577a]">Quick selling unit</p>
                <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
                  {PACK_SELLING_UNITS.map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => form.setValue("unit", unit, { shouldDirty: true, shouldValidate: true })}
                      className={`h-8 shrink-0 rounded-lg border px-2.5 text-[10.5px] font-extrabold capitalize transition-colors ${selectedUnit === unit ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[#dfe8f5] bg-white text-[#45577a] hover:border-[#a9c5ff]"}`}
                    >
                      {unit}
                    </button>
                  ))}
                </div>

                <Field label={`One ${selectedUnit || "selling unit"} contains`} required error={err.packSizeValue?.message}>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(120px,0.9fr)] gap-2">
                    <Input
                      data-testid="input-pack-size"
                      className="h-10 bg-white"
                      type="number"
                      inputMode="decimal"
                      min="0.001"
                      step="0.001"
                      placeholder="e.g. 500"
                      {...form.register("packSizeValue")}
                    />
                    <Select value={packSizeUnit} onValueChange={(v) => form.setValue("packSizeUnit", v, { shouldDirty: true, shouldValidate: true })}>
                      <SelectTrigger data-testid="select-pack-measure" className="h-10 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PACK_MEASURE_UNITS.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </Field>
                <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg border border-[#dce8fb] bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11.5px] font-black text-[#12346b]">Billing unit: {currentSellingUnitName}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-[#6d7c98]">1 {selectedUnit} removes {packBaseQuantity || 0} {packBaseUnit} from stock</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#e9fff0] px-2 py-1 text-[9.5px] font-black uppercase text-[#159447]">Exact pack</span>
                </div>
              </div>
            ) : null}

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
                  <span key={a} className="inline-flex items-center gap-1 rounded-full bg-[#eef4ff] px-2.5 py-1 text-[11px] font-bold text-[var(--brand)]">
                    {a}
                    <button type="button" onClick={() => removeAlias(a)} aria-label={`Remove ${a}`} className="text-[var(--brand)]/60 hover:text-[var(--brand)]"><X size={11} /></button>
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
                  <button key={a} type="button" onClick={() => appendAlias(a)} className="inline-flex items-center gap-1 rounded-full border border-[#e3eaf3] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#45577a] transition-colors hover:border-[var(--brand)]/40 hover:text-[var(--brand)]">
                    <Plus size={11} /> {a}
                  </button>
                ))}
              </div>
            )}
          </Section>

          {/* Pricing */}
          <Section title="Pricing">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="MRP (₹)" required>
                <Input className="h-10" type="number" inputMode="decimal" step="0.01" placeholder="0.00" {...form.register("mrp")} />
              </Field>
              <Field label="Cost Price (₹)" required>
                <Input className="h-10" type="number" inputMode="decimal" step="0.01" placeholder="0.00" {...form.register("costPrice")} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

            {!isLoose ? (
              <div className="rounded-[12px] border border-[#e3eaf3] bg-[#fbfcfe] p-3" data-testid="alternate-pack-sizes">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-[#13274d]">Other pack sizes</p>
                    <p className="mt-0.5 text-[10.5px] font-semibold text-[#6d7c98]">Optional: sell the same stock as 500 g, 1 kg, carton, etc.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExtraPackOpen((value) => !value)}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--brand-border)] bg-white px-2.5 text-[10.5px] font-black text-[var(--brand)] hover:bg-[var(--brand-softer)]"
                  >
                    {extraPackOpen ? <X size={12} /> : <Plus size={12} />}
                    {extraPackOpen ? "Close" : "Add size"}
                  </button>
                </div>

                {/* How stock is counted across the sizes. Loose goods share one pool
                    (1 kg and a 5 kg bag come out of the same sack); sealed packs are
                    counted and reordered separately, which is the only way to answer
                    "which size do I need to order?". */}
                <div className="mt-3 rounded-lg border border-[#e3eaf3] bg-white p-2.5">
                  <p className="text-[10.5px] font-black text-[#13274d]">Stock counting</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {([
                      ["pooled", "One shared stock", "All sizes draw on the same stock. Best for loose goods."],
                      ["per_pack", "Count each size", "Each size has its own quantity and reorder alert."],
                    ] as const).map(([mode, title, hint]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => form.setValue("packagingMode", mode, { shouldDirty: true, shouldValidate: true })}
                        aria-pressed={packagingMode === mode}
                        className={`rounded-lg border p-2 text-left transition ${
                          packagingMode === mode
                            ? "border-[var(--brand)] bg-[#f2f7ff]"
                            : "border-[#e3eaf3] bg-white hover:bg-[#f7f9fc]"
                        }`}
                      >
                        <span className="block text-[10.5px] font-black text-[#13274d]">{title}</span>
                        <span className="mt-0.5 block text-[9.5px] font-semibold leading-snug text-[#6d7c98]">{hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {alternateSellingUnits.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {alternateSellingUnits.map((row) => (
                      <div key={row.id ?? row.unitCode} className="rounded-lg border border-[#e3eaf3] bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[11.5px] font-black text-[#13274d]">{row.name}</p>
                            <p className="mt-0.5 text-[10px] font-semibold text-[#6d7c98]">Rs {Number(row.defaultPrice).toLocaleString("en-IN")} · removes {row.conversionToBase} {baseUnitFor(row.packSizeUnit ?? packSizeUnit)}</p>
                          </div>
                          <button type="button" onClick={() => removeAlternatePack(row.unitCode)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-50" aria-label={`Remove ${row.name}`}><Trash2 size={13} /></button>
                        </div>
                        {packagingMode === "per_pack" ? (
                          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[#eef2f7] pt-2">
                            <Field label="In stock">
                              <Input
                                className="h-8"
                                type="number"
                                min="0"
                                step="1"
                                value={row.onHandQty ?? ""}
                                onChange={(event) => updatePackField(row.unitCode, "onHandQty", event.target.value)}
                                placeholder="0"
                                aria-label={`${row.name} in stock`}
                              />
                            </Field>
                            <Field label="Alert below">
                              <Input
                                className="h-8"
                                type="number"
                                min="0"
                                step="1"
                                value={row.lowStockThreshold ?? ""}
                                onChange={(event) => updatePackField(row.unitCode, "lowStockThreshold", event.target.value)}
                                placeholder="0"
                                aria-label={`${row.name} alert level`}
                              />
                            </Field>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {extraPackOpen ? (
                  <div className="mt-3 space-y-2.5 rounded-[10px] border border-[var(--brand-border)] bg-white p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Sold as" required>
                        <Select value={extraPack.unitType} onValueChange={(value) => setExtraPack((current) => ({ ...current, unitType: value }))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>{PACK_SELLING_UNITS.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                      <Field label="Selling price (Rs)" required>
                        <Input className="h-9" type="number" min="0.01" step="0.01" value={extraPack.price} onChange={(event) => setExtraPack((current) => ({ ...current, price: event.target.value }))} placeholder="0.00" />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={`One ${extraPack.unitType} contains`} required>
                        <Input className="h-9" type="number" min="0.001" step="0.001" value={extraPack.packSizeValue} onChange={(event) => setExtraPack((current) => ({ ...current, packSizeValue: event.target.value }))} placeholder="500" />
                      </Field>
                      <Field label="Measure" required>
                        <Select value={extraPack.packSizeUnit} onValueChange={(value) => setExtraPack((current) => ({ ...current, packSizeUnit: value }))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>{PACK_MEASURE_UNITS.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Opening quantity (Optional)">
                        <Input
                          className="h-9"
                          type="number"
                          min="0"
                          step="1"
                          data-testid="input-extra-pack-opening-qty"
                          value={extraPack.openingQty}
                          onChange={(event) => setExtraPack((current) => ({ ...current, openingQty: event.target.value }))}
                          placeholder="0"
                        />
                      </Field>
                      <Field label="Pack barcode (Optional)">
                        <Input className="h-9" value={extraPack.barcode} onChange={(event) => setExtraPack((current) => ({ ...current, barcode: event.target.value }))} placeholder="Barcode for this size" />
                      </Field>
                    </div>
                    <p className="text-[10px] font-semibold leading-4 text-[#6d7c98]">
                      How many of this pack you have now. It is added to the product's opening
                      stock — every pack size sells from that one stock.
                    </p>
                    <button type="button" onClick={addAlternatePack} className="h-9 w-full rounded-lg bg-[var(--brand)] text-[11.5px] font-black text-white hover:bg-[var(--brand-strong)]">Add pack to product</button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Section>

          {/* Stock & Inventory */}
          <Section title="Stock & Inventory">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={`Opening Stock (${currentSellingUnitName || selectedUnit})`} required>
                <Input className="h-10" type="number" inputMode="decimal" placeholder="0" {...form.register("stockQuantity")} />
              </Field>
              <Field label={`Low Stock Alert (${selectedUnit})`}>
                <Input className="h-10" type="number" inputMode="decimal" placeholder="0" {...form.register("lowStockAlert")} />
              </Field>
              <Field label="Reorder Level">
                <Input className="h-10" type="number" inputMode="decimal" placeholder="0" {...form.register("reorderLevel")} />
              </Field>
            </div>
            <div className={`flex items-start justify-between gap-4 rounded-[12px] border p-3.5 ${productEntry.recommendBatchTracking ? "border-teal-200 bg-teal-50" : "border-[#e3eaf3] bg-[#f8fafc]"}`} data-testid="shop-batch-guidance">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12px] font-black text-[#13274d]">Batch and expiry tracking</p>
                  {productEntry.recommendBatchTracking && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-teal-700">Recommended</span>}
                </div>
                <p className="mt-1 text-[10.5px] font-semibold leading-4 text-[#65748f]">{productEntry.batchRecommendation}</p>
                {!batchFeature.loading && !batchFeature.allowed && <p className="mt-1 text-[10.5px] font-bold text-amber-700">Available on {batchFeature.requiredPlan.name}.</p>}
              </div>
              <Switch
                checked={batchTracking}
                disabled={batchFeature.loading || !batchFeature.allowed}
                onCheckedChange={(checked) => form.setValue("batchTrackingEnabled", checked, { shouldDirty: true })}
                aria-label="Enable batch and expiry tracking"
              />
            </div>
          </Section>

          {/* Product Image */}
          <Section title="Product Image">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="grid h-[84px] w-[84px] shrink-0 place-items-center overflow-hidden rounded-[12px] border border-[#e6ecf4] bg-[#f7f9fc]">
                {imageUrl ? <img src={imageUrl} alt="Product" className="h-full w-full object-contain" /> : <Upload size={20} className="text-[#9aa6bb]" />}
              </div>
              <button type="button" onClick={() => fileRef.current?.click()} className="flex h-[84px] flex-1 flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-[#cdd9ea] bg-[#fafbfe] text-center transition-colors hover:border-[var(--brand)]/50">
                <Upload size={18} className="text-[var(--brand)]" />
                <span className="text-[12px] font-bold text-[var(--brand)]">{imageUrl ? "Replace Image" : "Upload Image"}</span>
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
            <Field label={productEntry.notesLabel}>
              <textarea
                {...form.register("description")}
                maxLength={250}
                rows={3}
                placeholder={productEntry.notesPlaceholder}
                className="w-full resize-none rounded-[10px] border border-[#e3eaf3] bg-white px-3 py-2 text-[13px] text-[var(--brand-ink)] placeholder:text-[#6b7a9a] focus:border-[var(--brand)] focus:outline-none focus:ring-0"
              />
              <p className="mt-1 text-right text-[10px] text-[#9aa6bb]">{description.length}/250</p>
            </Field>
          </Section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#eef1f6] bg-white px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5 shadow-[0_-12px_30px_rgba(15,35,80,0.06)]">
          {!editing && (
            <label className="mb-3 flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-[#45577a]">
              <input type="checkbox" aria-label="Keep panel open to add another product" checked={stayOpen} onChange={(e) => onStayOpenChange(e.target.checked)} className="h-4 w-4 rounded border-[#cdd9ea] accent-[var(--brand)]" />
              Keep panel open to add another product
            </label>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="outline" className="h-11 min-w-0 rounded-[10px] font-bold" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="submit"
              disabled={isPending}
              style={{ background: "linear-gradient(180deg, var(--brand) 0%, var(--brand-strong) 100%)" }}
              className="h-11 min-w-0 gap-2 rounded-[10px] font-black text-white shadow-[0_10px_22px_rgba(0,77,255,0.28)] hover:opacity-95"
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
        active ? "bg-white text-[var(--brand)] shadow-[0_2px_8px_rgba(15,23,42,0.08)]" : "text-[#6d7c98] hover:text-[#13274d]"
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
  const id = useId().replace(/:/g, "");
  const labelId = `product-field-label-${id}`;
  const errorId = `product-field-error-${id}`;
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const control = fieldRef.current?.querySelector<HTMLElement>("input, textarea, select, button, [role='combobox'], [role='switch']");
    if (!control) return;
    if (!control.hasAttribute("aria-label") && !control.hasAttribute("aria-labelledby")) control.setAttribute("aria-labelledby", labelId);
    if (error) control.setAttribute("aria-describedby", errorId);
    else if (control.getAttribute("aria-describedby") === errorId) control.removeAttribute("aria-describedby");
    control.setAttribute("aria-invalid", error ? "true" : "false");
  }, [error, errorId, labelId]);

  return (
    <div ref={fieldRef} role="group" aria-labelledby={labelId}>
      <Label id={labelId} className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">
        {label}{required && <span className="ml-0.5 text-rose-500" aria-hidden="true">*</span>}
      </Label>
      {children}
      {error && <p id={errorId} role="alert" aria-live="polite" className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
