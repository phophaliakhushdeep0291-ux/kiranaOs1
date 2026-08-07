import { useMemo } from "react";
import { AlertTriangle, Printer, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QrCodeView } from "@/lib/qr/QrCodeView";
import { encodeQrSvg } from "@/lib/qr/qr-encoder";
import { describeTableQr, tablesForPrinting, type PrintableTable } from "../../service/table-qr";

/**
 * The sticker that goes on the table.
 *
 * Two things about it are load-bearing and neither is decoration. The table's
 * NAME is printed large next to the code, because when a guest says "the QR
 * isn't working" the first question is which table they are at, and the sticker
 * has to answer it without anyone opening the POS. And an unreachable address is
 * called out *before* printing rather than after: a QR generated on a till
 * running at localhost points a guest's phone at their own phone, which fails
 * silently in their hands with nothing on the screen explaining why.
 */

export interface TableQrDialogProps {
  open: boolean;
  onClose: () => void;
  shopId: string;
  shopName: string;
  /** Null for the "print every table" sheet. */
  table: PrintableTable | null;
  tables: PrintableTable[];
  configuredBaseUrl?: string | null;
}

function qrTargets(tables: PrintableTable[], shopId: string, configuredBaseUrl?: string | null) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return tables.map((table) => ({
    table,
    ...describeTableQr({ shopId, tableCode: table.code ?? "", configuredBaseUrl, currentOrigin: origin, basePath }),
  }));
}

/** Printed at 2 per row on A4 — a size that survives being laminated and wiped down. */
function printSheet(
  targets: ReturnType<typeof qrTargets>,
  shopName: string,
  title: string,
) {
  const win = window.open("", "_blank", "width=860,height=1000");
  if (!win) return;
  const cards = targets
    .map(({ table, url }) => `
      <figure class="card">
        <p class="shop">${escapeHtml(shopName)}</p>
        <p class="table">${escapeHtml(table.name)}</p>
        <div class="qr">${encodeQrSvg(url, { border: 2 })}</div>
        <p class="lead">Scan to see the menu &amp; order</p>
        <p class="code">${escapeHtml(table.section ?? "")} &middot; ${escapeHtml(table.code ?? "")}</p>
      </figure>`)
    .join("");

  win.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; }
  .card { margin: 0; padding: 8mm 6mm; border: 1.2px dashed #b8c2d4; border-radius: 6mm; text-align: center; break-inside: avoid; }
  .shop { margin: 0; font-size: 11pt; letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
  .table { margin: 2mm 0 4mm; font-size: 30pt; font-weight: 800; line-height: 1; color: #0f172a; }
  .qr { width: 46mm; height: 46mm; margin: 0 auto; }
  .lead { margin: 4mm 0 0; font-size: 12pt; font-weight: 700; color: #0f172a; }
  .code { margin: 1.5mm 0 0; font-size: 9pt; color: #94a3b8; }
</style></head><body><div class="grid">${cards}</div>
<script>window.onload=function(){window.print()}</script></body></html>`);
  win.document.close();
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));
}

export function TableQrDialog({ open, onClose, shopId, shopName, table, tables, configuredBaseUrl }: TableQrDialogProps) {
  const printable = useMemo(() => tablesForPrinting(tables), [tables]);
  const targets = useMemo(
    () => qrTargets(table ? [table] : printable, shopId, configuredBaseUrl),
    [table, printable, shopId, configuredBaseUrl],
  );
  const single = table ? targets[0] : null;
  // One warning for the whole sheet: every table shares an address, so repeating
  // it per card would be noise around the one fact that matters.
  const unreachable = targets.find((target) => !target.reach.reachable)?.reach;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{table ? `${table.name} — table QR` : `Print QR for ${printable.length} tables`}</DialogTitle>
        </DialogHeader>

        {unreachable && !unreachable.reachable ? (
          <div className="flex gap-2 rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-3 text-[12px] leading-relaxed text-[#9a3412]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{unreachable.detail}</span>
          </div>
        ) : null}

        {single ? (
          <div className="space-y-3 text-center">
            <div className="mx-auto grid place-items-center rounded-2xl border border-[#eef2f8] p-4">
              <QrCodeView value={single.url} size={236} title={`QR for ${table?.name}`} />
            </div>
            <p className="text-[12px] leading-relaxed text-[#5b6b85]">
              Stick this on {table?.name}. A guest scans it and sees your menu with their table already chosen —
              no name, no number, nothing to type.
            </p>
            <p className="break-all text-[11px] text-[#94a3b8]">{single.url}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid max-h-[46vh] grid-cols-3 gap-2 overflow-y-auto rounded-xl border border-[#eef2f8] p-2">
              {targets.map(({ table: row, url }) => (
                <div key={row.id} className="rounded-lg border border-[#f1f5fb] p-1.5 text-center">
                  <QrCodeView value={url} size={72} title={`QR for ${row.name}`} />
                  <div className="mt-1 truncate text-[10px] font-black text-[var(--brand-ink)]">{row.name}</div>
                </div>
              ))}
            </div>
            {printable.length === 0 ? (
              <p className="text-center text-[12px] text-[#64748b]">Add a table first — there is nothing to print yet.</p>
            ) : null}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-[10px] font-bold" onClick={onClose}>Close</Button>
          <Button
            className="h-10 gap-2 rounded-[10px] font-black"
            disabled={targets.length === 0}
            onClick={() => printSheet(targets, shopName, table ? `${table.name} QR` : "Table QR codes")}
          >
            {table ? <Printer size={15} /> : <QrCode size={15} />}
            {table ? "Print" : `Print ${targets.length}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
