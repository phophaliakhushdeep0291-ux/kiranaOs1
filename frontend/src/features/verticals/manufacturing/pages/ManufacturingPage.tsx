import { useLocation } from "wouter";
import {
  ArrowRight,
  Boxes,
  ChartNoAxesCombined,
  ClipboardList,
  Factory,
  PackageCheck,
  ScanLine,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageShell } from "@/components/shared/PageShell";

interface OperationLink {
  title: string;
  helper: string;
  href: string;
  icon: LucideIcon;
  tone: string;
  badge: string;
}

const OPERATION_LINKS: OperationLink[] = [
  {
    title: "Materials & stock",
    helper: "Raw material, work-in-progress and finished-goods balances.",
    href: "/inventory",
    icon: Boxes,
    tone: "bg-cyan-50 text-cyan-700 ring-cyan-100",
    badge: "Live stock",
  },
  {
    title: "Purchase & receive",
    helper: "Raise purchase orders and receive supplier batches with rate checks.",
    href: "/purchase-bills",
    icon: ShoppingCart,
    tone: "bg-amber-50 text-amber-700 ring-amber-100",
    badge: "GRN ready",
  },
  {
    title: "Batch traceability",
    helper: "Review batch numbers, manufactured dates, expiry and available quantity.",
    href: "/inventory/lots",
    icon: ScanLine,
    tone: "bg-violet-50 text-violet-700 ring-violet-100",
    badge: "Lot control",
  },
  {
    title: "Items & packaging",
    helper: "Maintain raw materials, packaging SKUs, units and wholesale prices.",
    href: "/products",
    icon: PackageCheck,
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    badge: "Catalog",
  },
  {
    title: "Dispatch invoice",
    helper: "Build a tax-ready dispatch bill with controlled pricing and payments.",
    href: "/billing",
    icon: Truck,
    tone: "bg-blue-50 text-blue-700 ring-blue-100",
    badge: "Counter",
  },
  {
    title: "Sales orders",
    helper: "Track wholesale and customer orders before dispatch and billing.",
    href: "/orders",
    icon: ClipboardList,
    tone: "bg-rose-50 text-rose-700 ring-rose-100",
    badge: "Order desk",
  },
];

export default function ManufacturingPage() {
  const [, navigate] = useLocation();

  return (
    <PageShell className="space-y-4 px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5" data-testid="manufacturing-page">
      <PageHeader
        title="Factory operations"
        description="One phone-first workspace for purchasing, material control, batches, packaging, wholesale dispatch and operational reporting."
        eyebrow="Manufacturing · Wholesale · Export"
      />

      <section className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#062f34_0%,#075c62_58%,#0f766e_100%)] p-4 text-white shadow-[0_18px_45px_rgba(6,78,83,0.22)] sm:p-5 lg:p-6">
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
              <Factory size={22} aria-hidden="true" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100">Operations control</p>
            <h2 className="mt-1 font-display text-[clamp(1.35rem,1rem+1.4vw,2rem)] font-black leading-tight">
              Move material in. Keep every batch accountable. Dispatch with confidence.
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-cyan-50/85">
              Existing KiranaOS stock, purchasing, lot and billing controls stay connected—without duplicating inventory or financial records.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/reports")}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-[#075c62] shadow-sm transition-transform active:scale-[0.99] sm:w-auto"
          >
            <ChartNoAxesCombined size={17} /> Operations reports <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <section aria-labelledby="manufacturing-workflows-title">
        <div className="mb-2.5 flex items-end justify-between gap-3">
          <div>
            <h2 id="manufacturing-workflows-title" className="font-display text-lg font-black text-[var(--brand-ink)]">Run the floor</h2>
            <p className="text-xs leading-5 text-[#64748b]">Each action opens the system of record already used by your team.</p>
          </div>
          <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700 sm:inline">Connected workflows</span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {OPERATION_LINKS.map(({ title, helper, href, icon: Icon, tone, badge }) => (
            <button
              key={href}
              type="button"
              onClick={() => navigate(href)}
              className="group min-h-[118px] rounded-2xl border border-[#e2eaf4] bg-white p-3.5 text-left shadow-[0_7px_22px_rgba(15,35,70,0.055)] transition-all hover:-translate-y-0.5 hover:border-[#cbd9ea] hover:shadow-[0_12px_28px_rgba(15,35,70,0.09)] active:translate-y-0"
            >
              <div className="flex items-start gap-3">
                <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${tone}`}>
                  <Icon size={19} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-display text-[15px] font-black text-[var(--brand-ink)]">{title}</span>
                    <ArrowRight size={15} className="shrink-0 text-[#94a3b8] transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-1 block text-[12px] leading-5 text-[#64748b]">{helper}</span>
                  <span className="mt-2 inline-flex rounded-full bg-[#f3f6fa] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#52627a]">{badge}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
