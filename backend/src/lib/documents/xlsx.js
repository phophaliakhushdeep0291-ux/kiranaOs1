import zlib from "node:zlib";

/**
 * Minimal, dependency-free .xlsx writer (§9 "Generate PDF and Excel reports").
 *
 * An .xlsx file is a ZIP container of SpreadsheetML parts. Rather than pull in a
 * spreadsheet library for what is fundamentally table-of-strings output, this
 * writes the handful of parts Excel/LibreOffice/Google Sheets require, using
 * only node:zlib. Values are written as inline strings or numbers, so there is
 * no shared-string table to maintain.
 *
 * Supported: multiple sheets, a bold header row, column widths, numbers vs text.
 * Not supported (deliberately): formulas, merged cells, charts, images.
 */

const CONTENT_TYPES_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * buildXlsx — render sheets to an .xlsx Buffer.
 *
 * @param {Array<{name?: string, columns?: Array<{key: string, label?: string, width?: number}>, rows: Array<object>}>} sheets
 * @returns {Buffer}
 */
export function buildXlsx(sheets) {
  const normalized = normalizeSheets(sheets);
  const files = [
    { name: "[Content_Types].xml", data: contentTypesXml(normalized.length) },
    { name: "_rels/.rels", data: rootRelsXml() },
    { name: "xl/workbook.xml", data: workbookXml(normalized) },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml(normalized.length) },
    { name: "xl/styles.xml", data: stylesXml() },
    ...normalized.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: sheetXml(sheet),
    })),
  ];
  return zipFiles(files);
}

function normalizeSheets(sheets) {
  const list = Array.isArray(sheets) ? sheets : [sheets];
  if (list.length === 0) return [{ name: "Sheet1", columns: [], rows: [] }];

  return list.map((sheet, index) => {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    // Infer columns from the data when the caller does not declare them, so a
    // plain array of row objects is enough to get a usable sheet.
    const columns = sheet?.columns?.length
      ? sheet.columns
      : [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))].map((key) => ({ key }));
    return {
      name: safeSheetName(sheet?.name, index),
      columns: columns.map((col) => ({ key: col.key, label: col.label ?? col.key, width: col.width })),
      rows,
    };
  });
}

/** Excel rejects these characters in a sheet name, and caps the name at 31 chars. */
function safeSheetName(name, index) {
  const fallback = `Sheet${index + 1}`;
  const raw = String(name ?? fallback).replace(/[\\/?*[\]:]/g, " ").trim();
  return (raw || fallback).slice(0, 31);
}

function contentTypesXml(sheetCount) {
  const overrides = Array.from({ length: sheetCount }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `${CONTENT_TYPES_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + `${overrides}</Types>`;
}

function rootRelsXml() {
  return `${CONTENT_TYPES_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + "</Relationships>";
}

function workbookXml(sheets) {
  const entries = sheets
    .map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return `${CONTENT_TYPES_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets>${entries}</sheets></workbook>`;
}

function workbookRelsXml(sheetCount) {
  const sheetRels = Array.from({ length: sheetCount }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("");
  // The styles part is numbered after the sheets so sheet ids stay 1..n.
  const stylesRel = `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  return `${CONTENT_TYPES_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `${sheetRels}${stylesRel}</Relationships>`;
}

/** Two cell formats: 0 = default, 1 = bold (used for the header row). */
function stylesXml() {
  return `${CONTENT_TYPES_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
    + '<borders count="1"><border/></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    + "</styleSheet>";
}

function sheetXml(sheet) {
  const { columns, rows } = sheet;
  const colsXml = columns.some((c) => c.width)
    ? `<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(c.width) || 14}" customWidth="1"/>`).join("")}</cols>`
    : "";

  const headerCells = columns
    .map((col, i) => cellXml(cellRef(i, 1), col.label, 1))
    .join("");
  const header = columns.length ? `<row r="1">${headerCells}</row>` : "";

  const bodyRows = rows
    .map((row, rowIndex) => {
      const cells = columns
        .map((col, colIndex) => cellXml(cellRef(colIndex, rowIndex + 2), row?.[col.key], 0))
        .join("");
      return `<row r="${rowIndex + 2}">${cells}</row>`;
    })
    .join("");

  return `${CONTENT_TYPES_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `${colsXml}<sheetData>${header}${bodyRows}</sheetData></worksheet>`;
}

function cellXml(ref, value, styleId) {
  const style = styleId ? ` s="${styleId}"` : "";
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${style}/>`;

  // Real numbers become numeric cells so Excel can sum them; everything else
  // (including ids that merely look numeric) stays text.
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function cellRef(colIndex, rowNumber) {
  let n = colIndex;
  let letters = "";
  while (n >= 0) {
    letters = String.fromCharCode((n % 26) + 65) + letters;
    n = Math.floor(n / 26) - 1;
  }
  return `${letters}${rowNumber}`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Control characters are illegal in XML 1.0 and make Excel refuse the file.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

// ─────────────────────────────────────────────
// Minimal ZIP container (deflate), enough for OOXML.
// ─────────────────────────────────────────────

function zipFiles(files) {
  const entries = [];
  const localParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const content = Buffer.from(file.data, "utf8");
    const compressed = zlib.deflateRawSync(content);
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01; fixed for reproducible output)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    localParts.push(local, nameBuf, compressed);
    entries.push({ nameBuf, crc, compressedSize: compressed.length, size: content.length, offset });
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralParts = [];
  let centralSize = 0;
  for (const entry of entries) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // method: deflate
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0x21, 14); // mod date
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.compressedSize, 20);
    central.writeUInt32LE(entry.size, 24);
    central.writeUInt16LE(entry.nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(entry.offset, 42);
    centralParts.push(central, entry.nameBuf);
    centralSize += central.length + entry.nameBuf.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, ...centralParts, end]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}
