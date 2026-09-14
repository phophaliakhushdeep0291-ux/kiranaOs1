const aliases = { g: "gram", gm: "gram", grams: "gram", kilogram: "kg", kilograms: "kg", l: "litre", ltr: "litre", liter: "litre", liters: "litre", litres: "litre", pcs: "piece", pc: "piece", pieces: "piece", pkt: "packet", packets: "packet" };
const measure = { gram: ["weight", 1], kg: ["weight", 1000], ml: ["volume", 1], litre: ["volume", 1000] };
const text = value => String(value ?? "").trim().toLowerCase();
const canonical = value => Object.hasOwn(aliases, text(value)) ? aliases[text(value)] : text(value);
const measurement = unit => Object.hasOwn(measure, unit) ? measure[unit] : undefined;

/** Resolve quantities and prices in the same unit the counter will sell. */
export function resolveBillLineUnit(product, requestedUnit, quantity) {
  const units = (product.sellingUnits ?? []).filter(unit => unit.isActive !== false);
  const requested = canonical(requestedUnit || (units.length === 1 ? units[0].name : product.rateUnit || product.baseUnit));
  const problem = reason => ({ resolved: false, reason, candidates: units.map(unit => unit.name).slice(0, 10) });
  if (!requested) return problem("unit_not_available");
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) return problem("invalid_quantity");
  let selected;
  let soldQuantity = quantity;
  if (units.length) {
    const exact = units.filter(unit => [unit.name, unit.unitCode].some(value => canonical(value) === requested));
    const matches = exact.length ? exact : units.filter(unit => canonical(unit.unitType) === requested);
    if (matches.length > 1) return problem("ambiguous_unit");
    selected = matches[0];
    if (!selected && product.packagingMode !== "per_pack" && measurement(requested)) {
      // Only loose measures are convertible. A packet's weight is not its sale unit.
      const loose = units.filter(unit => {
        const target = canonical(unit.unitType);
        return measurement(target)?.[0] === measure[requested][0]
          && (!(Number(unit.packSizeValue) > 0) || (Number(unit.packSizeValue) === 1 && canonical(unit.packSizeUnit) === target));
      });
      if (loose.length !== 1) return problem(loose.length ? "ambiguous_unit" : "unit_not_available");
      selected = loose[0];
      soldQuantity = quantity * measure[requested][1] / measure[canonical(selected.unitType)][1];
    }
    if (!selected || !selected.id || !Number.isFinite(Number(selected.conversionToBase)) || !(Number(selected.conversionToBase) > 0)) return problem("unit_not_available");
  } else {
    if (product.packagingMode === "per_pack") return problem("unit_not_available");
    const target = canonical(product.rateUnit || product.baseUnit);
    if (requested !== target) {
      if (!measurement(requested) || measure[requested][0] !== measurement(target)?.[0]) return problem("unit_not_available");
      soldQuantity = quantity * measure[requested][1] / measure[target][1];
    }
  }
  const rounded = Math.round(soldQuantity * 1000) / 1000;
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded > 1e9 || Math.abs(rounded - soldQuantity) > 1e-8) return problem("quantity_precision");
  const sourcePrice = selected ? selected.defaultPrice : product.defaultPricePerRateUnit;
  const rate = Number(sourcePrice);
  if (sourcePrice == null || !Number.isFinite(rate) || rate < 0) return problem("price_not_available");
  return {
    resolved: true,
    quantity: rounded,
    unit: selected?.name ?? (product.rateUnit || product.baseUnit),
    rate,
    ...(selected ? { sellingUnitId: selected.id, conversionToBase: Number(selected.conversionToBase) } : {}),
  };
}
