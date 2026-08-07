#!/usr/bin/env python3
"""Verify kirana-starter-catalog.csv against KiranaOS's real import rules.

Rules mirrored from:
  frontend/src/features/core/products/import/product-import-csv.ts
      PRODUCT_IMPORT_COLUMNS, parseCsv (RFC-4180 + malformed-quote detection),
      detectProductImportSource (>=8 header matches => "kiranaos")
  frontend/src/features/core/products/pages/product-form-state.ts
      productFormSchema + superRefine
  frontend/src/features/core/products/pages/product-pricing.ts
      UNITS / UNIT_TO_BASE_UNIT
"""
import csv
import re
import sys

CSV = "kirana-starter-catalog.csv"

EXPECTED_HEADERS = ["Name","Category","Unit","SKU/Barcode","MRP","Cost Price","Selling Price",
                    "GST %","Opening Stock","Low Stock Alert","Reorder Level","HSN","Brand",
                    "Aliases","Description","Pack Size","Pack Unit","Loose Item","Active"]

UNITS = {"piece","dozen","set","pair","bundle","roll","sheet","kg","gram","litre","ml",
         "meter","yard","packet","pack","pouch","box","carton","bottle","jar","can","sachet",
         "strip","tablet","tube","plate","glass","custom"}
PACKET_UNITS = {"packet","pack","pouch"}

fails, warns = [], []


def fail(msg):
    fails.append(msg)


def warn(msg):
    warns.append(msg)


with open(CSV, encoding="utf-8-sig", newline="") as fh:
    rows = list(csv.DictReader(fh))
    fh.seek(0)
    raw = fh.read()

# 1. header contract -> importer must auto-detect this as a native KiranaOS file
with open(CSV, encoding="utf-8-sig", newline="") as fh:
    headers = next(csv.reader(fh))
if headers != EXPECTED_HEADERS:
    fail(f"header mismatch\n  got:  {headers}\n  want: {EXPECTED_HEADERS}")
matches = len(set(headers) & set(EXPECTED_HEADERS))
if matches < 8:
    fail(f"only {matches} header matches; importer would not detect source as 'kiranaos'")

# 2. faithful port of the app's parseCsv, including its two throw conditions.
#    Regexing for stray quotes gives false positives on legitimately quoted
#    fields that contain commas, so run the real state machine instead.
def app_parse_csv(text):
    grid, row, field, in_quotes = [], [], "", False
    source = text.replace("\r\n", "\n").replace("\r", "\n")
    i = 0
    while i < len(source):
        ch = source[i]
        if in_quotes:
            if ch == '"':
                if i + 1 < len(source) and source[i + 1] == '"':
                    field += '"'
                    i += 1
                else:
                    in_quotes = False
            else:
                field += ch
        elif ch == '"':
            if field:
                raise ValueError("A quoted value starts after unquoted text.")
            in_quotes = True
        elif ch == ",":
            row.append(field)
            field = ""
        elif ch == "\n":
            row.append(field)
            grid.append(row)
            row, field = [], ""
        else:
            field += ch
        i += 1
    if in_quotes:
        raise ValueError("The CSV contains an unclosed quoted value.")
    if field or row:
        row.append(field)
        grid.append(row)
    return grid


try:
    grid = [r for r in app_parse_csv(raw) if any(c.strip() for c in r)]
    if len(grid) - 1 != len(rows):
        fail(f"app parser sees {len(grid) - 1} data rows, csv module sees {len(rows)}")
    widths = {len(r) for r in grid}
    if widths != {len(EXPECTED_HEADERS)}:
        fail(f"ragged rows: column counts seen = {sorted(widths)}")
except ValueError as exc:
    fail(f"app parser would throw: {exc}")

# 3. per-row schema checks
names = set()
for i, r in enumerate(rows, start=2):
    where = f"row {i} ({r['Name']!r})"

    if not r["Name"].strip():
        fail(f"{where}: name required")
    key = r["Name"].strip().lower()
    if key in names:
        fail(f"{where}: duplicate name")
    names.add(key)

    if not r["Category"].strip():
        fail(f"{where}: category must be non-empty (schema: min(1))")

    unit = r["Unit"].strip().lower()
    pack_unit = r["Pack Unit"].strip().lower()
    if unit not in UNITS:
        fail(f"{where}: unit {unit!r} not in KiranaOS UNITS")
    if pack_unit not in UNITS:
        fail(f"{where}: pack unit {pack_unit!r} not in KiranaOS UNITS")

    try:
        pack_value = float(r["Pack Size"])
    except ValueError:
        fail(f"{where}: pack size not numeric")
        pack_value = 0
    if pack_value <= 0:
        fail(f"{where}: pack size must be > 0 (schema: positive)")

    loose = r["Loose Item"].strip().lower()
    if loose not in {"yes", "no"}:
        fail(f"{where}: loose item must be yes/no")

    # superRefine: a non-loose packet/pack/pouch must declare what one contains
    if loose == "no" and unit in PACKET_UNITS and not (pack_value > 0 and pack_unit):
        fail(f"{where}: packet unit without pack size -> superRefine rejects")

    # loose goods must be sold in a unit a weighing scale produces
    if loose == "yes" and unit not in {"kg", "gram", "litre", "ml"}:
        fail(f"{where}: loose item sold in {unit!r}, not a scale unit")

    sell = float(r["Selling Price"])
    cost = float(r["Cost Price"])
    mrp = float(r["MRP"])
    gst = float(r["GST %"])
    if sell <= 0:
        fail(f"{where}: selling price must be positive (schema: positive)")
    if cost < 0 or mrp < 0:
        fail(f"{where}: cost/mrp must be >= 0")
    if not (0 <= gst <= 100):
        fail(f"{where}: gst {gst} outside 0..100")
    if gst not in {0, 5, 18, 40}:
        fail(f"{where}: gst {gst} is not a GST 2.0 slab (0/5/18/40)")
    if cost >= sell:
        fail(f"{where}: cost {cost} >= selling {sell} — shop would lose money")
    if sell > mrp and mrp > 0:
        fail(f"{where}: selling {sell} above MRP {mrp} — illegal")

    for numeric in ("Opening Stock", "Low Stock Alert", "Reorder Level"):
        if float(r[numeric]) < 0:
            fail(f"{where}: {numeric} negative")

    if len(r["Description"]) > 500:
        fail(f"{where}: description over 500 chars")

    if r["SKU/Barcode"].strip():
        fail(f"{where}: barcode must stay blank — real EANs cannot be invented")

    if not r["Aliases"].strip():
        fail(f"{where}: no search aliases — shopkeeper cannot find it while billing")
    if not any("ऀ" <= c <= "ॿ" for c in r["Aliases"]):
        warn(f"{where}: no Devanagari alias")

    if not r["HSN"].strip().isdigit():
        fail(f"{where}: HSN {r['HSN']!r} not numeric")

print(f"checked {len(rows)} rows, {len(headers)} columns")
for w in warns:
    print("WARN:", w)
for f in fails:
    print("FAIL:", f)
print()
if fails:
    print(f"RESULT: FAILED ({len(fails)} errors, {len(warns)} warnings)")
    sys.exit(1)
print(f"RESULT: PASSED ({len(warns)} warnings)")
