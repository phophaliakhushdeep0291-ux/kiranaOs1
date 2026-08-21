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
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { translateCategory, useBusinessType } from "@/features/core/settings/business-types";
import { getShopWorkflow } from "@/features/core/settings/shop-workflows";
import { useFeature } from "@/features/core/subscription";
import { getLocalProductAliasSuggestions, splitProductAliases, uniqueProductAliases } from "@/features/core/products/product-reliability";
import { fetchGroqAliasSuggestions } from "../product-aliases";
import { baseUnitFor, isScaleUnit, sellingUnitCode, sellingUnitConversion, sellingUnitName, UNITS } from "../product-pricing";
import { roundMoney } from "@/lib/money";
import { useShopCapability } from "@/features/core/settings/capabilities";
import { PRODUCT_ATTRIBUTE_SECTION_TITLE } from "@/features/core/products/product-attributes";
import { ProductAttributesSection } from "./ProductAttributesSection";
import { VariantGridEditor } from "./VariantGridEditor";
import { VariantLocationSplit } from "./VariantLocationSplit";
import { convertPackagingMode, type ProductFormData } from "../product-form-state";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { generateInternalEan13 } from "@/lib/barcode/ean13";

const GST_RATES = [0, 5, 12, 18, 28];
const PACK_MEASURE_UNITS = ["piece", "tablet", "gram", "kg", "ml", "litre"];
/**
 * What a pack can be measured in, for this trade.
 *
 * Driven by the trade's own unit vocabulary, which is the honest source: a pack
 * of three shirts holds three pieces, a chemist's box holds tablets, a grocer's
 * packet holds grams. "piece" is always allowed because every pack can be
 * counted. Deliberately not keyed off loose selling — a stationer sells loose
 * pens by the piece and would have been offered kilograms.
 */
export function packMeasureUnitsFor(primaryUnits: string[]) {
  return PACK_MEASURE_UNITS.filter((unit) => unit === "piece" || primaryUnits.includes(unit));
}

/**
 * What a shop can tap to say how this product leaves the counter.
 *
 * Taken from the trade's own vocabulary rather than one fixed list, because
 * these chips write the SAME `unit` the picker above controls. A fixed list let
 * a shoe shop set "carton" while never offering "pair", and a chemist "pouch"
 * while never offering "strip" — the one unit each of them actually sells in.
 * Weight and volume are left out: those are how loose goods are measured, not
 * how a pack is counted. "piece" is always offered, because anything can be
 * sold singly.
 */
export function packSellingUnitsFor(primaryUnits: string[]) {
  const counted = primaryUnits.filter((unit) => !isScaleUnit(unit));
  return Array.from(new Set(counted.includes("piece") ? counted : [...counted, "piece"]));
}

/**
 * Units that name a container, and so hold a quantity worth asking about.
 *
 * A packet holds 500 g and a dozen holds 12; a piece holds nothing, and a pair
 * of shoes is the thing itself rather than a wrapper around two of something.
 * Only a unit on this list makes "one X contains…" a question with an answer.
 */
const CONTAINER_UNITS = [
  "packet", "pack", "pouch", "bottle", "box", "carton", "strip", "tube", "jar",
  "sachet", "case", "bundle", "dozen", "pallet", "roll", "bag", "tin", "can", "set",
];
function isContainerUnit(unit: string) {
  return CONTAINER_UNITS.includes(String(unit || "").trim().toLowerCase());
}

/**
 * Why a pack cannot go onto this product — or null when it can.
 *
 * Two rows a shopkeeper cannot tell apart are worse than a rejected one, and both
 * ways of creating that pair used to slip through:
 *
 *  - "size": the same physical pack under a different measure. `unitCode` carries
 *    the measure as typed, so "packet-1-kg" and "packet-1000-gram" are different
 *    strings for the identical packet. In per-pack mode that is two shelves for
 *    one pack: the stock splits in half and billing offers two identical lines.
 *    Compared within one unit type only — a BOX holding 1 kg and a PACKET holding
 *    1 kg really are different things to stock, and a shop may carry both.
 *
 *  - "barcode": one number naming more than one pack. The pack barcode box had no
 *    check at all, so the same code could sit on the 1 kg packet, the 5 kg bag and
 *    the product itself; a scan then resolves to whichever row is found first and
 *    rings up the wrong size at the wrong price.
 */
export function packClashReason(
  candidate: { unitType: string; unitCode: string; conversionToBase: number; barcode?: string | null },
  existing: Array<{ unitType?: string | null; unitCode?: string | null; conversionToBase?: number | null; barcode?: string | null }>,
  productBarcode?: string | null,
): "size" | "barcode" | null {
  const sameUnitType = (unitType: unknown) =>
    String(unitType ?? "").trim().toLowerCase() === candidate.unitType.trim().toLowerCase();
  const sameSize = (other: unknown) =>
    Number(other ?? 0) > 0 && Math.abs(Number(other) - candidate.conversionToBase) < 0.000_001;
  const clashes = existing.some((row) => row.unitCode === candidate.unitCode
    || (sameUnitType(row.unitType) && sameSize(row.conversionToBase)));
  if (clashes) return "size";

  const barcode = String(candidate.barcode ?? "").trim();
  if (!barcode) return null;
  const taken = barcode === String(productBarcode ?? "").trim()
    || existing.some((row) => String(row.barcode ?? "").trim() === barcode);
  return taken ? "barcode" : null;
}

/**
 * A blank "other pack size" row, in units this trade actually has.
 *
 * Never a fixed `500 gram`: the measure select only lists what the trade can
 * pack in, so a garment shop was shown a BLANK measure sitting on a hidden
 * "gram". Leaving it alone and typing a price built a pack whose conversion was
 * 500 grams against a product counted in pieces — one sale of it took 500 pieces
 * off the shelf.
 */
function emptyExtraPack(unitType: string, packSizeUnit: string) {
  return {
    unitType,
    // A counted pack starts at one of something; a measured one at the size a
    // grocer types most often.
    packSizeValue: packSizeUnit === "piece" ? "1" : "500",
    packSizeUnit,
    price: "",
    // Each pack carries its own ceiling. Without one, a bigger pack was priced
    // against the DEFAULT pack's MRP and every honest price was rejected at billing
    // ("exceeds the configured maximum"). Left blank, the product MRP is scaled to
    // this pack's size instead — see sellingUnitMaxPrice.
    mrp: "",
    // And its own buying price, for the same reason and with the same fallback:
    // profit on a bill line is rate minus THIS pack's cost, so a 500 g pack charged
    // the 1 kg product cost reports a loss on every sale — see sellingUnitCostPrice.
    costPrice: "",
    barcode: "",
    openingQty: "",
  };
}

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
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const keyboardInset = useKeyboardInset();
  const { businessType, def } = useBusinessType();
  const hasCapability = useShopCapability();
  const workflow = getShopWorkflow(businessType);
  const productEntry = workflow.productEntry;
  const batchFeature = useFeature("batch_expiry");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [extraPackOpen, setExtraPackOpen] = useState(false);
  const [extraPack, setExtraPack] = useState(() => emptyExtraPack("packet", "piece"));
  // The product measure the draft was last seeded from, so a later change to the
  // product's own pack can be inherited without overriding a deliberate choice.
  const seededMeasureRef = useRef<string | null>(null);
  const categories = def.categories.filter((c) => c !== "all");
  const imageUrl = form.watch("imageUrl");
  const description = form.watch("description") ?? "";
  const batchTracking = form.watch("batchTrackingEnabled");
  const isLoose = !!form.watch("isLooseItem");
  const selectedUnit = form.watch("unit");
  const sellsLoose = hasCapability("LOOSE_ITEMS");
  // Drug schedules belong to a trade that dispenses against a prescription, not
  // to one named "pharmacy" — the same rule every other control here follows.
  // Showing the selector to a kirana shop would invite classifying biscuits as
  // Schedule H; hiding it from a product already classified would strand one.
  const drugSchedule = form.watch("drugSchedule");
  const showDrugSchedule = hasCapability("PRESCRIPTION_TRACKING") || drugSchedule != null;
  const packMeasureUnits = packMeasureUnitsFor(def.primaryUnits);
  const packSellingUnits = packSellingUnitsFor(def.primaryUnits);
  // An existing loose product keeps its controls even where the trade has since
  // stopped selling loose, so nothing already saved becomes uneditable.
  const showLooseChoice = sellsLoose || isLoose;
  const showBatchTracking = hasCapability("BATCH_TRACKING") || !!batchTracking;
  // Weight and volume units belong to loose selling. Everything else stays on
  // offer, so a trade can still reach for "box" or "pair" when it needs to.
  const otherUnits = Array.from(new Set(UNITS)).filter(
    (unit) =>
      !def.primaryUnits.includes(unit) &&
      (showLooseChoice || !isScaleUnit(unit) || unit === selectedUnit),
  );
  const packSizeValue = Number(form.watch("packSizeValue") || 0);
  const packSizeUnit = form.watch("packSizeUnit");
  /**
   * Whether "one X contains…" is a question this shop can answer.
   *
   * A trade that converts packs into loose stock lives on it, and so does any
   * unit that names a container. A garment shop has neither: it was shown a
   * required "one piece contains 1 piece", which says nothing and refused to
   * save the moment the box was cleared. A pack already sized to something other
   * than one keeps the box on screen whatever the trade, so a conversion cannot
   * go on quietly multiplying stock behind a hidden field.
   */
  const showPackContent = !isLoose && (
    hasCapability("PACK_CONVERSION")
    || packMeasureUnits.length > 1
    || isContainerUnit(selectedUnit)
    || packSizeValue !== 1
  );
  const packBaseQuantity = sellingUnitConversion(packSizeValue, packSizeUnit);
  const packBaseUnit = baseUnitFor(packSizeUnit);
  const currentSellingUnitName = isLoose
    ? selectedUnit
    : sellingUnitName(selectedUnit, packSizeValue, packSizeUnit);
  const sellingUnits = form.watch("sellingUnits") ?? [];
  const packagingMode = form.watch("packagingMode") ?? "pooled";
  const variantAxes = form.watch("variantAxes") ?? [];
  // A garment sold by size has no separate pack rows: its selling units ARE the
  // size × colour cells, so the two editors must never both be writing them.
  const hasVariantGrid = variantAxes.length > 0;
  // The same sum formToInput saves as the product's stock, so the form shows the
  // number it is actually going to store.
  const variantGridStock = roundMoney(
    sellingUnits
      .filter((row) => row.variantValue1 || row.variantValue2)
      .reduce((sum, row) => sum + (Number(row.onHandQty) || 0), 0),
  );
  // Shown to any trade that sells the same thing in more than one size or
  // shade — clothing, footwear, cosmetics, furniture — and to a product that
  // already has a grid, so switching business type cannot strand one.
  const showVariantGrid = hasCapability("PRODUCT_VARIANTS") || hasVariantGrid;
  const alternateSellingUnits = sellingUnits.filter((row) => !row.isDefault && !row.variantValue1 && !row.variantValue2);
  const err = form.formState.errors;
  const productMrp = Number(form.watch("mrp") || 0);
  /**
   * The extra-pack row as it will actually be added.
   *
   * A select can only display a value it lists, so a unit or measure this trade
   * does not pack in would show an empty box while quietly keeping its old
   * value — which is how a 500 *gram* conversion got onto a product counted in
   * pieces. Correcting it here means what the shop reads is what gets saved,
   * including after the owner changes business type with the panel open.
   */
  const extraPackDraft = {
    ...extraPack,
    unitType: packSellingUnits.includes(extraPack.unitType)
      ? extraPack.unitType
      : (packSellingUnits[0] ?? "piece"),
    packSizeUnit: packMeasureUnits.includes(extraPack.packSizeUnit)
      ? extraPack.packSizeUnit
      : (packMeasureUnits[0] ?? "piece"),
  };

  /**
   * A product-level rupee figure read against ONE pack.
   *
   * Both the MRP ceiling and the buying price work this way: what the shopkeeper
   * typed for THIS size wins outright, and while that box is empty the product's
   * own figure — which describes the DEFAULT pack — is scaled to this pack's size.
   * The same arithmetic the counter applies (sellingUnitMaxPrice and
   * sellingUnitCostPrice), so what the form shows is what billing will use.
   */
  function packFigure(productFigure: number, conversionToBase: number, ownValue?: number | null): number {
    const own = Number(ownValue ?? 0);
    if (own > 0) return roundMoney(own);
    if (!(productFigure > 0)) return 0;
    const conversion = Number(conversionToBase || 0);
    if (!(packBaseQuantity > 0) || !(conversion > 0) || conversion === packBaseQuantity) return roundMoney(productFigure);
    return roundMoney((productFigure / packBaseQuantity) * conversion);
  }
  const packCeiling = (conversionToBase: number, ownMaximumPrice?: number | null) =>
    packFigure(productMrp, conversionToBase, ownMaximumPrice);
  const suggestedExtraPackMrp = packCeiling(
    sellingUnitConversion(Number(extraPackDraft.packSizeValue) || 0, extraPackDraft.packSizeUnit),
  );
  // The product's cost belongs to its DEFAULT pack, so a different size costs that
  // scaled by size — same rule, same arithmetic as the MRP ceiling above.
  const productCost = Number(form.watch("costPrice") || 0);
  const packCostFor = (conversionToBase: number, ownCostPrice?: number | null) =>
    packFigure(productCost, conversionToBase, ownCostPrice);
  const suggestedExtraPackCost = packCostFor(
    sellingUnitConversion(Number(extraPackDraft.packSizeValue) || 0, extraPackDraft.packSizeUnit),
  );

  useEffect(() => {
    if (!open) return;
    setExtraPackOpen(false);
    const selling = packSellingUnitsFor(def.primaryUnits);
    const measures = packMeasureUnitsFor(def.primaryUnits);
    // A second size is nearly always measured the way the product's own pack is
    // — a grocer adding to a 1 kg packet is thinking in grams, a chemist adding
    // to a strip is thinking in tablets.
    const productMeasure = form.getValues("packSizeUnit");
    seededMeasureRef.current = productMeasure;
    setExtraPack(emptyExtraPack(
      selling.includes("packet") ? "packet" : (selling[0] ?? "piece"),
      measures.includes(productMeasure) ? productMeasure : (measures[0] ?? "piece"),
    ));
  }, [editing?.id, open, def, form]);

  /**
   * Open the "add a pack" draft, re-inheriting the product's measure if it moved.
   *
   * The draft is seeded once, when the panel opens — at which point a new product
   * is still on the trade's default measure. Describing the product as 1 **kg**
   * afterwards left the draft on "piece", so "one packet contains 5" became a pack
   * that removes 5 grams rather than 5 kg, priced off the same wrong conversion.
   * Only re-seeded when the product's measure has actually changed since, so
   * picking gram for a run of small packs still sticks.
   */
  function toggleExtraPack() {
    setExtraPackOpen((value) => {
      if (value) return false;
      const productMeasure = form.getValues("packSizeUnit");
      if (productMeasure !== seededMeasureRef.current) {
        seededMeasureRef.current = productMeasure;
        if (packMeasureUnits.includes(productMeasure)) {
          setExtraPack((current) => ({ ...current, packSizeUnit: productMeasure }));
        }
      }
      return true;
    });
  }

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
    const size = Number(extraPackDraft.packSizeValue);
    const price = Number(extraPackDraft.price);
    const packMrp = Number(extraPackDraft.mrp);
    const packCost = Number(extraPackDraft.costPrice);
    if (!(size > 0) || !(price > 0)) {
      toast({
        title: t("products.form.packSizeRequired"),
        description: t("products.form.packDetailsHint"),
        variant: "destructive",
      });
      return;
    }
    // Caught here rather than at the counter: a pack saved above its ceiling is
    // simply unsellable, and the bill screen is a bad place to discover that.
    // With no MRP of its own the ceiling is the product MRP scaled to this size,
    // which is exactly what billing will enforce.
    const ceiling = packMrp > 0 ? packMrp : packCeiling(sellingUnitConversion(size, extraPackDraft.packSizeUnit));
    if (ceiling > 0 && price > ceiling + 0.005) {
      toast({
        title: `${t("products.form.packPriceAboveMrp")} (Rs ${ceiling.toLocaleString("en-IN")})`,
        description: t("products.form.packPriceAboveMrpHint"),
        variant: "destructive",
      });
      return;
    }
    const code = sellingUnitCode(extraPackDraft.unitType, size, extraPackDraft.packSizeUnit);
    const conversion = sellingUnitConversion(size, extraPackDraft.packSizeUnit);
    const packBarcode = extraPackDraft.barcode.trim();
    // The default pack is not in `sellingUnits` while the form is open — it is
    // synthesised from the main fields on save — so it has to be named here or a
    // shop could add a second row for the pack it is already selling.
    const clash = packClashReason(
      { unitType: extraPackDraft.unitType, unitCode: code, conversionToBase: conversion, barcode: packBarcode },
      [
        {
          unitType: selectedUnit,
          unitCode: sellingUnitCode(selectedUnit, packSizeValue, packSizeUnit),
          conversionToBase: packBaseQuantity,
          barcode: form.getValues("barcode"),
        },
        ...sellingUnits,
      ],
      form.getValues("barcode"),
    );
    if (clash === "size") {
      toast({ title: t("products.form.packAlreadyAdded"), description: t("products.form.chooseDifferentPack"), variant: "destructive" });
      return;
    }
    if (clash === "barcode") {
      toast({ title: t("products.form.packBarcodeTaken"), description: t("products.form.packBarcodeTakenHint"), variant: "destructive" });
      return;
    }
    form.setValue("sellingUnits", [
      ...sellingUnits,
      {
        name: sellingUnitName(extraPackDraft.unitType, size, extraPackDraft.packSizeUnit),
        unitType: extraPackDraft.unitType,
        unitCode: code,
        packSizeValue: size,
        packSizeUnit: extraPackDraft.packSizeUnit,
        conversionToBase: conversion,
        barcode: packBarcode || null,
        defaultPrice: price,
        minimumPrice: null,
        maximumPrice: packMrp > 0 ? packMrp : null,
        costPrice: packCost > 0 ? packCost : null,
        // The pack's own count is recorded whatever the mode. In per-pack it IS the
        // stock figure; in pooled it is also folded into the shared pool below (and
        // dropped from the payload by formToInput), so that turning "Count each
        // size" on afterwards still knows this is 4 bags rather than part of one
        // undifferentiated pile.
        onHandQty: Number(extraPackDraft.openingQty) || 0,
        lowStockThreshold: null,
        isDefault: false,
        isActive: true,
      },
    ], { shouldDirty: true, shouldValidate: true });

    // Pooled only: opening quantity is a stock-IN expressed in this pack, not a second
    // count for it. Every pack size draws on one base-unit pool, so "20 x 500 g packets"
    // is 10,000 g added to that pool. Storing it per pack instead would create a number
    // nothing decrements on sale, which drifts from the real stock the moment you sell one.
    const openingQty = packagingMode === "per_pack" ? 0 : Number(extraPackDraft.openingQty);
    if (openingQty > 0) {
      const packConversion = sellingUnitConversion(size, extraPackDraft.packSizeUnit);
      const addedInDefaultUnits = packBaseQuantity > 0
        ? (openingQty * packConversion) / packBaseQuantity
        : 0;
      if (addedInDefaultUnits > 0) {
        const current = Number(form.getValues("stockQuantity")) || 0;
        const next = Math.round((current + addedInDefaultUnits) * 1000) / 1000;
        form.setValue("stockQuantity", next, { shouldDirty: true, shouldValidate: true });
        toast({
          title: `Added ${openingQty} x ${sellingUnitName(extraPackDraft.unitType, size, extraPackDraft.packSizeUnit)}`,
          description: `Opening stock is now ${next} ${currentSellingUnitName}. All pack sizes share this one stock.`,
        });
      }
    }

    setExtraPack(emptyExtraPack(extraPackDraft.unitType, extraPackDraft.packSizeUnit));
    setExtraPackOpen(false);
  }

  /**
   * Flip "Stock counting" without changing what is on the shelf.
   *
   * The two modes keep the stock in different places, so the main Opening Stock box
   * has to be restated: pooled holds every size's goods, per-pack holds the default
   * pack's own count. Writing the mode alone left the old number in place, which
   * silently re-labelled 4 x 5 kg and 20 x 500 g as "40 x 1 kg" one way and threw
   * them away the other.
   */
  function switchPackagingMode(mode: "pooled" | "per_pack") {
    const next = convertPackagingMode(form.getValues(), mode);
    form.setValue("packagingMode", next.packagingMode, { shouldDirty: true, shouldValidate: true });
    form.setValue("stockQuantity", next.stockQuantity, { shouldDirty: true, shouldValidate: true });
  }

  function updatePackField(unitCode: string, field: "onHandQty" | "lowStockThreshold" | "maximumPrice" | "costPrice", raw: string) {
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

  // defaultPrice is required on a selling unit, so an emptied box means 0 here
  // rather than null (which would fail validation on save).
  function updatePackPrice(unitCode: string, raw: string) {
    const parsed = Number(raw);
    form.setValue(
      "sellingUnits",
      sellingUnits.map((row) =>
        row.unitCode === unitCode
          ? { ...row, defaultPrice: Number.isFinite(parsed) ? parsed : 0 }
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
      toast({ title: t("products.form.nameRequired"), description: t("products.alias.nameFirst"), variant: "destructive" });
      return;
    }
    setAiLoading(true);
    try {
      const s = await fetchGroqAliasSuggestions(name, form.getValues("category"), form.getValues("unit"));
      if (s.length === 0) {
        setAiSuggestions(getLocalProductAliasSuggestions(name, form.getValues("category")));
        toast({ title: t("products.alias.noneReturned"), description: "Showing local suggestions instead." });
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
      setImgError(t("products.form.imageTooLarge"));
      return;
    }
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      form.setValue("imageUrl", dataUrl, { shouldDirty: true });
      setImgError(null);
    } catch {
      setImgError(t("products.form.imageReadFailed"));
    }
  }

  // A product saved under another trade — or before the owner switched this
  // shop's type — carries a category no longer on the list. A select cannot
  // display a value it does not list, so it rendered an EMPTY box beside a
  // required star while still holding the old value. Listing it keeps the box
  // readable without silently rewriting what the shop chose.
  const currentCategory = form.watch("category");
  const categoryOptions = currentCategory && !categories.includes(currentCategory)
    ? [...categories, currentCategory]
    : categories;
  const CategoryField = (
    <Field label={t("products.col.category")} required>
      <Select value={currentCategory} onValueChange={(v) => form.setValue("category", v, { shouldDirty: true })}>
        <SelectTrigger className="h-10"><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent>
          {categoryOptions.map((c) => <SelectItem key={c} value={c} className="capitalize">{translateCategory(c, t)}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
  const UnitField = (
    <Field label={isLoose ? t("products.form.rateStockUnit") : t("products.form.soldAsTitle")} required>
      <Select value={form.watch("unit")} onValueChange={(v) => form.setValue("unit", v, { shouldDirty: true })}>
        <SelectTrigger className="h-10"><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent>
          {Array.from(new Set(def.primaryUnits)).map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          <div className="my-1 h-px bg-border" />
          {otherUnits.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );

  // The action row lives at the bottom of a 100dvh panel, and `dvh` does not
  // shrink for the on-screen keyboard — so on a phone the Save button ends up
  // underneath it the moment a field is focused. Chrome fixes this itself via
  // `interactive-widget=resizes-content` in the viewport meta, in which case the
  // inset reads 0 and nothing here applies. This is the iOS Safari path.
  return (
    <aside
      data-mobile-task-panel="product-form"
      style={keyboardInset > 0 ? { width, height: `calc(100dvh - ${keyboardInset}px)` } : { width }}
      className={`app-slide-panel fixed inset-y-0 right-0 top-0 z-[90] flex h-[100dvh] w-full max-w-[100vw] flex-col border-l-0 border-[#e6ecf4] bg-white shadow-none transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:z-[80] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] lg:border-l lg:shadow-[-12px_0_40px_rgba(15,23,42,0.10)] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog"
      aria-label={editing ? t("products.action.edit") : t("products.action.addNewProduct")}
      aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">
            {editing ? t("products.form.editTitle") : t("products.form.addTitle")}
          </h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">
            {editing ? t("products.form.editSubtitle") : t("products.form.addSubtitle")}
          </p>
        </div>
        <button onClick={() => onOpenChange(false)} className="grid h-11 w-11 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-[#f1f4f8]" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
        <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="mb-4 rounded-[12px] border border-[var(--brand-border)] bg-[var(--brand-softer)] p-3" data-testid="shop-product-entry-guide">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--brand)]">{t("products.form.optimizedFor", { trade: t(def.labelKey) })}</p>
            <p className="mt-1 text-[11.5px] font-semibold leading-5 text-[#52627e]">{t(productEntry.helper)}</p>
          </div>

          {/* Product type: Packed / Loose. Only a trade that actually sells by
              weight or measure is asked to choose — a clothing shop has no
              answer to "packed or loose?" and should not be made to give one.
              Still shown when an existing product is already loose, so a shop
              that changed its business type can still edit what it has. */}
          {showLooseChoice ? (
            <div className="mb-5 grid grid-cols-2 gap-2 rounded-[12px] border border-[#e6ecf4] bg-[#f7f9fc] p-1">
              <TypeButton active={!isLoose} icon={<Package size={16} />} label={t("products.form.packedItem")} onClick={() => form.setValue("isLooseItem", false, { shouldDirty: true })} />
              <TypeButton active={isLoose} icon={<Scale size={16} />} label={t("products.form.looseItem")} onClick={() => form.setValue("isLooseItem", true, { shouldDirty: true })} />
            </div>
          ) : null}

          {/* Basic Information */}
          <Section title={t("products.form.basicInfo")}>
            <Field label={t(productEntry.nameLabel)} required error={err.name?.message}>
              <Input className="h-10" placeholder={isLoose ? t(productEntry.looseNamePlaceholder) : t(productEntry.namePlaceholder)} {...form.register("name")} />
            </Field>

            {/* Category + Brand (brand hidden for loose) */}
            {isLoose ? (
              CategoryField
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {CategoryField}
                <Field label={t(productEntry.brandLabel)}>
                  <Input className="h-10" placeholder={t(productEntry.brandPlaceholder)} {...form.register("brand")} />
                </Field>
              </div>
            )}

            {/* SKU/Barcode + Unit (SKU hidden for loose) */}
            {isLoose ? (
              UnitField
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t(productEntry.identifierLabel)} error={err.barcode?.message}>
                  <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Input className="h-10 pr-9" placeholder={t(productEntry.identifierPlaceholder)} {...form.register("barcode")} />
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
                    <p className="text-[12px] font-black text-[#13274d]">{t("products.form.packSizeHint")}</p>
                    <p className="mt-0.5 text-[10.5px] font-semibold leading-relaxed text-[#6d7c98]">Example: a salt packet sold for Rs 28 contains 1 kg. Billing counts packets; inventory counts grams.</p>
                  </div>
                </div>

                <p className="mb-1.5 text-[11px] font-bold text-[#45577a]">{t("products.form.quickSellingUnit")}</p>
                <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
                  {packSellingUnits.map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => form.setValue("unit", unit, { shouldDirty: true, shouldValidate: true })}
                      className={`h-11 min-w-11 shrink-0 rounded-lg border px-2.5 text-[10.5px] font-extrabold capitalize transition-colors ${selectedUnit === unit ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[#dfe8f5] bg-white text-[#45577a] hover:border-[#a9c5ff]"}`}
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
                      placeholder={t("products.form.exactPackPlaceholder")}
                      {...form.register("packSizeValue")}
                    />
                    <Select value={packSizeUnit} onValueChange={(v) => form.setValue("packSizeUnit", v, { shouldDirty: true, shouldValidate: true })}>
                      <SelectTrigger data-testid="select-pack-measure" className="h-10 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {packMeasureUnits.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </Field>
                <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg border border-[#dce8fb] bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11.5px] font-black text-[#12346b]">Billing unit: {currentSellingUnitName}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-[#6d7c98]">1 {selectedUnit} removes {packBaseQuantity || 0} {packBaseUnit} from stock</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#e9fff0] px-2 py-1 text-[9.5px] font-black uppercase text-[#159447]">{t("products.form.exactPack")}</span>
                </div>
              </div>
            ) : null}

            <Field label={t("products.form.hsn")}>
              <Input className="h-10" placeholder={t("products.form.hsnPlaceholder")} {...form.register("hsn")} />
            </Field>
          </Section>

          {/* Aliases */}
          <Section title={t("products.form.aliasesTitle")}>
            <Field label={t("products.form.aliasesLabel")}>
              <Input className="h-10" placeholder={t("products.form.aliasesPlaceholder")} {...form.register("aliasesText")} />
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
              <p className="text-[11px] font-semibold text-[#6d7c98]">{suggestions.length > 0 ? t("products.alias.suggestions") : t("products.alias.generate")}</p>
              <button
                type="button"
                onClick={() => void askAi()}
                disabled={aiLoading}
                className="tap-target inline-flex items-center gap-1.5 rounded-full border border-[#d8c9ff] bg-[#f3ecff] px-2.5 py-1 text-[11px] font-extrabold text-[#7c3aed] transition-opacity hover:opacity-90 disabled:opacity-60"
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
          <Section title={t("products.form.pricing")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Not starred, because nothing rejects a product without them —
                  and a star a literal zero satisfies teaches the shop to ignore
                  every other star on the form. MRP earns a warning instead: zero
                  is not "no MRP", it is "no ceiling", and the counter will then
                  take any price at all. */}
              <Field label={t("products.form.mrp")}>
                <Input className="h-10" type="number" inputMode="decimal" step="0.01" placeholder="0.00" {...form.register("mrp")} />
                {!(productMrp > 0) ? (
                  <p className="mt-1 text-[10px] font-semibold leading-4 text-amber-700">{t("products.form.mrpZeroHint")}</p>
                ) : null}
              </Field>
              <Field label={t("products.form.costPrice")}>
                <Input className="h-10" type="number" inputMode="decimal" step="0.01" placeholder="0.00" {...form.register("costPrice")} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("products.form.sellingPrice")} required error={err.sellingPrice?.message}>
                <Input className="h-10" type="number" inputMode="decimal" step="0.01" placeholder="0.00" {...form.register("sellingPrice")} />
              </Field>
              <Field label={t("products.form.gstRate")}>
                <Select value={String(form.watch("gstRate") ?? 0)} onValueChange={(v) => form.setValue("gstRate", Number(v), { shouldDirty: true })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-[10px] border border-[#e6ecf4] bg-[#f8fafd] px-3 py-2 text-[12px]">
              <span className="font-semibold text-[#6d7c98]">{t("products.form.avgCost")}</span>
              <span className="font-black text-[#13274d]">₹{cost.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="font-semibold text-[#6d7c98]">{t("products.form.margin")}</span>
              <span className={`font-black ${margin < 0 ? "text-rose-600" : "text-emerald-600"}`}>{margin}%</span>
            </div>

            {showVariantGrid && !isLoose && (
              <VariantGridEditor
                axes={variantAxes}
                sellingUnits={sellingUnits}
                // What is actually saved against this product, which the live
                // form value stops being the moment anything is typed.
                baselineUnits={editing?.sellingUnits ?? []}
                fallbackPrice={Number(form.watch("sellingPrice") || 0)}
                unitType={selectedUnit}
                onChange={({ axes, sellingUnits: nextUnits }) => {
                  form.setValue("variantAxes", axes, { shouldDirty: true });
                  form.setValue("sellingUnits", nextUnits, { shouldDirty: true });
                  // A grid counts every row on its own — pooled sizes would all
                  // read one shared number and report availability that is untrue.
                  if (axes.length > 0) form.setValue("packagingMode", "per_pack", { shouldDirty: true });
                }}
              />
            )}

            {/* Only for a product that exists and already has a grid: a product
                being created has no stock anywhere yet, and the split is read from
                the server rather than from the unsaved form. */}
            {showVariantGrid && !isLoose && editing?.id && hasVariantGrid && (
              <VariantLocationSplit productId={editing.id} />
            )}

            {/* Pack sizes and a variant grid both write sellingUnits, so only one
                may be on screen. A shirt is sold by size, not by the 500 g pack. */}
            {!isLoose && !hasVariantGrid ? (
              <div className="rounded-[12px] border border-[#e3eaf3] bg-[#fbfcfe] p-3" data-testid="alternate-pack-sizes">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-black text-[#13274d]">{t("products.form.otherPackSizes")}</p>
                    <p className="mt-0.5 text-[10.5px] font-semibold text-[#6d7c98]">{t("products.form.otherPackSizesHint")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleExtraPack}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--brand-border)] bg-white px-2.5 text-[10.5px] font-black text-[var(--brand)] hover:bg-[var(--brand-softer)]"
                  >
                    {extraPackOpen ? <X size={12} /> : <Plus size={12} />}
                    {extraPackOpen ? "Close" : t("products.form.addSize")}
                  </button>
                </div>

                {/* How stock is counted across the sizes. Loose goods share one pool
                    (1 kg and a 5 kg bag come out of the same sack); sealed packs are
                    counted and reordered separately, which is the only way to answer
                    "which size do I need to order?". */}
                <div className="mt-3 rounded-lg border border-[#e3eaf3] bg-white p-2.5">
                  <p className="text-[10.5px] font-black text-[#13274d]">{t("products.form.stockCounting")}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {([
                      ["pooled", t("products.form.oneSharedStock"), t("products.form.oneSharedStockHint")],
                      ["per_pack", t("products.form.countEachSize"), t("products.form.countEachSizeHint")],
                    ] as const).map(([mode, title, hint]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => switchPackagingMode(mode)}
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
                    {alternateSellingUnits.map((row) => {
                      const ceiling = packCeiling(row.conversionToBase, row.maximumPrice);
                      const aboveCeiling = ceiling > 0 && Number(row.defaultPrice) > ceiling + 0.005;
                      const packCost = packCostFor(row.conversionToBase);
                      return (
                      <div key={row.id ?? row.unitCode} className="rounded-lg border border-[#e3eaf3] bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[11.5px] font-black text-[#13274d]">{row.name}</p>
                            <p className="mt-0.5 text-[10px] font-semibold text-[#6d7c98]">removes {row.conversionToBase} {baseUnitFor(row.packSizeUnit ?? packSizeUnit)} · {t("products.form.mrp")} {ceiling > 0 ? `Rs ${ceiling.toLocaleString("en-IN")}` : "—"}{row.maximumPrice == null && ceiling > 0 ? " (auto)" : ""}</p>
                          </div>
                          <button type="button" onClick={() => removeAlternatePack(row.unitCode)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-50" aria-label={`Remove ${row.name}`}><Trash2 size={13} /></button>
                        </div>
                        {/* Every size prices itself: its own rate and its own ceiling,
                            so a bigger pack is never measured against a smaller one. */}
                        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-[#eef2f7] pt-2">
                          <Field label={t("products.form.sellingPriceRs")}>
                            <Input
                              className="h-8"
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.defaultPrice ?? ""}
                              onChange={(event) => updatePackPrice(row.unitCode, event.target.value)}
                              placeholder="0.00"
                              aria-label={`${row.name} selling price`}
                            />
                          </Field>
                          {/* Blank is a real answer: it means "cost me the product cost
                              scaled to this size", which is what billing works out.
                              Short labels here: the card already names the pack, and
                              three wrapping headings left the inputs on three different
                              baselines. The add-pack form below keeps the full wording,
                              where the pack being described is not yet on screen. */}
                          <Field label={t("products.form.costPrice")}>
                            <Input
                              className="h-8"
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.costPrice ?? ""}
                              onChange={(event) => updatePackField(row.unitCode, "costPrice", event.target.value)}
                              placeholder={packCost > 0 ? String(packCost) : "0.00"}
                              aria-label={`${row.name} cost price`}
                            />
                          </Field>
                          <Field label={t("products.form.mrp")}>
                            <Input
                              className="h-8"
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.maximumPrice ?? ""}
                              onChange={(event) => updatePackField(row.unitCode, "maximumPrice", event.target.value)}
                              placeholder={ceiling > 0 ? String(ceiling) : "0.00"}
                              aria-label={`${row.name} MRP`}
                            />
                          </Field>
                        </div>
                        {aboveCeiling ? (
                          <p className="mt-1 text-[10px] font-bold text-rose-600">{t("products.form.packPriceAboveMrp")} ({`Rs ${ceiling.toLocaleString("en-IN")}`})</p>
                        ) : null}
                        {packagingMode === "per_pack" ? (
                          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[#eef2f7] pt-2">
                            <Field label={t("products.form.inStock")}>
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
                            <Field label={t("products.form.alertBelow")}>
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
                      );
                    })}
                  </div>
                ) : null}

                {extraPackOpen ? (
                  <div className="mt-3 space-y-2.5 rounded-[10px] border border-[var(--brand-border)] bg-white p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t("products.form.soldAs")} required>
                        <Select value={extraPackDraft.unitType} onValueChange={(value) => setExtraPack((current) => ({ ...current, unitType: value }))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>{packSellingUnits.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                      <Field label={t("products.form.sellingPriceRs")} required>
                        <Input className="h-9" type="number" min="0.01" step="0.01" value={extraPackDraft.price} onChange={(event) => setExtraPack((current) => ({ ...current, price: event.target.value }))} placeholder="0.00" />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={`One ${extraPackDraft.unitType} contains`} required>
                        <Input className="h-9" type="number" min="0.001" step="0.001" value={extraPackDraft.packSizeValue} onChange={(event) => setExtraPack((current) => ({ ...current, packSizeValue: event.target.value }))} placeholder="500" />
                      </Field>
                      <Field label={t("products.form.measure")} required>
                        <Select value={extraPackDraft.packSizeUnit} onValueChange={(value) => setExtraPack((current) => ({ ...current, packSizeUnit: value }))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>{packMeasureUnits.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t("products.form.packCost")}>
                        <Input
                          className="h-9"
                          type="number"
                          min="0"
                          step="0.01"
                          data-testid="input-extra-pack-cost"
                          value={extraPackDraft.costPrice}
                          onChange={(event) => setExtraPack((current) => ({ ...current, costPrice: event.target.value }))}
                          placeholder={suggestedExtraPackCost > 0 ? String(suggestedExtraPackCost) : "0.00"}
                        />
                      </Field>
                      <Field label={t("products.form.packMrp")}>
                        <Input
                          className="h-9"
                          type="number"
                          min="0"
                          step="0.01"
                          data-testid="input-extra-pack-mrp"
                          value={extraPackDraft.mrp}
                          onChange={(event) => setExtraPack((current) => ({ ...current, mrp: event.target.value }))}
                          placeholder={suggestedExtraPackMrp > 0 ? String(suggestedExtraPackMrp) : "0.00"}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t("products.form.openingQuantity")}>
                        <Input
                          className="h-9"
                          type="number"
                          min="0"
                          step="1"
                          data-testid="input-extra-pack-opening-qty"
                          value={extraPackDraft.openingQty}
                          onChange={(event) => setExtraPack((current) => ({ ...current, openingQty: event.target.value }))}
                          placeholder="0"
                        />
                      </Field>
                    </div>
                    <p className="text-[10px] font-semibold leading-4 text-[#6d7c98]">{t("products.form.packMrpHint")}</p>
                    <p className="text-[10px] font-semibold leading-4 text-[#6d7c98]">{t("products.form.packCostHint")}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t("products.form.packBarcode")}>
                        <Input className="h-9" value={extraPackDraft.barcode} onChange={(event) => setExtraPack((current) => ({ ...current, barcode: event.target.value }))} placeholder={t("products.form.packBarcodePlaceholder")} />
                      </Field>
                    </div>
                    <p className="text-[10px] font-semibold leading-4 text-[#6d7c98]">
                      How many of this pack you have now. It is added to the product's opening
                      stock — every pack size sells from that one stock.
                    </p>
                    <button type="button" onClick={addAlternatePack} className="h-9 w-full rounded-lg bg-[var(--brand)] text-[11.5px] font-black text-white hover:bg-[var(--brand-strong)]">{t("products.form.addPack")}</button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Section>

          {/* Stock & Inventory */}
          <Section title={t("products.form.stockInventory")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* With a size grid the product's stock IS the sum of its cells —
                  formToInput overwrites whatever is typed here. An editable box
                  that is thrown away on save is worse than no box, so the total
                  is shown instead, and the grid above stays the one place stock
                  is entered. */}
              {hasVariantGrid ? (
                <Field label={`Opening Stock (${currentSellingUnitName || selectedUnit})`}>
                  <div
                    data-testid="variant-grid-stock-total"
                    className="flex h-10 items-center rounded-md border border-[#e6ecf4] bg-[#f8fafd] px-3 text-[13px] font-black text-[#13274d]"
                  >
                    {variantGridStock}
                  </div>
                  <p className="mt-1 text-[10px] font-semibold leading-4 text-[#9aa6bb]">{t("products.form.gridStockHint")}</p>
                </Field>
              ) : (
                <Field label={`Opening Stock (${currentSellingUnitName || selectedUnit})`}>
                  <Input className="h-10" type="number" inputMode="decimal" placeholder="0" {...form.register("stockQuantity")} />
                </Field>
              )}
              <Field label={`Low Stock Alert (${selectedUnit})`}>
                <Input className="h-10" type="number" inputMode="decimal" placeholder="0" {...form.register("lowStockAlert")} />
              </Field>
              <Field label={t("products.form.reorderLevel")}>
                <Input className="h-10" type="number" inputMode="decimal" placeholder="0" {...form.register("reorderLevel")} />
              </Field>
            </div>
            {/* Dated stock is a real concern for a chemist, a grocer and a
                beauty counter, and none at all for a garment or a spare part.
                Kept visible when a product already tracks batches so existing
                stock stays editable. */}
            {showBatchTracking ? (
            <div className={`flex items-start justify-between gap-4 rounded-[12px] border p-3.5 ${productEntry.recommendBatchTracking ? "border-teal-200 bg-teal-50" : "border-[#e3eaf3] bg-[#f8fafc]"}`} data-testid="shop-batch-guidance">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12px] font-black text-[#13274d]">{t("products.form.batchExpiryTitle")}</p>
                  {productEntry.recommendBatchTracking && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-teal-700">Recommended</span>}
                </div>
                <p className="mt-1 text-[10.5px] font-semibold leading-4 text-[#65748f]">{t(productEntry.batchRecommendation)}</p>
                {!batchFeature.loading && !batchFeature.allowed && <p className="mt-1 text-[10.5px] font-bold text-amber-700">Available on {batchFeature.requiredPlan.name}.</p>}
              </div>
              <Switch
                checked={batchTracking}
                disabled={batchFeature.loading || !batchFeature.allowed}
                onCheckedChange={(checked) => form.setValue("batchTrackingEnabled", checked, { shouldDirty: true })}
                aria-label={t("products.form.batchExpiry")}
              />
            </div>
            ) : null}

            {/* Drug schedule. Only meaningful where the trade dispenses against
                a prescription, and only ever restrictive once set: leaving it
                "Not scheduled" is what every product already is, and what every
                non-medicine stays. */}
            {showDrugSchedule ? (
            <div className="mt-3 rounded-[12px] border border-[#e6ecf4] bg-white p-3">
              <p className="text-[12px] font-black text-[#13274d]">Drug schedule</p>
              <p className="mt-1 text-[10.5px] font-semibold leading-4 text-[#65748f]">
                Schedule H, H1 and X cannot be billed without a prescription. Setting this is what turns that check on for this medicine.
              </p>
              <select
                data-testid="product-drug-schedule"
                value={drugSchedule ?? ""}
                onChange={(event) => form.setValue("drugSchedule", (event.target.value || null) as ProductFormData["drugSchedule"], { shouldDirty: true })}
                aria-label="Drug schedule"
                className="mt-2 h-9 w-full rounded-md border border-[#e6ecf4] bg-white px-2 text-[12px] font-semibold text-[#13274d]"
              >
                <option value="">Not scheduled — sell freely</option>
                <option value="otc">Over the counter (OTC)</option>
                <option value="h">Schedule H — prescription required</option>
                <option value="h1">Schedule H1 — prescription required, 3-year register</option>
                <option value="x">Schedule X — prescription required</option>
              </select>
            </div>
            ) : null}
          </Section>

          {/* What this trade needs on a product and no other trade does — the
              chemist's salt, the garment shop's fabric, the parts shop's bin.
              Rendered from one catalogue keyed by business type, so switching
              shop type switches the whole section rather than hiding a fixed
              form. Sits after stock and before the image because it is reference
              detail: nothing above it depends on what is entered here. */}
          <Section title={PRODUCT_ATTRIBUTE_SECTION_TITLE[businessType]}>
            <ProductAttributesSection businessType={businessType} form={form} />
          </Section>

          {/* Product Image */}
          <Section title={t("products.form.productImage")}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="grid h-[84px] w-[84px] shrink-0 place-items-center overflow-hidden rounded-[12px] border border-[#e6ecf4] bg-[#f7f9fc]">
                {imageUrl ? <img src={imageUrl} alt={t("products.col.product")} className="h-full w-full object-contain" /> : <Upload size={20} className="text-[#9aa6bb]" />}
              </div>
              <button type="button" onClick={() => fileRef.current?.click()} className="flex h-[84px] flex-1 flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-[#cdd9ea] bg-[#fafbfe] text-center transition-colors hover:border-[var(--brand)]/50">
                <Upload size={18} className="text-[var(--brand)]" />
                <span className="text-[12px] font-bold text-[var(--brand)]">{imageUrl ? t("products.form.replaceImage") : t("products.form.uploadImage")}</span>
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
          <Section title={t("products.form.additionalInfo")}>
            <Field label={t(productEntry.notesLabel)}>
              <textarea
                {...form.register("description")}
                maxLength={250}
                rows={3}
                placeholder={t(productEntry.notesPlaceholder)}
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
              <input type="checkbox" aria-label={t("products.form.keepOpen")} checked={stayOpen} onChange={(e) => onStayOpenChange(e.target.checked)} className="h-4 w-4 rounded border-[#cdd9ea] accent-[var(--brand)]" />
              {t("products.form.keepOpen")}
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
              {isPending ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : editing ? t("products.form.update") : t("products.form.save")}
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
      className={`flex h-11 items-center justify-center gap-2 rounded-[9px] text-[13px] font-bold transition-all ${
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
    // The asterisk is aria-hidden decoration, so without this a screen reader is
    // told nothing about which fields the form will refuse to save empty.
    if (required) control.setAttribute("aria-required", "true");
    else control.removeAttribute("aria-required");
  }, [error, errorId, labelId, required]);

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
