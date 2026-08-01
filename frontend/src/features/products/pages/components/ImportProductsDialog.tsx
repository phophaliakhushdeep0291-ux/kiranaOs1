import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useOfflineStatus } from "@/features/sync";
import {
  importProductsLocalFirst,
  productImportSessionSettingKey,
  type ProductImportSession,
} from "@/features/products/local-actions";
import {
  PRODUCT_IMPORT_COLUMNS,
  downloadProductImportErrors,
  downloadProductTemplate,
  fingerprintProductImport,
  inspectProductImportCsv,
  parseProductsCsv,
  planProductImport,
  type ProductImportField,
  type ProductImportMapping,
  type ProductImportPlan,
  type ProductImportSource,
  type ProductImportStrategy,
} from "@/features/products/import/product-import-csv";
import { offlineDB } from "@/lib/offline/db";
import type { Product } from "@/types/api";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppLanguage, type TranslationKey } from "@/features/settings/i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

const PRIORITY_MAPPING_FIELDS: ProductImportField[] = [
  "name",
  "skuBarcode",
  "costPrice",
  "sellingPrice",
  "stockQuantity",
  "unit",
  "packSizeValue",
  "packSizeUnit",
  "isLooseItem",
];

// Translation keys, not text: this map is module scope and cannot call the
// `t()` hook. The label is resolved at the call site, inside the component.
const SOURCE_LABEL_KEYS: Record<ProductImportSource, TranslationKey> = {
  kiranaos: "products.import.arthaTemplate",
  vyapar: "products.import.vyaparExport",
  mybillbook: "products.import.mybillbookExport",
  tally: "products.import.tallyExport",
  generic: "products.import.genericCsv",
};

function actionStyle(action: string): string {
  if (action === "create") return "bg-emerald-50 text-emerald-700";
  if (action === "update") return "bg-blue-50 text-blue-700";
  if (action === "skip") return "bg-slate-100 text-slate-600";
  return "bg-rose-50 text-rose-700";
}

function summaryCard(label: string, value: number, tone: string) {
  return (
    <div className="rounded-[8px] border border-[#e0e7f1] bg-white px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#71809a]">{label}</p>
      <p className={cn("mt-1 text-[20px] font-black tabular-nums", tone)}>{value}</p>
    </div>
  );
}

export function ImportProductsDialog({ open, onOpenChange, onImported }: Props) {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const { isOnline } = useOfflineStatus();
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [mapping, setMapping] = useState<ProductImportMapping>({});
  const [existingProducts, setExistingProducts] = useState<Product[]>([]);
  const [strategy, setStrategy] = useState<ProductImportStrategy>("skip-existing");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previousSession, setPreviousSession] = useState<ProductImportSession | null>(null);
  const [completedSession, setCompletedSession] = useState<ProductImportSession | null>(null);

  const result = useMemo(
    () => rawText ? parseProductsCsv(rawText, mapping) : null,
    [mapping, rawText],
  );
  const plan = useMemo<ProductImportPlan | null>(
    () => result && !result.headerError ? planProductImport(result, existingProducts, strategy) : null,
    [existingProducts, result, strategy],
  );

  function reset() {
    setFileName("");
    setRawText("");
    setMapping({});
    setExistingProducts([]);
    setStrategy("skip-existing");
    setProgress(0);
    setPreviousSession(null);
    setCompletedSession(null);
  }

  async function onFile(file?: File) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast({
        title: t("products.import.fileTooLarge"),
        description: t("products.import.fileTooLargeHint"),
        variant: "destructive",
      });
      return;
    }

    try {
      const text = await file.text();
      const inspection = inspectProductImportCsv(text);
      const fingerprint = fingerprintProductImport(text);
      const [products, prior] = await Promise.all([
        offlineDB.getAll<Product>("products"),
        offlineDB.getSetting<ProductImportSession>(productImportSessionSettingKey(fingerprint)),
      ]);
      setFileName(file.name);
      setRawText(text);
      setMapping(inspection.mapping);
      setExistingProducts(products);
      setPreviousSession(prior);
      setCompletedSession(null);
      setProgress(0);
    } catch (error) {
      toast({
        title: t("products.import.readFailed"),
        description: error instanceof Error ? error.message : t("products.import.saveAsCsv"),
        variant: "destructive",
      });
    }
  }

  function changeMapping(field: ProductImportField, sourceIndex: string) {
    setMapping((current) => {
      const next = { ...current };
      delete next[field];
      if (sourceIndex === "") return next;
      const index = Number(sourceIndex);
      for (const column of PRODUCT_IMPORT_COLUMNS) {
        if (column.field !== field && next[column.field] === index) delete next[column.field];
      }
      next[field] = index;
      return next;
    });
  }

  async function confirmImport() {
    if (!plan || !result || plan.importCount === 0) return;
    setImporting(true);
    setProgress(15);
    try {
      const fingerprint = fingerprintProductImport(rawText);
      const operations = plan.rows.flatMap((row) => {
        if ((row.action !== "create" && row.action !== "update") || !row.finalInput) return [];
        return [{
          action: row.action,
          rowNumber: row.rowNumber,
          input: row.finalInput,
          existingProductId: row.matchedProductId,
        }];
      });
      setProgress(45);
      const session = await importProductsLocalFirst(operations, {
        fingerprint,
        fileName,
        source: result.source,
        totalRows: plan.rows.length,
        skippedRows: plan.skipCount,
        errorRows: plan.errorCount,
      });
      setProgress(100);
      setCompletedSession(session);
      setPreviousSession(session);
      setExistingProducts(await offlineDB.getAll<Product>("products"));
      toast({
        title: t("products.import.completed"),
        description: t("products.import.importedCounts", { created: session.createdRows, updated: session.updatedRows, backup: isOnline ? t("products.import.backupQueued") : t("products.import.backupWhenOnline") }),
      });
      onImported?.();
    } catch (error) {
      setProgress(0);
      toast({
        title: t("products.import.nothingPartial"),
        description: error instanceof Error ? error.message : t("products.import.rolledBack"),
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  }

  const renderMappingFields = (fields: ProductImportField[]) => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field) => {
        const column = PRODUCT_IMPORT_COLUMNS.find((item) => item.field === field);
        if (!column) return null;
        return (
          <label key={field} className="space-y-1 text-[11px] font-bold text-[#43516b]">
            <span>{column.header}{column.required ? " *" : ""}</span>
            <select
              value={mapping[field] ?? ""}
              onChange={(event) => changeMapping(field, event.target.value)}
              className="h-9 w-full rounded-[7px] border border-[#d8e2ef] bg-white px-2 text-[12px] font-medium text-[#17223b] outline-none focus:border-[var(--brand)]"
            >
              <option value="">Not mapped</option>
              {(result?.headers ?? []).map((header, index) => (
                <option key={`${header}-${index}`} value={index}>{header || `Column ${index + 1}`}</option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );

  const optionalFields = PRODUCT_IMPORT_COLUMNS
    .map((column) => column.field)
    .filter((field) => !PRIORITY_MAPPING_FIELDS.includes(field));
  const previewRows = plan?.rows.slice(0, 200) ?? [];

  return (
    <Dialog open={open} onOpenChange={(value) => { onOpenChange(value); if (!value) reset(); }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto bg-[#f8fafc] p-0">
        <DialogHeader className="border-b border-[#e0e7f1] bg-white px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-[18px] font-black text-[var(--brand-ink)]">
            <FileSpreadsheet size={20} className="text-[var(--brand)]" />
            Migrate products and opening stock
          </DialogTitle>
          <p className="text-[12px] text-[#64748b]">Dry-run first, review every conflict, then save all accepted rows as one transaction.</p>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[#dce5f2] bg-white p-3 text-[12px]">
            <Button variant="outline" size="sm" onClick={() => downloadProductTemplate()}>
              <Download size={15} className="mr-1.5" />Download safe template
            </Button>
            <span className="text-[#64748b]">Exports from Excel, Vyapar, myBillBook, or Tally can be mapped below after saving as CSV.</span>
          </div>

          <label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-[8px] border border-dashed border-[#b9c8dd] bg-white p-4 text-sm transition-colors hover:border-[var(--brand)] hover:bg-[#f6f9ff]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]">
              <Upload size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-[#17223b]">{fileName || t("products.import.chooseFile")}</span>
              <span className="mt-0.5 block text-[11px] text-[#71809a]">CSV only, up to 25 MB. No data changes until you confirm the dry-run.</span>
            </span>
            <span className="rounded-[6px] border border-[#d8e2ef] px-3 py-1.5 text-[11px] font-bold text-[#40506d]">Browse</span>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void onFile(event.target.files?.[0])} />
          </label>

          {result && (
            <section className="space-y-3 rounded-[8px] border border-[#dce5f2] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-[13px] font-black text-[#17223b]">Column mapping</h3>
                  <p className="text-[11px] text-[#71809a]">{t("products.import.detectedSource", { source: t(SOURCE_LABEL_KEYS[result.source]) })}</p>
                </div>
                <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[10px] font-bold text-[var(--brand)]">{result.rows.length} data rows</span>
              </div>
              {renderMappingFields(PRIORITY_MAPPING_FIELDS)}
              <details className="rounded-[7px] border border-[#e3e9f2] bg-[#fbfcfe] px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-bold text-[#40506d]">Map optional tax, brand, category, and stock-alert fields</summary>
                <div className="mt-3">{renderMappingFields(optionalFields)}</div>
              </details>
            </section>
          )}

          {result?.headerError && (
            <div className="flex items-start gap-2 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{result.headerError}</span>
            </div>
          )}

          {plan && (
            <>
              {previousSession && !completedSession && (
                <div className="flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
                  <RefreshCw size={15} className="mt-0.5 shrink-0" />
                  <span>This exact file completed on {new Date(previousSession.completedAt).toLocaleString()}. Existing products are skipped by default, so retrying will not duplicate them.</span>
                </div>
              )}

              <section className="space-y-3 rounded-[8px] border border-[#dce5f2] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[13px] font-black text-[#17223b]">Dry-run result</h3>
                    <p className="text-[11px] text-[#71809a]">No product or stock value has changed yet.</p>
                  </div>
                  <div className="inline-flex rounded-[7px] border border-[#d8e2ef] bg-[#f7f9fc] p-1 text-[11px] font-bold">
                    <button
                      type="button"
                      className={cn("rounded-[5px] px-3 py-1.5", strategy === "skip-existing" ? "bg-white text-[var(--brand)] shadow-sm" : "text-[#64748b]")}
                      onClick={() => setStrategy("skip-existing")}
                    >
                      Skip existing (safer)
                    </button>
                    <button
                      type="button"
                      className={cn("rounded-[5px] px-3 py-1.5", strategy === "update-existing" ? "bg-white text-[var(--brand)] shadow-sm" : "text-[#64748b]")}
                      onClick={() => setStrategy("update-existing")}
                    >
                      Update matched
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {summaryCard("New", plan.createCount, "text-emerald-600")}
                  {summaryCard(t("products.import.update"), plan.updateCount, "text-blue-600")}
                  {summaryCard("Skip", plan.skipCount, "text-slate-600")}
                  {summaryCard(t("products.import.issues"), plan.errorCount, "text-rose-600")}
                </div>

                {strategy === "update-existing" && plan.updateCount > 0 && (
                  <p className="rounded-[7px] bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    Update mode changes only columns present in this file. If Opening Stock is mapped, it replaces the current opening quantity for matched products.
                  </p>
                )}

                <div className="overflow-x-auto rounded-[8px] border border-[#e0e7f1]">
                  <table className="w-full min-w-[700px] text-[11px]">
                    <thead className="bg-[#f5f7fb] text-[#596982]">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold">Row</th>
                        <th className="px-3 py-2 text-left font-bold">{t("products.col.product")}</th>
                        <th className="px-3 py-2 text-left font-bold">Barcode</th>
                        <th className="px-3 py-2 text-left font-bold">Pack / unit</th>
                        <th className="px-3 py-2 text-right font-bold">Selling</th>
                        <th className="px-3 py-2 text-left font-bold">{t("products.col.action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => {
                        const defaultUnit = row.finalInput?.sellingUnits?.find((unit) => unit.isDefault) ?? row.input?.sellingUnits?.find((unit) => unit.isDefault);
                        const pack = defaultUnit?.packSizeValue
                          ? `${defaultUnit.packSizeValue} ${defaultUnit.packSizeUnit ?? ""}`.trim()
                          : (row.input?.unit ?? "piece");
                        return (
                          <tr key={row.rowNumber} className="border-t border-[#e7ecf3] text-[#24324d]">
                            <td className="px-3 py-2 text-[#7b879b]">{row.rowNumber}</td>
                            <td className="max-w-[220px] px-3 py-2 font-semibold">
                              <span className="block truncate">{row.name}</span>
                              {row.errors[0] && <span className="mt-0.5 block truncate text-[10px] font-medium text-rose-600" title={row.errors.join("; ")}>{row.errors[0]}</span>}
                            </td>
                            <td className="px-3 py-2">{row.values.skuBarcode || t("products.import.notSet")}</td>
                            <td className="px-3 py-2">{pack}</td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums">{row.values.sellingPrice || "-"}</td>
                            <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-1 text-[9px] font-black uppercase", actionStyle(row.action))}>{row.action}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {plan.rows.length > previewRows.length && (
                  <p className="text-center text-[10px] text-[#7b879b]">Showing the first {previewRows.length} rows. All {plan.rows.length} rows are included in the dry-run totals.</p>
                )}

                {plan.errorCount > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[7px] border border-rose-100 bg-rose-50 px-3 py-2">
                    <span className="text-[11px] text-rose-700">{plan.errorCount} issue row{plan.errorCount === 1 ? "" : "s"} will remain unchanged and are never silently discarded.</span>
                    <Button size="sm" variant="outline" onClick={() => downloadProductImportErrors(plan)}>
                      <Download size={14} className="mr-1.5" />Download issues
                    </Button>
                  </div>
                )}
              </section>
            </>
          )}

          {completedSession && (
            <div className="flex items-start gap-3 rounded-[8px] border border-emerald-200 bg-emerald-50 p-4">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-[13px] font-black text-emerald-800">Migration saved safely</p>
                <p className="mt-0.5 text-[11px] text-emerald-700">{completedSession.createdRows} created, {completedSession.updatedRows} updated, {completedSession.skippedRows} skipped. The audit trail and cloud backup operations were saved in the same transaction.</p>
              </div>
            </div>
          )}

          {importing && (
            <div className="space-y-2 rounded-[8px] border border-blue-100 bg-blue-50 p-3">
              <div className="flex items-center justify-between text-[11px] font-bold text-blue-700">
                <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Saving products, audit trail, and backup queue</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${progress}%` }} /></div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {completedSession ? (
              <Button onClick={() => onOpenChange(false)}><FileCheck2 size={15} className="mr-1.5" />Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>Cancel</Button>
                <Button onClick={() => void confirmImport()} disabled={importing || !plan || plan.importCount === 0 || Boolean(result?.headerError)}>
                  {importing ? t("products.import.saving") : `Import ${plan?.importCount ?? 0} accepted row${(plan?.importCount ?? 0) === 1 ? "" : "s"}`}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
