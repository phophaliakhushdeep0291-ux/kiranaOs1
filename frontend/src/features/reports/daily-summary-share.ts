import type { DailyClosingReport } from "@/features/reports/local-reporting";

// "Aaj ka Hisaab" — a glanceable end-of-day summary the owner can send to themselves or their
// accountant on WhatsApp (free wa.me deep link, no number = chat picker). Pure + testable.

function rupees(n: number): string {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Which sections to include — driven by Settings → Notifications → Daily Summary. Omitted = include. */
export interface DailyClosingShareSections {
  sales?: boolean;
  profit?: boolean;
  cashUpi?: boolean;
  udhar?: boolean;
}

export interface DailyClosingShareInput {
  report: DailyClosingReport;
  shopName?: string;
  include?: DailyClosingShareSections;
}

/** WhatsApp-friendly daily summary text (proportional font, emoji bullets). */
export function buildDailyClosingShareText({ report, shopName, include }: DailyClosingShareInput): string {
  // Each section defaults to ON; a section is dropped only when explicitly disabled in settings.
  const show = {
    sales: include?.sales !== false,
    profit: include?.profit !== false,
    cashUpi: include?.cashUpi !== false,
    udhar: include?.udhar !== false,
  };
  const lines: string[] = [];
  lines.push(`📊 *Aaj ka Hisaab* — ${shopName || "My Shop"}`);
  lines.push(formatDate(report.date));
  if (report.isLocalEstimate) lines.push("_(some bills still backing up — figures may update)_");
  lines.push("");
  if (show.sales) lines.push(`💰 Sales: *${rupees(report.totalSales)}*${report.billCount > 0 ? ` (${report.billCount} ${report.billCount === 1 ? "bill" : "bills"})` : ""}`);
  if (show.profit) lines.push(`📈 Profit: *${rupees(report.profitEstimate)}*`);
  lines.push("");
  if (show.cashUpi) {
    lines.push(`🪙 Cash in: ${rupees(report.cashReceived)}`);
    lines.push(`📲 UPI in: ${rupees(report.upiReceived)}`);
  }
  if (show.udhar && report.udharGiven > 0.005) lines.push(`📒 Udhar given: ${rupees(report.udharGiven)}`);
  if (show.udhar && report.oldUdharPaymentReceived > 0.005) lines.push(`✅ Old udhar recovered: ${rupees(report.oldUdharPaymentReceived)}`);
  if (report.purchaseCashPaid > 0.005) lines.push(`🛒 Supplier cash paid: ${rupees(report.purchaseCashPaid)}`);
  lines.push("");
  lines.push(`👜 Cash in drawer: *${rupees(report.expectedCashInDrawer)}*`);

  const topProducts = (report.topSoldProducts ?? []).slice(0, 3);
  if (topProducts.length > 0) {
    lines.push("");
    lines.push("🏆 Top sellers:");
    for (const p of topProducts) {
      lines.push(`• ${p.name} — ${rupees(p.revenue)}`);
    }
  }
  lines.push("");
  lines.push("_via Veyra_");
  return lines.join("\n");
}

export function buildDailyClosingShareUrl(input: DailyClosingShareInput): string {
  return `https://wa.me/?text=${encodeURIComponent(buildDailyClosingShareText(input))}`;
}

export function shareDailyClosingOnWhatsapp(input: DailyClosingShareInput): void {
  if (typeof window !== "undefined") {
    window.open(buildDailyClosingShareUrl(input), "_blank", "noopener,noreferrer");
  }
}
