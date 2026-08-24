import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowRightLeft, CheckCircle2, ClipboardList, Download, Package, Search, SlidersHorizontal } from "lucide-react";
import { useGetStockLedger } from "@/lib/api/client";
import { offlineDB } from "@/lib/offline/db";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CHIP_TONES } from "@/lib/chip-tones";
import { cn } from "@/lib/utils";
import { useAppLanguage } from "@/features/core/settings/i18n";

type RegisterMode = "adjustments" | "transfers";

interface MovementRow extends Record<string, unknown> {
  id?: string;
  action?: string;
  type?: string;
  productName?: string;
  product_name?: string;
  quantityDelta?: number;
  quantity_delta?: number;
  changeBaseQty?: number;
  stockBefore?: number;
  stock_before?: number;
  oldStockBaseQty?: number;
  stockAfter?: number;
  stock_after?: number;
  newStockBaseQty?: number;
  unit?: string;
  actorName?: string | null;
  actor_name?: string | null;
  actorUserId?: string | null;
  actor_user_id?: string | null;
  sourceType?: string | null;
  source_type?: string | null;
  sourceId?: string | null;
  source_id?: string | null;
  note?: string;
  reason?: string;
  createdAt?: string;
  created_at?: string;
  sync_status?: string;
}

function money(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function qty(row: MovementRow) {
  return money(row.quantityDelta ?? row.quantity_delta ?? row.changeBaseQty);
}

function balance(row: MovementRow) {
  return {
    before: money(row.stockBefore ?? row.stock_before ?? row.oldStockBaseQty),
    after: money(row.stockAfter ?? row.stock_after ?? row.newStockBaseQty),
  };
}

function actorName(row: MovementRow) {
  return String(row.actorName ?? row.actor_name ?? ((row.actorUserId ?? row.actor_user_id) ? "Authenticated staff" : "Legacy entry"));
}

function sourceName(row: MovementRow) {
  return String(row.sourceType ?? row.source_type ?? row.action ?? row.type ?? "movement")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rowDate(row: MovementRow) {
  const raw = String(row.createdAt ?? row.created_at ?? "");
  const date = raw ? new Date(raw) : null;
  return date && Number.isFinite(date.getTime()) ? format(date, "dd MMM yyyy") : "-";
}

function rowType(row: MovementRow) {
  return String(row.action ?? row.type ?? "").toLowerCase();
}

function exportRows(rows: MovementRow[], mode: RegisterMode) {
  const header = ["Date", "Reference", "Product", "Quantity", "Balance Before", "Balance After", "Source", "Source ID", "Recorded By", "Actor ID", "Reason", "Sync"];
  const lines = rows.map((row) => [
    rowDate(row),
    String(row.id ?? "-"),
    String(row.productName ?? row.product_name ?? "-"),
    qty(row),
    balance(row).before,
    balance(row).after,
    sourceName(row),
    String(row.sourceId ?? row.source_id ?? "-"),
    actorName(row),
    String(row.actorUserId ?? row.actor_user_id ?? "-"),
    String(row.reason ?? row.note ?? "-"),
    String(row.sync_status ?? "local"),
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kirana-${mode}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function InventoryRegisterView({ mode }: { mode: RegisterMode }) {
  const { t } = useAppLanguage();
  const [search, setSearch] = useState("");
  const ledger = useGetStockLedger({ limit: 500 });
  // Local movements keep this register offline-first: unsynced corrections show
  // immediately and the page still works without the backend.
  const queryClient = useQueryClient();
  const localMovements = useQuery({
    queryKey: ["inventory-register-local"],
    queryFn: () => offlineDB.getAll<MovementRow>("inventory_movements").catch(() => [] as MovementRow[]),
    staleTime: 2_000,
    refetchInterval: 30_000, // slow fallback; the local-data events below are the fast path
  });
  useEffect(() => {
    // Movements recorded elsewhere in the app announce themselves — re-read on those
    // events instead of hammering IndexedDB on a tight poll (was every 5s).
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["inventory-register-local"] });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [queryClient]);
  const isAdjustments = mode === "adjustments";
  const sourceRows = useMemo(() => {
    const merged = new Map<string, MovementRow>();
    for (const row of (localMovements.data ?? [])) if (row?.id) merged.set(String(row.id), row);
    for (const row of ((ledger.data?.entries ?? []) as MovementRow[])) if (row?.id) merged.set(String(row.id), { ...merged.get(String(row.id)), ...row });
    return [...merged.values()].sort((a, b) => String(b.createdAt ?? b.created_at ?? "").localeCompare(String(a.createdAt ?? a.created_at ?? "")));
  }, [ledger.data, localMovements.data]);

  const scopedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sourceRows
      .filter((row) => {
        const type = rowType(row);
        return isAdjustments
          ? ["correction", "adjustment", "damage"].includes(type)
          : ["transfer", "stock_transfer"].includes(type);
      })
      .filter((row) => {
        if (!q) return true;
        return [row.productName, row.product_name, row.reason, row.note, row.id, row.actorName, row.actor_name, row.sourceType, row.source_type].filter(Boolean).join(" ").toLowerCase().includes(q);
      })
      .slice(0, 100);
  }, [isAdjustments, search, sourceRows]);

  const stats = useMemo(() => {
    const totalQty = scopedRows.reduce((sum, row) => sum + Math.abs(qty(row)), 0);
    const completed = scopedRows.filter((row) => String(row.sync_status ?? "synced") !== "failed").length;
    const traceable = scopedRows.filter((row) => Boolean((row.actorName ?? row.actor_name) && (row.sourceType ?? row.source_type))).length;
    return {
      total: scopedRows.length,
      items: new Set(scopedRows.map((row) => row.productName ?? row.product_name).filter(Boolean)).size,
      quantity: Math.round(totalQty),
      completed,
      traceable,
    };
  }, [scopedRows]);

  const title = isAdjustments ? "Adjustments" : "Stock Transfers";
  const description = isAdjustments ? "Adjust inventory quantities and review correction history." : "Transfer stock between locations and review movement history.";
  const icon = isAdjustments ? <SlidersHorizontal size={18} /> : <ArrowRightLeft size={18} />;
  const emptyTitle = isAdjustments ? "No adjustments yet" : "No stock transfers yet";
  const emptyText = isAdjustments ? "Stock corrections and damage entries will appear here." : "Transfers will appear here once multi-location stock movement is recorded.";

  return (
    <div className="app-docked-page">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-display text-[22px] font-black tracking-tight text-[var(--brand-ink)]">{title}</h2>
          <p className="mt-1 text-[13px] text-[#64748b]">{description}</p>
        </div>
        <Button
          variant="outline"
          className="h-11 gap-2 rounded-[10px] font-bold"
          onClick={() => exportRows(scopedRows, mode)}
          disabled={scopedRows.length === 0}
        >
          <Download size={15} /> Export
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={icon} label={isAdjustments ? t("inventory.register.totalAdjustments") : t("inventory.register.totalTransfers")} value={stats.total.toLocaleString("en-IN")} tone="blue" />
        <Kpi icon={<Package size={18} />} label={t("inventory.register.itemsTouched")} value={stats.items.toLocaleString("en-IN")} tone="green" />
        <Kpi icon={<ClipboardList size={18} />} label={t("inventory.status.totalQuantity")} value={stats.quantity.toLocaleString("en-IN")} tone="violet" />
        <Kpi icon={<CheckCircle2 size={18} />} label={t("inventory.register.traceable")} value={stats.traceable.toLocaleString("en-IN")} tone="amber" />
      </div>

      <div className="mt-4 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
          <Input
            className="h-11 rounded-[10px] border-[#e3eaf3] bg-[#f8fafd] pl-10 text-[13px] font-medium text-[var(--brand-ink)] focus-visible:border-[var(--brand)] focus-visible:bg-white focus-visible:ring-0"
            placeholder={`Search ${title.toLowerCase()}...`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
        {ledger.isLoading && localMovements.isLoading ? (
          <div className="py-14 text-center text-[13px] text-[#64748b]">{t("inventory.register.loading")}</div>
        ) : scopedRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">{icon}</span>
            <p className="text-[13px] font-black text-[var(--brand-ink)]">{emptyTitle}</p>
            <p className="max-w-sm text-[12px] leading-5 text-[#64748b]">{emptyText}</p>
          </div>
        ) : (<>
          <div className="divide-y divide-[#e9eef5] md:hidden">
            {scopedRows.map((row, index) => {
              const delta = qty(row);
              const flow = balance(row);
              const sync = String(row.sync_status ?? "synced").toLowerCase();
              return (
                <article key={String(row.id ?? index)} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-black text-[var(--brand-ink)]">{String(row.productName ?? row.product_name ?? "-")}</p>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#7a89a2]">{sourceName(row)} · {rowDate(row)}</p>
                    </div>
                    <p className={cn("whitespace-nowrap text-[15px] font-black", delta >= 0 ? "text-emerald-600" : "text-rose-600")}>{delta >= 0 ? "+" : ""}{delta.toLocaleString("en-IN")} <span className="text-[10px]">{String(row.unit ?? "")}</span></p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-[12px] border border-[#e5ebf3] bg-[#f8fafd] p-3">
                    <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#8795ac]">{t("inventory.page.balance")}</p><p className="mt-1 text-[12px] font-black text-[#2c3e5f]">{flow.before.toLocaleString("en-IN")} → {flow.after.toLocaleString("en-IN")}</p></div>
                    <div className="border-l border-[#dfe6ef] pl-3"><p className="text-[9px] font-bold uppercase tracking-wider text-[#8795ac]">{t("inventory.page.actor")}</p><p className="mt-1 truncate text-[12px] font-black text-[#2c3e5f]">{actorName(row)}</p></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3"><p className="min-w-0 truncate text-[11px] text-[#52627e]">{String(row.reason ?? row.note ?? row.sourceId ?? row.source_id ?? "-")}</p><span className="shrink-0 rounded-full bg-[#eef3fb] px-2.5 py-1 text-[9px] font-black capitalize text-[#5f708d]">{sync.replaceAll("_", " ")}</span></div>
                </article>
              );
            })}
          </div>
          <div className="app-table-scroll hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1100px] text-[12.5px]">
              <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                <tr>
                  <th className="px-4 py-3 text-left font-bold">{t("inventory.col.date")}</th>
                  <th className="px-4 py-3 text-left font-bold">{t("inventory.col.reference")}</th>
                  <th className="px-4 py-3 text-left font-bold">{t("inventory.col.product")}</th>
                  <th className="px-4 py-3 text-right font-bold">{t("inventory.col.quantity")}</th>
                  <th className="px-4 py-3 text-left font-bold">{t("inventory.page.balance")}</th>
                  <th className="px-4 py-3 text-left font-bold">{t("inventory.page.source")}</th>
                  <th className="px-4 py-3 text-left font-bold">{t("inventory.page.actor")}</th>
                  <th className="px-4 py-3 text-left font-bold">{t("inventory.col.reason")}</th>
                  <th className="px-4 py-3 text-left font-bold">{t("inventory.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {scopedRows.map((row, index) => {
                  const delta = qty(row);
                  const sync = String(row.sync_status ?? "synced").toLowerCase();
                  const syncTone = sync === "synced" ? CHIP_TONES.green : sync === "failed" || sync === "conflict" ? CHIP_TONES.red : CHIP_TONES.amber;
                  return (
                    <tr key={String(row.id ?? index)} className="border-b border-[#eef2f8] last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-[#52627e]">{rowDate(row)}</td>
                      <td className="px-4 py-3 font-mono text-[12px] uppercase text-[#52627e]" title={String(row.id ?? "-")}>{String(row.id ?? "-").slice(-8)}</td>
                      <td className="px-4 py-3 font-bold text-[var(--brand-ink)]">{String(row.productName ?? row.product_name ?? "-")}</td>
                      <td className={cn("px-4 py-3 text-right font-black", delta >= 0 ? "text-emerald-600" : "text-rose-600")}>
                        {delta >= 0 ? "+" : ""}{delta.toLocaleString("en-IN")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-bold text-[#344668]">{balance(row).before.toLocaleString("en-IN")} → {balance(row).after.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3"><p className="font-bold text-[#344668]">{sourceName(row)}</p><p className="max-w-[140px] truncate text-[10px] text-[#7b8aa4]">{String(row.sourceId ?? row.source_id ?? "-")}</p></td>
                      <td className="max-w-[180px] truncate px-4 py-3 font-bold text-[#344668]">{actorName(row)}</td>
                      <td className="max-w-[260px] truncate px-4 py-3 text-[#344668]">{String(row.reason ?? row.note ?? "-")}</td>
                      <td className="px-4 py-3"><span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold capitalize", syncTone)}>{sync.replaceAll("_", " ")}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>)}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "blue" | "green" | "violet" | "amber" }) {
  const toneClass = {
    blue: "bg-[var(--brand-soft)] text-[var(--brand)]",
    green: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
    amber: "bg-amber-50 text-amber-600",
  }[tone];

  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
        <span className={cn("grid h-9 w-9 place-items-center rounded-[10px]", toneClass)}>{icon}</span>
      </div>
      <p className="mt-2 font-display text-[24px] font-black leading-none text-[var(--brand-ink)]">{value}</p>
    </div>
  );
}
