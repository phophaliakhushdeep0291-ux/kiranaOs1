const ENTITIES = new Map([
  ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"], ["nbsp", " "],
]);

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return ENTITIES.get(entity.toLowerCase()) ?? match;
  });
}

export function htmlToReceiptText(html, width = 42) {
  const safeWidth = Math.min(64, Math.max(24, Number(width) || 42));
  const source = String(html || "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|section|header|footer|h[1-6])>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "  ")
    .replace(/<[^>]+>/g, "");
  const plain = decodeEntities(source).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const lines = [];
  for (const rawLine of plain.split("\n")) {
    let line = rawLine.trim();
    if (!line) { if (lines.at(-1) !== "") lines.push(""); continue; }
    while (line.length > safeWidth) {
      let split = line.lastIndexOf(" ", safeWidth);
      if (split < Math.floor(safeWidth * 0.55)) split = safeWidth;
      lines.push(line.slice(0, split).trimEnd());
      line = line.slice(split).trimStart();
    }
    lines.push(line);
  }
  return lines.join("\n").trim();
}

export function buildEscPosJob({ html, paperSize = "80mm", autoCut = true, cashDrawer = false }) {
  const width = paperSize === "58mm" ? 32 : paperSize === "76mm" ? 40 : 48;
  const text = htmlToReceiptText(html, width);
  const chunks = [Buffer.from([0x1b, 0x40]), Buffer.from(`${text}\n\n\n`, "utf8")];
  if (cashDrawer) chunks.push(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  if (autoCut) chunks.push(Buffer.from([0x1d, 0x56, 0x00]));
  return Buffer.concat(chunks);
}

export function buildDrawerPulse() {
  return Buffer.from([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]);
}
