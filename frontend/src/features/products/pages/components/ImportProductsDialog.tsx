import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useOfflineStatus } from "@/features/sync";
import { createProductLocalFirst } from "@/features/products/local-actions";
import { downloadProductTemplate, parseProductsCsv, type ParseProductsResult } from "@/features/products/import/product-import-csv";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function ImportProductsDialog({ open, onOpenChange, onImported }: Props) {
  const { toast } = useToast();
  const { isOnline } = useOfflineStatus();
  const [result, setResult] = useState<ParseProductsResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  function reset() {
    setResult(null);
    setFileName("");
    setProgress(0);
  }

  async function onFile(file?: File) {
    if (!file) return;
    setFileName(file.name);
    try {
      setResult(parseProductsCsv(await file.text()));
    } catch {
      toast({ title: "Could not read file", description: "Please upload the filled-in CSV template.", variant: "destructive" });
    }
  }

  async function confirmImport() {
    const valid = result?.rows.filter((r) => r.valid && r.input) ?? [];
    if (valid.length === 0) return;
    setImporting(true);
    setProgress(0);
    let failed = 0;
    for (let i = 0; i < valid.length; i += 1) {
      try { await createProductLocalFirst(valid[i].input!); } catch { failed += 1; }
      setProgress(Math.round(((i + 1) / valid.length) * 100));
    }
    setImporting(false);
    const added = valid.length - failed;
    toast({
      title: `Imported ${added} product${added === 1 ? "" : "s"}`,
      description: failed > 0
        ? `${failed} could not be saved.`
        : isOnline ? "Syncing to the cloud now." : "They'll sync when you're back online.",
      variant: failed > 0 ? "destructive" : undefined,
    });
    onImported?.();
    onOpenChange(false);
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Import products from Excel / CSV</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button variant="outline" size="sm" onClick={() => downloadProductTemplate()}>
              <Download size={15} className="mr-1.5" />Download template
            </Button>
            <span className="text-muted-foreground">Fill it in Excel → <strong>Save As CSV</strong> → upload below.</span>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm hover:bg-muted/40">
            <Upload size={18} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{fileName || "Choose a .csv file to upload"}</span>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] ?? undefined)} />
          </label>

          {result?.headerError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{result.headerError}</p>
          )}

          {result && !result.headerError && (
            <>
              <div className="flex gap-4 text-sm">
                <span className="font-bold text-emerald-600">{result.validCount} ready</span>
                <span className={result.errorCount ? "font-bold text-rose-600" : "text-muted-foreground"}>{result.errorCount} with errors</span>
              </div>
              <div className="max-h-[40vh] overflow-auto rounded-lg border">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-bold">#</th>
                      <th className="px-2 py-1.5 text-left font-bold">Name</th>
                      <th className="px-2 py-1.5 text-left font-bold">SKU/Barcode</th>
                      <th className="px-2 py-1.5 text-right font-bold">Sell</th>
                      <th className="px-2 py-1.5 text-left font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.rowNumber} className="border-t border-border">
                        <td className="px-2 py-1.5 text-muted-foreground">{r.rowNumber}</td>
                        <td className="px-2 py-1.5">{r.name}</td>
                        <td className="px-2 py-1.5">{r.values.skuBarcode || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.values.sellingPrice || "—"}</td>
                        <td className="px-2 py-1.5">
                          {r.valid
                            ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={13} />OK</span>
                            : <span className="inline-flex items-center gap-1 text-rose-600" title={r.errors.join("; ")}><AlertTriangle size={13} />{r.errors[0] ?? "Invalid"}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>Cancel</Button>
            <Button onClick={() => void confirmImport()} disabled={importing || !result || result.validCount === 0}>
              {importing ? `Importing… ${progress}%` : `Import ${result?.validCount ?? 0} product${(result?.validCount ?? 0) === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
