import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowUpRight,
  CalendarDays,
  Download,
  Landmark,
  RefreshCw,
  Search,
  Smartphone,
  Wallet,
} from "lucide-react";
import { format } from "date-fns";
import { listExpenses } from "@/features/expenses/api";
import { buildMoneyStatement, loadMoneyStatementInput, type MoneyStatementDirection, type MoneyStatementMode, type MoneyStatementRow } from "@/features/money-statement/statement-data";
import { cn } from "@/lib/utils";

type PeriodPreset = "today" | "week" | "month";

const CARD = "rounded-[18px] border border-[#e3eaf4] bg-white shadow-[0_10px_28px_rgba(26,57,112,0.055)]";

function money(value: number) {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function todayKey() {
  return format(new Date(), "yyyy-MM-dd");
}

function presetRange(preset: PeriodPreset) {
  const now = new Date();
  const to = format(now, "yyyy-MM-dd");
  if (preset === "today") return { from: to, to };
  if (preset === "month") return { from: format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd"), to };
  const from = new Date(now);
  from.setDate(now.getDate() - 6);
  return { from: format(from, "yyyy-MM-dd"), to };
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(rows: MoneyStatementRow[]) {
  const header = ["Date", "Time", "Party", "Mobile", "Source", "Reference", "Mode", "Direction", "Amount", "Status"];
  const body = rows.map((row) => [
    row.dateLabel,
    row.timeLabel,
    row.partyName,
    row.partyMobile ?? "",
    row.source,
    row.reference,
    row.mode.toUpperCase(),
    row.direction === "in" ? "Received" : "Paid",
    row.amount,
    row.status ?? "",
  ]);
  const csv = [header, ...body].map((line) => line.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `money-statement-${todayKey()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function MoneyStatementPage() {
  const [preset, setPreset] = useState<PeriodPreset>("today");
  const [range, setRange] = useState(() => presetRange("today"));
  const [mode, setMode] = useState<MoneyStatementMode | "all">(() => {
    const value = new URLSearchParams(window.location.search).get("mode");
    return value === "cash" || value === "upi" || value === "bank" ? value : "all";
  });
  const [direction, setDirection] = useState<MoneyStatementDirection | "all">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState<Awaited<ReturnType<typeof loadMoneyStatementInput>> | null>(null);

  const refresh = () => {
    setLoading(true);
    void Promise.all([
      loadMoneyStatementInput(),
      listExpenses({ from: range.from, to: range.to }).catch(() => []),
    ]).then(([localInput, expenses]) => {
      setInput({ ...localInput, expenses: expenses as unknown as Record<string, unknown>[] });
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const statement = useMemo(
    () => buildMoneyStatement(input ?? {}, { ...range, mode, direction, search }),
    [input, range, mode, direction, search],
  );

  const modeCards = [
    {
      label: "Cash Balance",
      sub: `${money(statement.totals.cashIn)} received · ${money(statement.totals.cashOut)} paid`,
      value: statement.totals.cashNet,
      icon: <Wallet size={18} />,
      href: "/money-statement?mode=cash",
      bg: "border-[#c8f1d5] bg-[#e7faee] text-[#159447] shadow-[0_0_0_4px_rgba(17,168,75,0.035),0_10px_26px_rgba(17,168,75,0.20)]",
    },
    {
      label: "UPI Balance",
      sub: `${money(statement.totals.upiIn)} received · ${money(statement.totals.upiOut)} paid`,
      value: statement.totals.upiNet,
      icon: <Smartphone size={18} />,
      href: "/money-statement?mode=upi",
      bg: "border-[#ddd3ff] bg-[#f0ebff] text-[#7047eb] shadow-[0_0_0_4px_rgba(112,71,235,0.035),0_10px_26px_rgba(112,71,235,0.20)]",
    },
    {
      label: "Bank Balance",
      sub: `${money(statement.totals.bankIn)} received · ${money(statement.totals.bankOut)} paid`,
      value: statement.totals.bankNet,
      icon: <Landmark size={18} />,
      href: "/money-statement?mode=bank",
      bg: "border-[#cfe0ff] bg-[#eaf2ff] text-[#075fff] shadow-[0_0_0_4px_rgba(7,95,255,0.035),0_10px_26px_rgba(7,95,255,0.20)]",
    },
    {
      label: "Total Net",
      sub: `${money(statement.totals.totalIn)} in · ${money(statement.totals.totalOut)} out`,
      value: statement.totals.totalNet,
      icon: <ArrowUpRight size={18} />,
      href: "/money-statement",
      bg: "border-[#ffdca8] bg-[#fff2df] text-[#f39a0b] shadow-[0_0_0_4px_rgba(255,133,0,0.035),0_10px_26px_rgba(255,133,0,0.20)]",
    },
  ];

  const setPresetRange = (next: PeriodPreset) => {
    setPreset(next);
    setRange(presetRange(next));
  };

  return (
    <div className="min-h-full bg-white p-4 font-sans sm:p-5 2xl:p-6">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {modeCards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              onClick={() => {
                if (card.label.startsWith("Cash")) setMode("cash");
                else if (card.label.startsWith("UPI")) setMode("upi");
                else if (card.label.startsWith("Bank")) setMode("bank");
                else setMode("all");
              }}
              className={cn(CARD, "block min-h-[132px] p-4 transition hover:-translate-y-0.5 hover:border-[#cbd8e8] hover:shadow-[0_14px_34px_rgba(32,55,92,0.08)]")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className={cn("grid h-11 w-11 place-items-center rounded-[12px] border", card.bg)}>{card.icon}</div>
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-black", card.value >= 0 ? "bg-[#e8f9ee] text-[#159447]" : "bg-[#ffecef] text-[#ef3340]")}>
                  {card.value >= 0 ? "Net +" : "Net -"}
                </span>
              </div>
              <p className="mt-3 text-[12px] font-bold text-[#62708a]">{card.label}</p>
              <p className="mt-1 font-display text-[25px] font-black tracking-tight text-[#071333]">{money(Math.abs(card.value))}</p>
              <p className="mt-2 text-[11px] font-semibold text-[#718096]">{card.sub}</p>
            </Link>
          ))}
        </section>

        <section className={cn(CARD, "p-3 sm:p-4")}>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
            <label className="flex min-h-11 items-center gap-2 rounded-[12px] border border-[#dbe4f0] bg-white px-3 text-[#62708a] focus-within:border-[#075fff] focus-within:ring-4 focus-within:ring-[#075fff]/10">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, mobile, bill no, supplier..."
                className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-[#102347] outline-none placeholder:text-[#7a879b]"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {(["today", "week", "month"] as PeriodPreset[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPresetRange(item)}
                  className={cn("h-11 rounded-[12px] border px-4 text-[12px] font-black capitalize transition", preset === item ? "border-[#075fff] bg-[#075fff] text-white shadow-[0_10px_22px_rgba(7,95,255,0.20)]" : "border-[#dbe4f0] bg-white text-[#102347] hover:border-[#b9c8dd]")}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <input type="date" value={range.from} onChange={(event) => { setPreset("week"); setRange((old) => ({ ...old, from: event.target.value })); }} className="h-11 rounded-[12px] border border-[#dbe4f0] bg-white px-3 text-[12px] font-bold text-[#102347]" />
              <input type="date" value={range.to} onChange={(event) => { setPreset("week"); setRange((old) => ({ ...old, to: event.target.value })); }} className="h-11 rounded-[12px] border border-[#dbe4f0] bg-white px-3 text-[12px] font-bold text-[#102347]" />
            </div>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] border border-[#dbe4f0] bg-white px-4 text-[12px] font-black text-[#102347] hover:border-[#b9c8dd]"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : undefined} /> Refresh
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {(["all", "cash", "upi", "bank"] as Array<MoneyStatementMode | "all">).map((item) => (
                <button key={item} type="button" onClick={() => setMode(item)} className={cn("rounded-[10px] border px-3 py-2 text-[11px] font-black uppercase", mode === item ? "border-[#075fff] bg-[#edf4ff] text-[#075fff]" : "border-[#dbe4f0] bg-white text-[#405273]")}>{item}</button>
              ))}
              {(["all", "in", "out"] as Array<MoneyStatementDirection | "all">).map((item) => (
                <button key={item} type="button" onClick={() => setDirection(item)} className={cn("rounded-[10px] border px-3 py-2 text-[11px] font-black uppercase", direction === item ? "border-[#075fff] bg-[#edf4ff] text-[#075fff]" : "border-[#dbe4f0] bg-white text-[#405273]")}>{item === "in" ? "Received" : item === "out" ? "Paid" : "All flow"}</button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => downloadCsv(statement.rows)}
              disabled={statement.rows.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-[11px] bg-[#075fff] px-4 text-[12px] font-black text-white shadow-[0_12px_24px_rgba(7,95,255,0.22)] disabled:opacity-50"
            >
              <Download size={15} /> Export
            </button>
          </div>
        </section>

        <section className={cn(CARD, "overflow-hidden")}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7edf5] px-4 py-4">
            <div>
              <h2 className="font-display text-[19px] font-black text-[#071333]">Cash, UPI & Bank Statement</h2>
              <p className="mt-1 text-[12px] font-semibold text-[#718096]">Every received and paid entry with date, time, party, and payment mode.</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#f3f7fc] px-3 py-1.5 text-[11px] font-black text-[#405273]">
              <CalendarDays size={14} /> {statement.totals.rows} rows
            </span>
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="border-b border-[#e7edf5] bg-[#f8fbff] text-[11px] font-black uppercase text-[#66758c]">
                  <th className="px-4 py-3">Date / Time</th>
                  <th className="px-4 py-3">Who</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3 text-right">Received</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2f8]">
                {statement.rows.map((row) => (
                  <tr key={row.id} className="text-[12px] font-semibold text-[#253854] hover:bg-[#fbfdff]">
                    <td className="px-4 py-3">
                      <p className="font-black text-[#102347]">{row.dateLabel}</p>
                      <p className="text-[11px] text-[#718096]">{row.timeLabel}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-black text-[#102347]">{row.partyName}</p>
                      {row.partyMobile && <p className="text-[11px] text-[#718096]">{row.partyMobile}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-black text-[#102347]">{row.source}</p>
                      <p className="text-[11px] text-[#718096]">{row.reference}</p>
                    </td>
                    <td className="px-4 py-3"><ModeBadge mode={row.mode} /></td>
                    <td className="px-4 py-3 text-right font-black text-[#159447]">{row.direction === "in" ? money(row.amount) : "-"}</td>
                    <td className="px-4 py-3 text-right font-black text-[#ef3340]">{row.direction === "out" ? money(row.amount) : "-"}</td>
                    <td className="px-4 py-3"><span className="rounded-full bg-[#f3f7fc] px-2 py-1 text-[10px] font-black uppercase text-[#62708a]">{row.status || "posted"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-[#edf2f8] lg:hidden">
            {statement.rows.map((row) => (
              <div key={row.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-black text-[#102347]">{row.partyName}</p>
                    <p className="mt-1 text-[11px] font-semibold text-[#718096]">{row.dateLabel} · {row.timeLabel}</p>
                  </div>
                  <p className={cn("text-[17px] font-black", row.direction === "in" ? "text-[#159447]" : "text-[#ef3340]")}>
                    {row.direction === "in" ? "+" : "-"}{money(row.amount)}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ModeBadge mode={row.mode} />
                  <span className="rounded-full bg-[#f3f7fc] px-2 py-1 text-[10px] font-black text-[#62708a]">{row.source}</span>
                  <span className="text-[11px] font-semibold text-[#718096]">{row.reference}</span>
                </div>
              </div>
            ))}
          </div>

          {statement.rows.length === 0 && (
            <div className="grid min-h-[260px] place-items-center px-4 py-10 text-center">
              <div>
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-[16px] bg-[#edf4ff] text-[#075fff]"><Landmark size={24} /></div>
                <p className="mt-4 text-[17px] font-black text-[#102347]">No money movement found</p>
                <p className="mt-1 text-[12px] font-semibold text-[#718096]">Try a different date, mode, or search term.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ModeBadge({ mode }: { mode: MoneyStatementMode }) {
  const styles = {
    cash: "border-[#c8f1d5] bg-[#e7faee] text-[#159447]",
    upi: "border-[#ddd3ff] bg-[#f0ebff] text-[#7047eb]",
    bank: "border-[#cfe0ff] bg-[#eaf2ff] text-[#075fff]",
  }[mode];
  return <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase", styles)}>{mode}</span>;
}
