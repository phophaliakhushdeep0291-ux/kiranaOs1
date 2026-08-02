import assert from "node:assert/strict";
import zlib from "node:zlib";
import { buildXlsx } from "../src/lib/documents/xlsx.js";
import { buildPdf } from "../src/lib/documents/pdf.js";
import {
  exportFormatFor,
  buildExportFileName,
  buildExportStorageKey,
  buildExportFilePath,
} from "../src/lib/fileStorage.js";
import { REPORT_EXPORT_TYPES } from "../src/modules/reports/reportExport.service.js";
import { exportReportSchema } from "../src/modules/reports/reports.schema.js";

// Proves §9's "Generate PDF and Excel reports automatically": both writers emit
// structurally valid files (a parseable ZIP for .xlsx, a correct xref table for
// .pdf) and the storage layer routes each report type to the right extension and
// MIME type instead of labelling everything text/csv.

// ── XLSX ─────────────────────────────────────────────────────
{
  const buf = buildXlsx([
    {
      name: "Outstanding",
      columns: [
        { key: "name", label: "Customer", width: 24 },
        { key: "amount", label: "Outstanding", width: 14 },
      ],
      rows: [
        { name: "Ramesh & Sons <Kirana>", amount: 1250.5 },
        { name: "Sunita", amount: 340 },
      ],
    },
    { name: "Ledger", rows: [{ entry: "opening", value: 10 }] },
  ]);

  assert.ok(Buffer.isBuffer(buf), "xlsx builder returns a Buffer");
  assert.equal(buf.subarray(0, 2).toString(), "PK", "xlsx is a ZIP container");

  const parts = readZip(buf);
  for (const required of [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
  ]) {
    assert.ok(parts.has(required), `xlsx must contain ${required}`);
  }

  const sheet = parts.get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /<t xml:space="preserve">Customer<\/t>/, "header labels are written");
  assert.match(sheet, /Ramesh &amp; Sons &lt;Kirana&gt;/, "XML special characters are escaped");
  assert.match(sheet, /<c r="B2"><v>1250\.5<\/v><\/c>/, "numbers are numeric cells, not text");
  assert.match(sheet, /<c r="A1" s="1"/, "header row uses the bold style");

  // Sheet names must survive Excel's naming rules.
  const workbook = parts.get("xl/workbook.xml");
  assert.match(workbook, /name="Outstanding"/, "sheet name is preserved");
  const longName = buildXlsx([{ name: "a/b:c*?[]".padEnd(60, "x"), rows: [{ a: 1 }] }]);
  const wb2 = readZip(longName).get("xl/workbook.xml");
  const nameMatch = wb2.match(/name="([^"]*)"/)[1];
  assert.ok(nameMatch.length <= 31, "sheet name is capped at 31 characters");
  assert.ok(!/[\\/?*[\]:]/.test(nameMatch), "illegal sheet-name characters are stripped");

  // Rows alone (no declared columns) still produce a usable sheet.
  const inferred = readZip(buildXlsx([{ rows: [{ x: 1, y: "two" }] }])).get("xl/worksheets/sheet1.xml");
  assert.match(inferred, /<t xml:space="preserve">x<\/t>/, "columns are inferred from row keys");
}

// ── PDF ──────────────────────────────────────────────────────
{
  const pdf = buildPdf({
    title: "GST Summary Report",
    subtitle: "Test Shop",
    meta: [{ label: "GSTIN", value: "27AAAAA0000A1Z5" }],
    sections: [
      {
        heading: "Tax summary",
        columns: [
          { key: "label", label: "Particulars", width: 300 },
          { key: "value", label: "Amount", align: "right" },
        ],
        // Enough rows to force pagination, which is where a hand-written PDF
        // most easily breaks (offsets, repeated headers, page tree count).
        rows: Array.from({ length: 120 }, (_, i) => ({ label: `Line ${i}`, value: `₹${i}.00` })),
      },
    ],
    footer: "Artha POS",
  });

  assert.ok(Buffer.isBuffer(pdf), "pdf builder returns a Buffer");
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"), "has a PDF header");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "has an EOF marker");

  // The xref table must point at real object headers or readers reject the file.
  const startxref = Number(text.slice(text.lastIndexOf("startxref") + 9).trim().split(/\s/)[0]);
  assert.equal(text.substr(startxref, 4), "xref", "startxref points at the xref table");
  const xrefLines = text.slice(startxref).split("\n");
  const declared = Number(xrefLines[1].split(" ")[1]);
  for (let i = 1; i < declared; i += 1) {
    const offset = Number(xrefLines[2 + i].slice(0, 10));
    assert.ok(
      text.substr(offset, 12).startsWith(`${i} 0 obj`),
      `xref offset for object ${i} must point at its header`,
    );
  }

  const pageCount = Number(text.match(/\/Count (\d+)/)[1]);
  assert.ok(pageCount > 1, `120 rows must paginate (got ${pageCount} page(s))`);
  assert.equal(
    (text.match(/\/Type \/Page[^s]/g) || []).length,
    pageCount,
    "page objects match the declared page count",
  );

  // WinAnsi has no rupee glyph — it must be transliterated, not emitted raw.
  assert.ok(!text.includes("₹"), "rupee sign is transliterated for WinAnsi");
  assert.ok(text.includes("Rs."), "rupee sign becomes Rs.");
  // Unbalanced parentheses would terminate a PDF string early and corrupt the file.
  const escaped = buildPdf({ title: "Bad ) title ( here \\ x", sections: [] }).toString("latin1");
  assert.ok(escaped.includes("Bad \\) title \\( here"), "parentheses and backslashes are escaped");
}

// ── Storage routing ──────────────────────────────────────────
{
  assert.equal(exportFormatFor("bills_csv").extension, "csv");
  assert.equal(exportFormatFor("gst_summary_pdf").extension, "pdf");
  assert.equal(exportFormatFor("gst_summary_pdf").mimeType, "application/pdf");
  assert.equal(exportFormatFor("customer_outstanding_xlsx").extension, "xlsx");
  assert.match(exportFormatFor("customer_outstanding_xlsx").mimeType, /spreadsheetml\.sheet$/);
  assert.equal(exportFormatFor("gst_summary_pdf").binary, true, "pdf must not be stringified");
  assert.equal(exportFormatFor("bills_csv").binary, false);

  assert.equal(buildExportFileName("gst_summary_pdf", "job1"), "gst_summary_pdf-job1.pdf");
  assert.equal(buildExportFileName("bills_csv", "job1"), "bills_csv-job1.csv");
  assert.match(buildExportStorageKey({ shopId: "s1", jobId: "j1", reportType: "customer_outstanding_xlsx" }), /\.xlsx$/);
  assert.equal(buildExportFilePath({ shopId: "s1", jobId: "j1", reportType: "gst_summary_pdf" }).mimeType, "application/pdf");

  // Path traversal and unknown types stay blocked for the new formats too.
  assert.throws(() => buildExportStorageKey({ shopId: "../etc", jobId: "j1", reportType: "gst_summary_pdf" }), /unsafe/i);
  assert.throws(() => exportFormatFor("evil_exe"), /Unsupported report export type/);

  // Every registered type must be accepted by the request schema and resolvable
  // by storage — the two lists drifting is what silently breaks a new export.
  for (const type of REPORT_EXPORT_TYPES) {
    assert.ok(exportReportSchema.safeParse({ reportType: type }).success, `${type} must be requestable`);
    assert.ok(exportFormatFor(type).extension, `${type} must resolve a format`);
  }
  assert.equal(exportReportSchema.safeParse({ reportType: "not_a_report" }).success, false, "unknown types rejected");
}

console.log("report-documents.examples.js OK");

/** Read a ZIP produced by the xlsx writer back into {name: text}. */
function readZip(buf) {
  const parts = new Map();
  let offset = 0;
  while (offset < buf.length - 4 && buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLength = buf.readUInt16LE(offset + 26);
    const extraLength = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    parts.set(name, method === 8 ? zlib.inflateRawSync(data).toString("utf8") : data.toString("utf8"));
    offset = dataStart + compressedSize;
  }
  assert.ok(parts.size > 0, "zip must contain at least one entry");
  return parts;
}
