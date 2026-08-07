# Kirana Starter Catalog

560 common Indian kirana products, ready to import into a brand-new shop so the
shopkeeper never sees an empty product list on day one.

| File | What it is |
|---|---|
| `kirana-starter-catalog.csv` | The catalog. Import this. |
| `build_catalog.py` | Generates the CSV from the curated source data. Edit here, not in the CSV. |
| `verify_catalog.py` | Checks the CSV against KiranaOS's real import rules. Run before shipping any change. |

## How to load it into a shop

Products → Import → pick `kirana-starter-catalog.csv`.

The header row matches `PRODUCT_IMPORT_COLUMNS` exactly, so the importer
auto-detects it as a native KiranaOS file and every column maps without manual
work. No code change is needed.

After import, the shopkeeper only has to do two things:

1. Delete the categories he doesn't stock (bulk select in Products).
2. Correct prices for what he does stock.

That is a ~2 hour job instead of a ~2 day job.

## What's inside

- **560 products, 40 categories** — atta, rice, dal, oil, ghee, dairy, tea,
  biscuits, namkeen, spices, instant food, soft drinks, dry fruits, soap, hair
  care, oral care, detergent, cleaning, pooja items, baby care, stationery,
  electrical, and more.
- **48 loose (weighed) items** priced per kg — loose dal, loose spices, loose
  dry fruits, loose atta — set up with `Loose Item = yes` and a scale unit.
- **Hindi + Hinglish search aliases on every row.** This is the part that makes
  billing fast: typing `आटा`, `atta`, `namak` or `sabun` finds the item.
  558 rows carry Devanagari, all 560 carry Hinglish.
- **HSN codes** per product family.
- **GST 2.0 slabs** (0 / 5 / 18 / 40), the structure effective 22 Sep 2025.
  Mix: 115 items at 0%, 408 at 5%, 19 at 18%, 18 at 40%.
- **Pack size and unit** on every row, using KiranaOS's own unit vocabulary
  (`packet`, `pack`, `bottle`, `piece`, `kg`, `gram`, `ml`, `litre`).

## Three things you must know before trusting it

**1. Barcodes are deliberately blank.** Real EAN-13 codes for specific SKUs
cannot be invented — a wrong barcode silently adds the wrong item to a bill,
which is a money bug, not a cosmetic one. The right design is capture-on-first-
scan: the shop scans a packet once and the code binds to that row. That feature
is worth building next; this file is shaped to receive it.

**2. Prices are starting values, not facts.** MRP varies by state, pack and
month. Selling price is set to MRP; cost is derived from a typical category
margin (6% on staples up to 18% on loose spices). They exist so the shop isn't
staring at zeros. **They must be corrected during setup.**

**3. GST rates need your accountant's sign-off.** The slabs follow the GST 2.0
restructure, but classification at the individual-product level is a judgement
call. Verify before anyone files a return on these numbers.

The durable, genuinely valuable part of this file is the **names, aliases,
categories, pack sizes, units and HSN codes**. Those don't go stale.

## Changing it

Edit the `ITEMS` dictionary in `build_catalog.py`, then:

```bash
cd catalog
python3 build_catalog.py
python3 verify_catalog.py
```

`verify_catalog.py` mirrors the app's actual rules — the RFC-4180 parser in
`product-import-csv.ts` (both of its throw conditions), the unit vocabulary in
`product-pricing.ts`, and `productFormSchema` including its `superRefine` pack-size
requirement. It also blocks commercial mistakes: cost ≥ selling price, selling
price above MRP, a GST rate that isn't a real slab, a loose item sold in a
non-scale unit, a product with no search alias, or a barcode that crept in.

It caught two real bugs while this catalog was being built: `g` converts
correctly but is not in the `UNITS` array the product form offers (the canonical
spelling is `gram`), and `l`/`m` are not units KiranaOS knows at all. Run it.

## The obvious next step

Ship this as a **built-in**, not a file someone has to find. On first run, after
the shop picks "Kirana", offer: *"Load 560 common kirana items? You can delete
what you don't sell."* One tap. That is the difference between a shopkeeper
finishing setup and abandoning it.
