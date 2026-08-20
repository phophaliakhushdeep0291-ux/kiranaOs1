import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Grid3x3, Lock, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, useMoneyDraft, useNumericDraft, useQuantityDraft } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  MAX_AXES,
  MAX_CELLS,
  buildVariantCells,
  canReorderAxes,
  droppedVariantCells,
  normalizeAxisValues,
  totalGridQty,
  variantCellsToSellingUnits,
  type VariantCell,
} from "@/features/core/products/pages/variant-grid";
import { useAppLanguage } from "@/features/core/settings/i18n";
import type { ProductSellingUnit, ProductVariantAxis } from "@/types/api";

/**
 * The size × colour grid, as a shopkeeper enters it.
 *
 * What this replaces is hand-typing one Product per size and colour — twenty
 * near-identical rows for one shirt, and no way to see that L-Blue is out while
 * XS sits dead on the shelf. Here the shop names the axes once, types the
 * values, and gets one row per combination with its own price, stock and
 * barcode.
 */

/** What these axes are usually called, so nobody has to think of the word. */
const AXIS_PRESETS = ["Size", "Colour", "Shade", "Material", "Fit", "Pack"];

export function VariantGridEditor({ axes, sellingUnits, baselineUnits, fallbackPrice, productDefaults, unitType, onChange }: {
  axes: ProductVariantAxis[];
  /** Every selling unit currently on the form, variant rows and packaging rows alike. */
  sellingUnits: ProductSellingUnit[];
  /**
   * The rows as they are actually saved against this product — empty when
   * creating one.
   *
   * Deliberately NOT `sellingUnits`, which is the live edit: every keystroke
   * rewrites that, so comparing against it would say a brand-new product
   * "already has stock", and would lose the row being dropped before it could
   * be named. Only what is on the books can be at risk, so only that is asked.
   */
  baselineUnits: ProductSellingUnit[];
  /** What a brand-new cell is priced at until the shop says otherwise. */
  fallbackPrice: number;
  /**
   * The product's own money and reorder settings, which a size that has none of
   * its own falls back to when saved. Left blank in the grid, a size simply
   * follows the product — which is what a shop expects when every size costs
   * the same and only one of them is unusual.
   */
  productDefaults: {
    mrp?: number | null;
    costPrice?: number | null;
    minimumPrice?: number | null;
  };
  unitType: string;
  onChange: (next: { axes: ProductVariantAxis[]; sellingUnits: ProductSellingUnit[] }) => void;
}) {
  const { t } = useAppLanguage();
  const [valueDrafts, setValueDrafts] = useState<string[]>(["", ""]);
  const [bulkPrice, setBulkPrice] = useState("");
  // Which rows have their cost/MRP/reorder panel open. Kept per row rather than
  // one-at-a-time so two sizes can be compared without collapsing the first.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  // Saved rows already tagged with an axis position. Once any exist the axes are
  // append-only, because a row's variantValue1 is its value on axes[0] and
  // reordering would move every shirt's stock to the wrong cell.
  const persistedVariantRows = useMemo(
    () => baselineUnits.filter((unit) => unit.variantValue1 || unit.variantValue2),
    [baselineUnits],
  );
  const locked = !canReorderAxes(persistedVariantRows);

  const cells = useMemo(
    () => buildVariantCells(axes, sellingUnits, { price: fallbackPrice }),
    [axes, sellingUnits, fallbackPrice],
  );

  const dropped = useMemo(() => droppedVariantCells(axes, persistedVariantRows), [axes, persistedVariantRows]);
  const droppedWithStock = dropped.filter((row) => row.qty > 0);

  /** Push a new grid up as both axes and the selling units they describe. */
  function push(nextAxes: ProductVariantAxis[], nextCells?: VariantCell[]) {
    const built = nextCells ?? buildVariantCells(nextAxes, sellingUnits, { price: fallbackPrice });
    const packagingRows = sellingUnits.filter((unit) => !unit.variantValue1 && !unit.variantValue2);
    onChange({
      axes: nextAxes,
      // A grid replaces the packaging rows: a garment is sold by size, not by
      // pack, and leaving both would put a sizeless row on the shelf.
      sellingUnits: nextAxes.length > 0
        ? variantCellsToSellingUnits(built, { unitType, ...productDefaults })
        : packagingRows,
    });
  }

  function addAxis() {
    if (axes.length >= MAX_AXES) return;
    push([...axes, { name: AXIS_PRESETS[axes.length] ?? "Option", values: [] }]);
  }

  function renameAxis(index: number, name: string) {
    push(axes.map((axis, i) => (i === index ? { ...axis, name } : axis)));
  }

  function removeAxis(index: number) {
    push(axes.filter((_, i) => i !== index));
  }

  function addValue(index: number) {
    const draft = valueDrafts[index] ?? "";
    // One box, several values: a shop types "S, M, L" in one go far more often
    // than it adds them one at a time.
    const additions = draft.split(/[,\n]/).map((value) => value.trim()).filter(Boolean);
    if (additions.length === 0) return;
    push(axes.map((axis, i) => (
      i === index ? { ...axis, values: normalizeAxisValues([...axis.values, ...additions]) } : axis
    )));
    setValueDrafts((prev) => prev.map((value, i) => (i === index ? "" : value)));
  }

  function removeValue(axisIndex: number, value: string) {
    push(axes.map((axis, i) => (
      i === axisIndex ? { ...axis, values: axis.values.filter((entry) => entry !== value) } : axis
    )));
  }

  function patchCell(unitCode: string, patch: Partial<VariantCell>) {
    push(axes, cells.map((cell) => (cell.unitCode === unitCode ? { ...cell, ...patch } : cell)));
  }

  function applyBulkPrice() {
    const price = Number(bulkPrice);
    if (!(price >= 0)) return;
    push(axes, cells.map((cell) => ({ ...cell, price })));
    setBulkPrice("");
  }

  const totalQty = totalGridQty(cells);
  const emptyCells = cells.filter((cell) => cell.qty <= 0).length;

  if (axes.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-[#d8e2ef] bg-[#fbfcfe] p-3.5 text-center">
        <span className="mx-auto grid h-9 w-9 place-items-center rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]"><Grid3x3 size={17} /></span>
        <p className="mt-1.5 text-[12px] font-black text-[#13274d]">Sold in sizes or colours?</p>
        <p className="mx-auto mt-0.5 max-w-[300px] text-[10.5px] font-semibold leading-snug text-[#6d7c98]">
          Set up a grid instead of one product per size. Each size keeps its own stock, so you can see which one has run out.
        </p>
        <Button type="button" variant="outline" className="mt-2.5 h-8 gap-1.5 rounded-lg text-[11px] font-black" onClick={addAxis}>
          <Plus size={13} /> Add sizes or colours
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[12px] border border-[#e3eaf3] bg-[#fbfcfe] p-3" data-testid="variant-grid">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-black text-[#13274d]">Sizes &amp; colours</p>
          <p className="mt-0.5 text-[10.5px] font-semibold text-[#6d7c98]">
            {cells.length} combination{cells.length === 1 ? "" : "s"} · {totalQty} in stock
            {emptyCells > 0 && <span className="text-amber-700"> · {emptyCells} with none left</span>}
          </p>
        </div>
        {axes.length < MAX_AXES && (
          <button
            type="button"
            onClick={addAxis}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--brand-border)] bg-white px-2.5 text-[10.5px] font-black text-[var(--brand)] hover:bg-[var(--brand-softer)]"
          >
            <Plus size={12} /> Add {axes.length === 1 ? "colour" : "another"}
          </button>
        )}
      </div>

      {locked && (
        <p className="flex items-start gap-1.5 rounded-lg bg-[#f1f5fa] px-2.5 py-2 text-[10px] font-semibold leading-snug text-[#52627e]">
          <Lock size={11} className="mt-[1px] shrink-0" />
          This product already has stock against its grid, so the order of the axes is fixed. You can still add values — swapping them round would move each size's stock to the wrong row.
        </p>
      )}

      {/* ── The axes ── */}
      {axes.map((axis, index) => (
        <div key={index} className="rounded-lg border border-[#e3eaf3] bg-white p-2.5">
          <div className="flex items-center gap-2">
            <Input
              className="h-8 flex-1 text-[11.5px] font-bold"
              value={axis.name}
              placeholder={AXIS_PRESETS[index] ?? "Option"}
              onChange={(e) => renameAxis(index, e.target.value)}
              aria-label={`Name of option ${index + 1}`}
              list={`variant-axis-presets-${index}`}
            />
            <datalist id={`variant-axis-presets-${index}`}>
              {AXIS_PRESETS.map((preset) => <option key={preset} value={preset} />)}
            </datalist>
            <button
              type="button"
              onClick={() => removeAxis(index)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"
              aria-label={`Remove ${axis.name || `option ${index + 1}`}`}
            >
              <Trash2 size={13} />
            </button>
          </div>

          {axis.values.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {axis.values.map((value) => (
                <span key={value} className="inline-flex items-center gap-1 rounded-md bg-[#f1f5fa] py-1 pl-2 pr-1 text-[10.5px] font-bold text-[#344668]">
                  {value}
                  <button
                    type="button"
                    onClick={() => removeValue(index, value)}
                    className="grid h-4 w-4 place-items-center rounded text-[#8492ac] hover:bg-white hover:text-rose-600"
                    aria-label={`Remove ${value}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="mt-2 flex gap-1.5">
            <Input
              className="h-8 flex-1 text-[11.5px]"
              placeholder={index === 0 ? "S, M, L" : "Blue, White"}
              value={valueDrafts[index] ?? ""}
              onChange={(e) => setValueDrafts((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                // The form's submit is one Enter away, and losing a half-typed
                // grid to it would be maddening.
                e.preventDefault();
                addValue(index);
              }}
              aria-label={`Add values to ${axis.name || `option ${index + 1}`}`}
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 shrink-0 rounded-lg px-2.5 text-[10.5px] font-black"
              disabled={!(valueDrafts[index] ?? "").trim()}
              onClick={() => addValue(index)}
            >
              Add
            </Button>
          </div>
          <p className="mt-1 text-[9.5px] font-semibold text-[#9aa6bb]">Separate several with commas.</p>
        </div>
      ))}

      {/* ── What removing a value costs ── */}
      {droppedWithStock.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[10px] font-semibold leading-snug text-amber-900">
          <AlertTriangle size={11} className="mt-[1px] shrink-0" />
          {droppedWithStock.map((row) => `${row.name} (${row.qty})`).join(", ")} {droppedWithStock.length === 1 ? "is" : "are"} no longer in the grid.
          Saving stops counting {droppedWithStock.length === 1 ? "that stock" : "that stock"} — put the value back if you still hold it.
        </p>
      )}

      {/* ── The grid ── */}
      {cells.length > 0 && (
        <div className="rounded-lg border border-[#e3eaf3] bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#eef2f8] px-2.5 py-2">
            <p className="text-[10.5px] font-black text-[#13274d]">Price &amp; stock per combination</p>
            <div className="ml-auto flex items-center gap-1.5">
              <Input
                className="h-7 w-[86px] text-[11px]"
                type="number"
                min="0"
                step="0.01"
                placeholder="Set all"
                value={bulkPrice}
                onChange={(e) => setBulkPrice(e.target.value)}
                aria-label="Price for every combination"
              />
              <Button
                type="button"
                variant="outline"
                className="h-7 shrink-0 rounded-lg px-2 text-[10px] font-black"
                disabled={!bulkPrice.trim()}
                onClick={applyBulkPrice}
              >
                Apply
              </Button>
            </div>
          </div>

          <div className="max-h-[260px] overflow-y-auto">
            {cells.length >= MAX_CELLS && (
              <p className="border-b border-[#eef2f8] bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-900">
                Showing the first {MAX_CELLS} combinations. Split the product if you genuinely stock more.
              </p>
            )}
            {cells.map((cell) => {
              const open = openRows[cell.unitCode] ?? false;
              return (
              /* A grid, not flex-wrap. Four controls do not fit a 343 px panel,
                 and left to wrap they broke across three ragged lines with the
                 name sitting 11 px below the boxes beside it. Here the phone
                 gets the name on its own line and the three fields in even
                 columns under it; from `sm` up it is one aligned row.

                 The rarer per-size money lives behind the chevron rather than in
                 four more columns: seven boxes abreast is unreadable on a phone,
                 and a shop sets cost and reorder level far less often than it
                 sets price and count. */
              <div
                key={cell.unitCode}
                className={cn(
                  "border-b border-[#f2f5f9] last:border-b-0",
                  cell.qty <= 0 && "bg-[#fffaf5]",
                )}
              >
                <div className="grid grid-cols-3 items-center gap-2 px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_84px_72px_116px]">
                  <div className="col-span-3 flex min-w-0 items-center gap-1 sm:col-span-1">
                    <span className="truncate text-[11.5px] font-bold text-[#13274d]">{cell.name}</span>
                    <button
                      type="button"
                      onClick={() => setOpenRows((prev) => ({ ...prev, [cell.unitCode]: !open }))}
                      aria-expanded={open}
                      aria-label={`${t("products.form.variantDetails")} — ${cell.name}`}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded text-[#8492ac] hover:bg-[#eef3f9] hover:text-[var(--brand)]"
                    >
                      <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
                    </button>
                  </div>
                  <CellPrice
                    price={cell.price}
                    onChange={(price) => patchCell(cell.unitCode, { price })}
                    label={`Price for ${cell.name}`}
                  />
                  <CellQty
                    qty={cell.qty}
                    onChange={(qty) => patchCell(cell.unitCode, { qty })}
                    label={`Stock for ${cell.name}`}
                  />
                  <Input
                    className="h-8 w-full text-[11px]"
                    placeholder="Barcode"
                    value={cell.barcode ?? ""}
                    onChange={(e) => patchCell(cell.unitCode, { barcode: e.target.value || null })}
                    aria-label={`Barcode for ${cell.name}`}
                  />
                </div>

                {open && (
                  <div className="border-t border-dashed border-[#e6edf6] bg-[#f8fafd] px-2.5 py-2" data-testid={`variant-cell-details-${cell.unitCode}`}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <CellOptional
                        value={cell.mrp}
                        onChange={(mrp) => patchCell(cell.unitCode, { mrp })}
                        title={t("products.form.variantMrp")}
                        label={`${t("products.form.variantMrp")} — ${cell.name}`}
                        decimals={2}
                      />
                      <CellOptional
                        value={cell.costPrice}
                        onChange={(costPrice) => patchCell(cell.unitCode, { costPrice })}
                        title={t("products.form.variantCost")}
                        label={`${t("products.form.variantCost")} — ${cell.name}`}
                        decimals={2}
                      />
                      <CellOptional
                        value={cell.minimumPrice}
                        onChange={(minimumPrice) => patchCell(cell.unitCode, { minimumPrice })}
                        title={t("products.form.variantMinPrice")}
                        label={`${t("products.form.variantMinPrice")} — ${cell.name}`}
                        decimals={2}
                      />
                      <CellOptional
                        value={cell.lowStockThreshold}
                        onChange={(lowStockThreshold) => patchCell(cell.unitCode, { lowStockThreshold })}
                        title={t("products.form.variantLowStock")}
                        label={`${t("products.form.variantLowStock")} — ${cell.name}`}
                        decimals={3}
                      />
                      <CellOptional
                        value={cell.reorderLevel}
                        onChange={(reorderLevel) => patchCell(cell.unitCode, { reorderLevel })}
                        title={t("products.form.variantReorder")}
                        label={`${t("products.form.variantReorder")} — ${cell.name}`}
                        decimals={3}
                      />
                    </div>
                    <p className="mt-1.5 text-[9.5px] font-semibold leading-snug text-[#9aa6bb]">{t("products.form.variantInheritHint")}</p>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {cells.length === 0 && (
        <p className="rounded-lg bg-[#f1f5fa] px-2.5 py-2 text-[10.5px] font-semibold text-[#52627e]">
          Add some values above and the combinations will appear here.
        </p>
      )}
    </div>
  );
}

// A hook cannot run inside the cells.map callback, so each cell owns its draft.
//
// Both boxes take min 0 deliberately. A size priced at zero is unusual but
// legal, and a size with zero stock is the whole point of the grid — it is what
// the amber row and the "with none left" count are reporting. What must not
// happen is committing that zero on the keystroke that empties the box: the
// price would silently become free if the shop looked away mid-edit, and the
// row would flash out-of-stock while a new count was being typed.
function CellPrice({ price, onChange, label }: { price: number; onChange: (next: number) => void; label: string }) {
  const props = useMoneyDraft(price, onChange);
  return <Input className="h-8 w-full text-[11.5px]" type="number" inputMode="decimal" step="0.01" aria-label={label} {...props} />;
}

function CellQty({ qty, onChange, label }: { qty: number; onChange: (next: number) => void; label: string }) {
  const props = useQuantityDraft(qty, onChange, { min: 0 });
  return <Input className="h-8 w-full text-[11.5px]" type="number" inputMode="decimal" step="1" aria-label={label} {...props} />;
}

/**
 * A per-size box that is allowed to stay empty.
 *
 * `useMoneyDraft` and `useQuantityDraft` can only ever commit a number, so
 * neither can express "this size has no MRP of its own — use the product's".
 * That distinction is the whole point of these fields: null inherits, a typed
 * number overrides, and a typed 0 is neither (a free sample really is priced
 * zero). `emptyCommitsNull` is what carries clearing the box back up.
 */
function CellOptional({ value, onChange, title, label, decimals }: {
  value: number | null;
  onChange: (next: number | null) => void;
  title: string;
  label: string;
  decimals: number;
}) {
  const props = useNumericDraft(value, onChange, { min: 0, decimals, emptyCommitsNull: true });
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block truncate text-[9.5px] font-black uppercase tracking-wide text-[#8492ac]">{title}</span>
      <Input
        className="h-8 w-full text-[11px]"
        type="number"
        inputMode="decimal"
        step={decimals === 2 ? "0.01" : "1"}
        placeholder="—"
        aria-label={label}
        {...props}
      />
    </label>
  );
}
