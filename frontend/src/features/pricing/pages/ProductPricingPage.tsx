import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Box, Building2, Layers, MapPin, Package, Plus, Trash2, Users, UserSquare } from "lucide-react";
import { getListProductsQueryKey, useListCustomers, useListProducts, type Customer, type Product, type ProductSellingUnit } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { usePricingRules, partitionProductRules } from "@/features/pricing/use-pricing-rules";
import type { ApiPricingRule } from "@/features/pricing/api";
import { createProductSellingUnit, deleteProductSellingUnit, listProductSellingUnits } from "@/features/pricing/api";
import { baseUnitFor, sellingUnitCode, sellingUnitConversion, sellingUnitName } from "@/features/products/pages/product-pricing";
import { LoadingSkeleton } from "@/components/shared";
import { getActiveLocationId } from "@/features/stores/location-context";

const GROUPS = ["Retail", "Regular", "VIP", "Reseller", "Wholesale", "Institutional", "Staff"];
const rs = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function ProductPricingPage() {
  const params = useParams<{ productId: string }>();
  const productId = params.productId ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const productsQuery = useListProducts({ limit: 1000 }, { query: { staleTime: 60_000 } });
  const product = useMemo(
    () => (productsQuery.data ?? []).find((p: Product) => p.id === productId),
    [productsQuery.data, productId],
  );
  const customersQuery = useListCustomers();
  const unitsQuery = useQuery({
    queryKey: ["product-selling-units", productId],
    queryFn: () => listProductSellingUnits(productId),
    enabled: Boolean(productId),
    initialData: product?.sellingUnits,
  });
  const createUnit = useMutation({
    mutationFn: (body: ProductSellingUnit) => createProductSellingUnit(productId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["product-selling-units", productId] });
      await queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    },
  });
  const removeUnit = useMutation({
    mutationFn: (unitId: string) => deleteProductSellingUnit(productId, unitId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["product-selling-units", productId] });
      await queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    },
  });
  const { query, create, remove } = usePricingRules();
  const rules = query.data ?? [];
  const activeLocationId = getActiveLocationId();
  const [pricingScope, setPricingScope] = useState<"store" | "all">(() => activeLocationId ? "store" : "all");
  const scopedRules = useMemo(
    () => rules.filter((rule) => pricingScope === "store" ? rule.locationId === activeLocationId : !rule.locationId),
    [rules, pricingScope, activeLocationId],
  );
  const partitioned = useMemo(() => partitionProductRules(scopedRules, productId), [scopedRules, productId]);
  const units = unitsQuery.data ?? product?.sellingUnits ?? [];
  const [selectedUnitKey, setSelectedUnitKey] = useState("");
  const selectedUnit = units.find((unit) => (unit.id ?? unit.unitCode) === selectedUnitKey)
    ?? units.find((unit) => unit.isDefault)
    ?? units[0];
  useEffect(() => {
    if (!selectedUnitKey && selectedUnit) setSelectedUnitKey(selectedUnit.id ?? selectedUnit.unitCode);
  }, [selectedUnitKey, selectedUnit]);
  const appliesToSelectedUnit = (rule: ApiPricingRule) => selectedUnit
    ? rule.sellingUnitId
      ? rule.sellingUnitId === selectedUnit.id
      : rule.unitCode
        ? rule.unitCode === selectedUnit.unitCode
        : selectedUnit.isDefault
    : !rule.sellingUnitId && !rule.unitCode;
  const quantitySlabs = partitioned.quantitySlabs.filter(appliesToSelectedUnit);
  const groupPrices = partitioned.groupPrices.filter(appliesToSelectedUnit);
  const customerPrices = partitioned.customerPrices.filter(appliesToSelectedUnit);

  const unit = selectedUnit?.name ?? product?.rateUnit ?? product?.displayUnit ?? "unit";
  const busy = create.isPending || remove.isPending || createUnit.isPending || removeUnit.isPending;

  const add = async (body: Partial<ApiPricingRule> & { name: string; ruleType: string }) => {
    try {
      await create.mutateAsync({
        ...body,
        productId,
        locationId: pricingScope === "store" ? activeLocationId : null,
        sellingUnitId: selectedUnit?.id,
        unitCode: selectedUnit?.unitCode,
      });
      toast({ title: "Pricing rule added" });
    } catch (e) {
      toast({ title: "Could not add rule", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    }
  };
  const del = async (id: string) => {
    try { await remove.mutateAsync(id); toast({ title: "Rule removed" }); }
    catch (e) { toast({ title: "Could not remove", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }); }
  };

  if (productsQuery.isLoading) return <LoadingSkeleton variant="detail" rows={3} className="mx-auto max-w-6xl p-5" />;
  if (!product) return (
    <div className="p-6">
      <button onClick={() => navigate("/products")} className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-[#405273]"><ArrowLeft size={14} /> Products</button>
      <p className="text-sm text-[#8290a8]">Product not found.</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      <button onClick={() => navigate("/products")} className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-[#405273] hover:text-[var(--brand)]"><ArrowLeft size={14} /> Products</button>
      <h1 className="font-display text-xl font-black text-[var(--brand-ink)]">{product.name} — Pricing</h1>
      <p className="mt-0.5 text-[12px] text-[#6d7c98]">Set quantity slabs, group prices, and customer exceptions. The billing engine uses these automatically.</p>

      <div className="mt-4 rounded-2xl border border-[#dce7f7] bg-[#f8fbff] p-3">
        <p className="text-[10.5px] font-black uppercase tracking-wide text-[#6d7c98]">Price rule scope</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" disabled={!activeLocationId} onClick={() => setPricingScope("store")} className={`rounded-xl border p-3 text-left transition ${pricingScope === "store" ? "border-[var(--brand)] bg-white shadow-sm" : "border-transparent bg-transparent"} disabled:opacity-50`}>
            <span className="flex items-center gap-2 text-[12px] font-black text-[var(--brand-ink)]"><MapPin size={14} className="text-[var(--brand)]" />Current store</span>
            <span className="mt-1 block text-[10.5px] text-[#6d7c98]">Overrides company prices only at this location.</span>
          </button>
          <button type="button" onClick={() => setPricingScope("all")} className={`rounded-xl border p-3 text-left transition ${pricingScope === "all" ? "border-[var(--brand)] bg-white shadow-sm" : "border-transparent bg-transparent"}`}>
            <span className="flex items-center gap-2 text-[12px] font-black text-[var(--brand-ink)]"><Building2 size={14} className="text-[var(--brand)]" />All stores</span>
            <span className="mt-1 block text-[10.5px] text-[#6d7c98]">A company-wide default inherited by every location.</span>
          </button>
        </div>
        <p className="mt-2 text-[10.5px] font-semibold text-[#31527e]">Store rules win over an all-store rule when both match the same sale.</p>
      </div>

      {/* Default pricing summary */}
      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-[#e6ecf4] bg-white p-4 sm:grid-cols-4">
        <Metric label="Cost" value={rs(product.costPerRateUnit)} />
        <Metric label="Selling" value={rs(product.defaultPricePerRateUnit)} />
        <Metric label="Minimum" value={rs(product.minPricePerRateUnit)} />
        <Metric label="MRP" value={product.mrp ? rs(product.mrp) : "—"} />
      </div>

      <Section icon={<Package size={15} />} title="Selling units & pack sizes" hint="Each packet, pouch, bottle, box, or carton has its own stock conversion and price.">
        <div className="grid gap-2 sm:grid-cols-2">
          {units.map((row) => {
            const active = selectedUnit && (row.id ?? row.unitCode) === (selectedUnit.id ?? selectedUnit.unitCode);
            return (
              <button
                key={row.id ?? row.unitCode}
                type="button"
                onClick={() => setSelectedUnitKey(row.id ?? row.unitCode)}
                className={`relative rounded-xl border p-3 text-left transition-colors ${active ? "border-[var(--brand)] bg-[#eef4ff]" : "border-[#e6ecf4] bg-white hover:border-[#b9cef7]"}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block text-[13px] font-black text-[var(--brand-ink)]">{row.name}</span>
                    <span className="mt-0.5 block text-[10.5px] font-semibold text-[#6d7c98]">1 {row.unitType} removes {row.conversionToBase} {product.baseUnit ?? "base units"}</span>
                  </span>
                  {row.isDefault ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-700">Default</span> : null}
                </span>
                <span className="mt-2 flex items-center gap-3 text-[11px] font-bold text-[#405273]">
                  <span>{rs(row.defaultPrice)}</span>
                  {row.minimumPrice ? <span>Min {rs(row.minimumPrice)}</span> : null}
                  {!row.isDefault && row.id ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => { event.stopPropagation(); void removeUnit.mutateAsync(row.id!).catch((error) => toast({ title: "Could not disable unit", description: error instanceof Error ? error.message : "Try again", variant: "destructive" })); }}
                      className="ml-auto text-rose-600"
                    >Disable</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <SellingUnitAdd
          product={product}
          disabled={busy}
          onAdd={async (row) => {
            try {
              const created = await createUnit.mutateAsync(row);
              setSelectedUnitKey(created.id ?? created.unitCode);
              toast({ title: `${created.name} added`, description: "You can now add quantity slabs for this exact pack size." });
            } catch (error) {
              toast({ title: "Could not add selling unit", description: error instanceof Error ? error.message : "Try again", variant: "destructive" });
            }
          }}
        />
      </Section>

      {/* Quantity slabs */}
      <Section icon={<Layers size={15} />} title="Quantity slabs" hint={`Quantity is counted in ${unit}. Stock conversion happens separately.`}>
        {selectedUnit ? (
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-[#31527e]">
            Example: minimum quantity 4 means 4 × {selectedUnit.name}; stock changes by {4 * selectedUnit.conversionToBase} {product.baseUnit ?? "base units"}.
          </div>
        ) : null}
        {quantitySlabs.map((r) => (
          <Row key={r.id} onDelete={() => del(r.id)} busy={busy}
            main={`${r.minQuantity ?? 0}${r.maxQuantity != null ? `–${r.maxQuantity}` : "+"} ${unit}`}
            price={rs(r.fixedUnitPrice)} />
        ))}
        <SlabAdd unit={unit} disabled={busy} onAdd={(minQ, maxQ, price) => add({
          name: `${product.name} ${minQ}+`, ruleType: "PRODUCT_QUANTITY_PRICE",
          minQuantity: minQ, maxQuantity: maxQ ?? undefined, fixedUnitPrice: price,
        })} />
      </Section>

      {/* Customer-group prices */}
      <Section icon={<Users size={15} />} title="Customer group prices" hint="Wholesale, VIP, etc.">
        {groupPrices.map((r) => (
          <Row key={r.id} onDelete={() => del(r.id)} busy={busy} main={r.customerGroup ?? "Group"} price={rs(r.fixedUnitPrice)} />
        ))}
        <GroupAdd disabled={busy} onAdd={(group, price) => add({
          name: `${group} price`, ruleType: "CUSTOMER_GROUP_PRICE", customerGroup: group, fixedUnitPrice: price,
        })} />
      </Section>

      {/* Customer exceptions */}
      <Section icon={<UserSquare size={15} />} title="Customer exceptions" hint="A fixed price for one customer">
        {customerPrices.map((r) => {
          const c = (customersQuery.data ?? []).find((x: Customer) => x.id === r.customerId);
          return <Row key={r.id} onDelete={() => del(r.id)} busy={busy} main={c?.name ?? r.customerId ?? "Customer"} price={rs(r.fixedUnitPrice)} />;
        })}
        <CustomerAdd customers={customersQuery.data ?? []} disabled={busy} onAdd={(customerId, name, price) => add({
          name: `${name} price`, ruleType: "CUSTOMER_FIXED_PRICE", customerId, fixedUnitPrice: price,
        })} />
      </Section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10.5px] font-bold uppercase text-[#8290a8]">{label}</p><p className="mt-0.5 text-sm font-black text-[var(--brand-ink)]">{value}</p></div>;
}

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-[#e6ecf4] bg-white p-4 shadow-[0_6px_20px_rgba(15,35,80,0.05)]">
      <p className="inline-flex items-center gap-2 text-[13.5px] font-black text-[var(--brand-ink)]"><span className="text-[var(--brand)]">{icon}</span>{title}</p>
      <p className="mt-0.5 text-[11.5px] text-[#8290a8]">{hint}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function Row({ main, price, onDelete, busy }: { main: string; price: string; onDelete: () => void; busy: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[#eef2f8] bg-[#f9fbfe] px-3 py-2">
      <span className="text-[12.5px] font-semibold text-[#334364]">{main}</span>
      <span className="flex items-center gap-3">
        <span className="text-[13px] font-black text-[var(--brand-ink)]">{price}</span>
        <button type="button" disabled={busy} onClick={onDelete} aria-label="Remove" className="text-[#9aa7bd] hover:text-red-600 disabled:opacity-40"><Trash2 size={15} /></button>
      </span>
    </div>
  );
}

const inputCls = "h-9 rounded-lg border border-[#dce5f1] bg-white px-2 text-[13px] outline-none focus:border-[var(--brand)]";
const addBtn = "inline-flex h-9 items-center gap-1 rounded-lg bg-[var(--brand)] px-3 text-[12px] font-bold text-white disabled:opacity-50";

function SlabAdd({ unit, onAdd, disabled }: { unit: string; onAdd: (min: number, max: number | null, price: number) => void; disabled: boolean }) {
  const [min, setMin] = useState(""); const [max, setMax] = useState(""); const [price, setPrice] = useState("");
  const ok = Number(min) > 0 && Number(price) > 0 && (max === "" || Number(max) >= Number(min));
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <input className={`${inputCls} w-16`} inputMode="decimal" placeholder="Min" value={min} onChange={(e) => setMin(e.target.value)} />
      <span className="text-[12px] text-[#8290a8]">to</span>
      <input className={`${inputCls} w-16`} inputMode="decimal" placeholder="∞" value={max} onChange={(e) => setMax(e.target.value)} />
      <span className="text-[12px] text-[#8290a8]">{unit} @</span>
      <input className={`${inputCls} w-20`} inputMode="decimal" placeholder="₹ price" value={price} onChange={(e) => setPrice(e.target.value)} />
      <button className={addBtn} disabled={disabled || !ok} onClick={() => { onAdd(Number(min), max === "" ? null : Number(max), Number(price)); setMin(""); setMax(""); setPrice(""); }}><Plus size={14} /> Add</button>
    </div>
  );
}

function SellingUnitAdd({ product, onAdd, disabled }: { product: Product; onAdd: (unit: ProductSellingUnit) => Promise<void>; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [unitType, setUnitType] = useState("packet");
  const [packSize, setPackSize] = useState("500");
  const [packMeasure, setPackMeasure] = useState(product.baseUnit ?? "gram");
  const [conversion, setConversion] = useState("500");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [cost, setCost] = useState("");
  const name = sellingUnitName(unitType, Number(packSize), packMeasure);
  const valid = name && Number(packSize) > 0 && Number(conversion) > 0 && Number(price) > 0
    && (minimum === "" || Number(minimum) >= 0)
    && (maximum === "" || Number(maximum) >= Number(minimum || 0));

  function updatePackSize(next: string) {
    setPackSize(next);
    if (baseUnitFor(packMeasure) === (product.baseUnit ?? baseUnitFor(packMeasure))) {
      setConversion(String(sellingUnitConversion(Number(next), packMeasure)));
    }
  }

  function updatePackMeasure(next: string) {
    setPackMeasure(next);
    if (baseUnitFor(next) === (product.baseUnit ?? baseUnitFor(next))) {
      setConversion(String(sellingUnitConversion(Number(packSize), next)));
    }
  }

  if (!open) {
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-[#9dbcf4] px-3 text-[12px] font-black text-[var(--brand)] hover:bg-[#f5f8ff] disabled:opacity-50">
        <Plus size={14} /> Add another pack / unit
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[#dce7f7] bg-[#f9fbff] p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-black text-[var(--brand-ink)]"><Box size={14} className="text-[var(--brand)]" />New selling unit</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[10px] font-bold uppercase text-[#6d7c98]">Sell as
          <select className={`${inputCls} mt-1 w-full normal-case`} value={unitType} onChange={(event) => setUnitType(event.target.value)}>
            {["piece", "packet", "pouch", "bottle", "strip", "dozen", "bundle", "box", "case", "carton", "kg", "gram", "litre", "ml", "custom"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-bold uppercase text-[#6d7c98]">Pack contains
          <input className={`${inputCls} mt-1 w-full normal-case`} inputMode="decimal" value={packSize} onChange={(event) => updatePackSize(event.target.value)} placeholder="500" />
        </label>
        <label className="text-[10px] font-bold uppercase text-[#6d7c98]">Measure
          <select className={`${inputCls} mt-1 w-full normal-case`} value={packMeasure} onChange={(event) => updatePackMeasure(event.target.value)}>
            {["piece", "packet", "gram", "kg", "ml", "litre"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-bold uppercase text-[#6d7c98]">Stock removed ({product.baseUnit ?? "base"})
          <input className={`${inputCls} mt-1 w-full normal-case`} inputMode="decimal" value={conversion} onChange={(event) => setConversion(event.target.value)} placeholder="500" />
        </label>
        <label className="text-[10px] font-bold uppercase text-[#6d7c98]">Selling price
          <input className={`${inputCls} mt-1 w-full normal-case`} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Rs 0" />
        </label>
        <label className="text-[10px] font-bold uppercase text-[#6d7c98]">Minimum price
          <input className={`${inputCls} mt-1 w-full normal-case`} inputMode="decimal" value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="Optional" />
        </label>
        <label className="text-[10px] font-bold uppercase text-[#6d7c98]">MRP / maximum
          <input className={`${inputCls} mt-1 w-full normal-case`} inputMode="decimal" value={maximum} onChange={(event) => setMaximum(event.target.value)} placeholder="Optional" />
        </label>
        <label className="text-[10px] font-bold uppercase text-[#6d7c98]">Cost price
          <input className={`${inputCls} mt-1 w-full normal-case`} inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Optional" />
        </label>
        <label className="text-[10px] font-bold uppercase text-[#6d7c98]">Barcode
          <input className={`${inputCls} mt-1 w-full normal-case`} value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Optional" />
        </label>
      </div>
      <p className="mt-2 text-[11px] font-semibold text-[#31527e]">{name}: quantity 4 means four {name}s and removes {Number(conversion || 0) * 4} {product.baseUnit ?? "base units"} from stock.</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg border border-[#dce5f1] px-3 text-[12px] font-bold text-[#405273]">Cancel</button>
        <button
          type="button"
          disabled={disabled || !valid}
          onClick={() => void onAdd({
            name,
            unitType,
            unitCode: sellingUnitCode(unitType, Number(packSize), packMeasure),
            packSizeValue: Number(packSize),
            packSizeUnit: packMeasure,
            conversionToBase: Number(conversion),
            barcode: barcode.trim() || null,
            defaultPrice: Number(price),
            minimumPrice: minimum === "" ? null : Number(minimum),
            maximumPrice: maximum === "" ? null : Number(maximum),
            costPrice: cost === "" ? null : Number(cost),
            isDefault: false,
            isActive: true,
          }).then(() => { setOpen(false); setPrice(""); setBarcode(""); })}
          className={addBtn}
        >
          <Plus size={14} /> Add {name}
        </button>
      </div>
    </div>
  );
}

function GroupAdd({ onAdd, disabled }: { onAdd: (group: string, price: number) => void; disabled: boolean }) {
  const [group, setGroup] = useState(GROUPS[4]); const [price, setPrice] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <select className={inputCls} value={group} onChange={(e) => setGroup(e.target.value)}>{GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}</select>
      <span className="text-[12px] text-[#8290a8]">@</span>
      <input className={`${inputCls} w-24`} inputMode="decimal" placeholder="₹ price" value={price} onChange={(e) => setPrice(e.target.value)} />
      <button className={addBtn} disabled={disabled || !(Number(price) > 0)} onClick={() => { onAdd(group, Number(price)); setPrice(""); }}><Plus size={14} /> Add</button>
    </div>
  );
}

function CustomerAdd({ customers, onAdd, disabled }: { customers: Customer[]; onAdd: (id: string, name: string, price: number) => void; disabled: boolean }) {
  const [id, setId] = useState(""); const [price, setPrice] = useState("");
  const selected = customers.find((c) => c.id === id);
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <select className={`${inputCls} max-w-[190px]`} value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">Select customer…</option>
        {customers.filter((c) => c.deletedAt == null).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <span className="text-[12px] text-[#8290a8]">@</span>
      <input className={`${inputCls} w-24`} inputMode="decimal" placeholder="₹ price" value={price} onChange={(e) => setPrice(e.target.value)} />
      <button className={addBtn} disabled={disabled || !id || !(Number(price) > 0)} onClick={() => { if (selected) onAdd(id, selected.name, Number(price)); setId(""); setPrice(""); }}><Plus size={14} /> Add</button>
    </div>
  );
}
