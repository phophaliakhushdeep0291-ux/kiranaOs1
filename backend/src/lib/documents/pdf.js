/**
 * Minimal, dependency-free PDF writer (§9 "Generate PDF and Excel reports").
 *
 * Produces a paginated, tabular report using the PDF base-14 Helvetica fonts, so
 * no font file has to be embedded and no rendering library is required. This is
 * deliberately scoped to what a POS report needs: a title block, key/value
 * summary lines, and tables that break across pages with repeated headers.
 *
 * Encoding note: PDF base-14 fonts use WinAnsi, which has no rupee sign, so "₹"
 * is transliterated to "Rs." rather than silently rendering as garbage.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait, in points
const MARGIN = { top: 56, right: 40, bottom: 48, left: 40 };
const FONT_SIZE = { title: 16, subtitle: 9.5, heading: 10, body: 9 };
const LINE_HEIGHT = 13;

/**
 * buildPdf — render a report definition to a PDF Buffer.
 *
 * @param {{
 *   title: string,
 *   subtitle?: string,
 *   meta?: Array<{label: string, value: string}>,
 *   sections?: Array<{
 *     heading?: string,
 *     columns?: Array<{key: string, label?: string, width?: number, align?: "left"|"right"}>,
 *     rows?: Array<object>,
 *     lines?: Array<string>,
 *   }>,
 *   footer?: string,
 * }} doc
 * @returns {Buffer}
 */
export function buildPdf(doc) {
  const pages = layoutPages(doc ?? {});
  return serializePdf(pages, doc?.footer ?? null);
}

// ─────────────────────────────────────────────
// Layout — turn the report definition into positioned text runs per page.
// ─────────────────────────────────────────────

function layoutPages(doc) {
  const contentWidth = PAGE.width - MARGIN.left - MARGIN.right;
  const pages = [];
  let current = { runs: [] };
  let y = PAGE.height - MARGIN.top;

  const newPage = () => {
    pages.push(current);
    current = { runs: [] };
    y = PAGE.height - MARGIN.top;
  };
  const ensureRoom = (needed) => {
    if (y - needed < MARGIN.bottom) newPage();
  };
  const write = (text, x, size, bold) => {
    current.runs.push({ text: sanitize(text), x, y, size, bold });
  };

  // Title block
  write(doc.title ?? "Report", MARGIN.left, FONT_SIZE.title, true);
  y -= LINE_HEIGHT + 6;
  if (doc.subtitle) {
    write(doc.subtitle, MARGIN.left, FONT_SIZE.subtitle, false);
    y -= LINE_HEIGHT;
  }

  // Meta lines (generated at, period, shop, …)
  for (const item of doc.meta ?? []) {
    ensureRoom(LINE_HEIGHT);
    write(`${item.label}: ${item.value}`, MARGIN.left, FONT_SIZE.body, false);
    y -= LINE_HEIGHT;
  }
  y -= 6;

  for (const section of doc.sections ?? []) {
    if (section.heading) {
      ensureRoom(LINE_HEIGHT * 2);
      y -= 4;
      write(section.heading, MARGIN.left, FONT_SIZE.heading, true);
      y -= LINE_HEIGHT + 2;
    }

    for (const line of section.lines ?? []) {
      ensureRoom(LINE_HEIGHT);
      write(line, MARGIN.left, FONT_SIZE.body, false);
      y -= LINE_HEIGHT;
    }

    const columns = section.columns ?? [];
    const rows = section.rows ?? [];
    if (columns.length === 0 || rows.length === 0) {
      if (columns.length > 0 && rows.length === 0) {
        ensureRoom(LINE_HEIGHT);
        write("No rows for this period.", MARGIN.left, FONT_SIZE.body, false);
        y -= LINE_HEIGHT;
      }
      continue;
    }

    const widths = resolveColumnWidths(columns, contentWidth);
    const drawHeader = () => {
      let x = MARGIN.left;
      columns.forEach((col, i) => {
        const label = col.label ?? col.key;
        write(alignText(label, widths[i], col.align, FONT_SIZE.body, true), x, FONT_SIZE.body, true);
        x += widths[i];
      });
      y -= LINE_HEIGHT;
    };

    ensureRoom(LINE_HEIGHT * 2);
    drawHeader();

    for (const row of rows) {
      if (y - LINE_HEIGHT < MARGIN.bottom) {
        newPage();
        drawHeader(); // repeat the header on every page a table spans
      }
      let x = MARGIN.left;
      columns.forEach((col, i) => {
        const raw = formatCell(row?.[col.key]);
        const clipped = clipToWidth(raw, widths[i] - 4, FONT_SIZE.body);
        write(alignText(clipped, widths[i], col.align, FONT_SIZE.body, false), x, FONT_SIZE.body, false);
        x += widths[i];
      });
      y -= LINE_HEIGHT;
    }
    y -= 4;
  }

  pages.push(current);
  return pages;
}

function resolveColumnWidths(columns, contentWidth) {
  const declared = columns.map((c) => (Number.isFinite(c.width) ? Number(c.width) : null));
  const declaredTotal = declared.reduce((sum, w) => sum + (w ?? 0), 0);
  const undeclaredCount = declared.filter((w) => w === null).length;
  const remaining = Math.max(contentWidth - declaredTotal, 0);
  const perUndeclared = undeclaredCount > 0 ? remaining / undeclaredCount : 0;
  return declared.map((w) => (w === null ? perUndeclared : w));
}

/**
 * Right-alignment is done by padding with spaces rather than measuring exactly —
 * good enough for monetary columns in a fixed-size report and avoids shipping
 * font metrics for precise glyph widths.
 */
function alignText(text, columnWidth, align, size, bold) {
  if (align !== "right") return text;
  const available = columnWidth - 4;
  const textWidth = measure(text, size, bold);
  const spaceWidth = measure(" ", size, bold);
  const pad = Math.max(Math.floor((available - textWidth) / spaceWidth), 0);
  return `${" ".repeat(pad)}${text}`;
}

function clipToWidth(text, maxWidth, size) {
  if (measure(text, size, false) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && measure(`${out}…`, size, false) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

/**
 * Approximate Helvetica advance widths. Exact metrics would require the AFM
 * tables; this average-based estimate is only used for clipping and padding.
 */
function measure(text, size, bold) {
  const factor = bold ? 0.55 : 0.5;
  return String(text).length * size * factor;
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace("T", " ");
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

/**
 * Map to WinAnsi-safe text. The rupee sign and typographic dashes/quotes are the
 * characters this report set actually hits.
 */
function sanitize(text) {
  return String(text ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // Anything still outside printable Latin-1 would be undefined in WinAnsi.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

// ─────────────────────────────────────────────
// Serialization — assemble the PDF object graph.
// ─────────────────────────────────────────────

function serializePdf(pages, footer) {
  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length; // 1-based object numbers
  };

  // Reserve 1 = catalog, 2 = pages tree; fonts and page objects follow.
  addObject(null); // catalog placeholder
  addObject(null); // pages placeholder
  const regularFont = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const boldFont = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const pageRefs = [];
  pages.forEach((page, index) => {
    const stream = buildContentStream(page, index, pages.length, footer);
    const contentRef = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const pageRef = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] `
      + `/Resources << /Font << /F1 ${regularFont} 0 R /F2 ${boldFont} 0 R >> >> `
      + `/Contents ${contentRef} 0 R >>`,
    );
    pageRefs.push(pageRef);
  });

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

function buildContentStream(page, pageIndex, pageCount, footer) {
  const parts = ["BT"];
  let currentFont = null;
  let currentSize = null;

  for (const run of page.runs) {
    const font = run.bold ? "/F2" : "/F1";
    if (font !== currentFont || run.size !== currentSize) {
      parts.push(`${font} ${run.size} Tf`);
      currentFont = font;
      currentSize = run.size;
    }
    // Absolute placement per run keeps layout maths in one place (layoutPages).
    parts.push(`1 0 0 1 ${round(run.x)} ${round(run.y)} Tm`);
    parts.push(`(${escapeText(run.text)}) Tj`);
  }

  const footerText = footer
    ? `${footer}   |   Page ${pageIndex + 1} of ${pageCount}`
    : `Page ${pageIndex + 1} of ${pageCount}`;
  parts.push("/F1 8 Tf");
  parts.push(`1 0 0 1 ${MARGIN.left} ${MARGIN.bottom - 18} Tm`);
  parts.push(`(${escapeText(sanitize(footerText))}) Tj`);
  parts.push("ET");
  return parts.join("\n");
}

function escapeText(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
