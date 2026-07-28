import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  BadgeCheck,
  ChevronRight,
  Circle,
  FileText,
  PackagePlus,
  Printer,
  ReceiptText,
  Settings,
  Store,
  Truck,
  UsersRound,
} from "lucide-react";
import { offlineDB } from "@/lib/offline/db";
import type { Shop } from "@/types/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsShell } from "../SettingsShell";
import { Badge, Card, CardHead } from "../ui";
import { useSettingsPrefs } from "../use-settings-prefs";
import {
  MERCHANT_SETUP_KEY,
  buildMerchantSetupProgress,
  normaliseMerchantSetupState,
  type MerchantSetupFacts,
  type MerchantSetupState,
  type MerchantSetupStep,
  type MerchantSetupStepId,
} from "../merchant-setup-state";

const STEP_ICONS: Record<MerchantSetupStepId, typeof Store> = {
  "store-profile": Store,
  taxes: ReceiptText,
  billing: Settings,
  printer: Printer,
  products: PackagePlus,
  customers: UsersRound,
  suppliers: Truck,
  "first-bill": FileText,
};

const EMPTY_FACTS: MerchantSetupFacts = {
  storeProfileReady: false,
  productCount: 0,
  customerCount: 0,
  supplierCount: 0,
  billCount: 0,
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isStoreProfileReady(shop?: Shop | null, prefs?: Record<string, unknown>) {
  const profile = (prefs?.storeProfile && typeof prefs.storeProfile === "object" ? prefs.storeProfile : {}) as Record<string, unknown>;
  const name = text(shop?.name) || text(profile.name) || text(profile.storeName);
  const phone = text(shop?.phone) || text(profile.phone) || text(profile.mobile) || text(profile.mobileNumber);
  const address = text(shop?.address) || text(shop?.city) || text(profile.address) || text(profile.city);
  return Boolean(name && phone && address);
}

async function loadFacts(shop?: Shop | null, prefs?: Record<string, unknown>): Promise<MerchantSetupFacts> {
  const [products, customers, suppliers, bills] = await Promise.all([
    offlineDB.getAll("products").catch(() => []),
    offlineDB.getAll("customers").catch(() => []),
    offlineDB.getAll("suppliers").catch(() => []),
    offlineDB.getAll("bills").catch(() => []),
  ]);
  return {
    storeProfileReady: isStoreProfileReady(shop, prefs),
    productCount: products.length,
    customerCount: customers.length,
    supplierCount: suppliers.length,
    billCount: bills.length,
  };
}

function ReadyPill({ step }: { step: MerchantSetupStep }) {
  if (step.complete) return <Badge tone={step.skipped ? "gray" : "green"}>{step.skipped ? "Skipped" : "Ready"}</Badge>;
  return <Badge tone={step.required ? "amber" : "gray"}>{step.required ? "Needed" : "Optional"}</Badge>;
}

export default function MerchantSetupPage() {
  const [, navigate] = useLocation();
  const { prefs, shop, hydrated } = useSettingsPrefs();
  const [facts, setFacts] = useState<MerchantSetupFacts>(EMPTY_FACTS);
  const [state, setState] = useState<MerchantSetupState>(() => normaliseMerchantSetupState(null));
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [savedState, nextFacts] = await Promise.all([
      offlineDB.getSetting<MerchantSetupState>(MERCHANT_SETUP_KEY).catch(() => null),
      loadFacts(shop, prefs as Record<string, unknown>).catch(() => EMPTY_FACTS),
    ]);
    setState(normaliseMerchantSetupState(savedState));
    setFacts(nextFacts);
    setLoading(false);
  }, [prefs, shop]);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

  useEffect(() => {
    const onLocalChange = () => void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("kirana:local-data-changed", onLocalChange);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("kirana:local-data-changed", onLocalChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const progress = useMemo(() => buildMerchantSetupProgress(facts, state), [facts, state]);

  const saveState = useCallback(async (updater: (current: MerchantSetupState) => MerchantSetupState) => {
    const next = updater(state);
    setState(next);
    await offlineDB.setSetting(MERCHANT_SETUP_KEY, next);
  }, [state]);

  const openStep = useCallback(async (step: MerchantSetupStep) => {
    await saveState((current) => ({ ...current, lastStepId: step.id, updatedAt: new Date().toISOString() }));
    navigate(step.href);
  }, [navigate, saveState]);

  const confirmStep = useCallback(async (id: MerchantSetupStepId) => {
    await saveState((current) => ({
      ...current,
      confirmed: { ...current.confirmed, [id]: true },
      skipped: { ...current.skipped, [id]: false },
      lastStepId: id,
      updatedAt: new Date().toISOString(),
    }));
  }, [saveState]);

  const skipStep = useCallback(async (id: MerchantSetupStepId) => {
    await saveState((current) => ({
      ...current,
      skipped: { ...current.skipped, [id]: true },
      lastStepId: id,
      updatedAt: new Date().toISOString(),
    }));
  }, [saveState]);

  const continueStep = progress.nextStep;

  return (
    <SettingsShell>
      <Card className="border-[var(--brand-border)] bg-white">
        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[1fr_260px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={progress.requiredComplete ? "green" : "blue"}>
                <BadgeCheck size={12} /> {progress.requiredComplete ? "Ready to bill" : "Setup in progress"}
              </Badge>
              <span className="text-[12px] font-semibold text-[#64748b]">
                {progress.completedCount} of {progress.totalCount} checks complete
              </span>
            </div>
            <h2 className="mt-3 font-display text-[24px] font-black tracking-tight text-[#071735]">Merchant setup</h2>
            <p className="mt-1 max-w-[720px] text-[13px] leading-6 text-[#52627e]">
              A production shop should not discover missing GST, printer, product, or udhar setup while serving a customer.
              This checklist uses real local data and only marks important items ready after they are actually configured or confirmed.
            </p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#eef2f8]">
              <div
                className="h-full rounded-full bg-[var(--brand)] transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-col justify-between rounded-[12px] border border-[#e7edf7] bg-[#f8fbff] p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748b]">Next best action</p>
              <p className="mt-1 text-[15px] font-black text-[#102347]">{continueStep?.title ?? "Run a final bill test"}</p>
              <p className="mt-1 text-[12px] text-[#64748b]">{continueStep?.detail ?? "Your setup checks are complete."}</p>
            </div>
            <Button
              className="mt-4 w-full rounded-[9px] bg-[var(--brand)] text-white hover:bg-[#004bd1]"
              onClick={() => continueStep ? void openStep(continueStep) : navigate("/billing")}
            >
              Continue setup <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHead title="Launch checklist" sub={loading ? "Checking local data..." : "Use this before giving the shop to a real cashier."} />
          <div className="divide-y divide-[#eef2f8] px-4 pb-4">
            {progress.steps.map((step) => {
              const Icon = STEP_ICONS[step.id];
              return (
                <div key={step.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="flex min-w-0 gap-3">
                    <span
                      className={cn(
                        "grid h-10 w-10 shrink-0 place-items-center rounded-[10px]",
                        step.complete ? "bg-[#e6f7ee] text-[#16a34a]" : step.required ? "bg-[#fff7e8] text-[#d97706]" : "bg-[var(--brand-soft)] text-[var(--brand)]",
                      )}
                    >
                      {step.complete ? <BadgeCheck size={18} /> : <Icon size={18} />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="font-display text-[15px] font-black text-[#102347]">{step.title}</h3>
                        <ReadyPill step={step} />
                      </div>
                      <p className="mt-1 text-[12px] leading-5 text-[#64748b]">{step.description}</p>
                      <p className="mt-1 text-[12px] font-bold text-[#344668]">{step.detail}</p>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-2 md:justify-end">
                    {step.confirmable && !step.complete && (
                      <Button variant="outline" className="rounded-[8px]" onClick={() => void confirmStep(step.id)}>
                        Mark ready
                      </Button>
                    )}
                    {step.skippable && !step.complete && (
                      <Button variant="outline" className="rounded-[8px]" onClick={() => void skipStep(step.id)}>
                        Not needed
                      </Button>
                    )}
                    <Button className="rounded-[8px] bg-[var(--brand)] text-white hover:bg-[#004bd1]" onClick={() => void openStep(step)}>
                      {step.actionLabel}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHead title="Readiness summary" sub="Actual local counts, not demo numbers." />
            <div className="space-y-3 px-5 pb-5">
              {[
                ["Products", facts.productCount],
                ["Customers", facts.customerCount],
                ["Suppliers", facts.supplierCount],
                ["Bills created", facts.billCount],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-[10px] border border-[#eef2f8] px-3 py-2">
                  <span className="text-[12px] font-semibold text-[#64748b]">{label}</span>
                  <span className="font-display text-[18px] font-black text-[#102347]">{value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead title="Production guardrails" sub="What this setup prevents." />
            <div className="space-y-2 px-5 pb-5">
              {[
                "Bills without shop identity or mobile number.",
                "Products missing units, pack sizes, or import review.",
                "Wrong receipt behavior at the counter.",
                "Udhar or purchase workflows used before owner review.",
              ].map((item) => (
                <div key={item} className="flex gap-2 rounded-[10px] bg-[#f8fbff] px-3 py-2">
                  <Circle size={8} className="mt-1.5 shrink-0 fill-[var(--brand)] text-[var(--brand)]" />
                  <p className="text-[12px] leading-5 text-[#52627e]">{item}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </SettingsShell>
  );
}
