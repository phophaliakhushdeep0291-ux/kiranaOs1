import { useCallback, useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { clearDemoShopData, hasDemoData } from "@/features/core/demo/demo-shop-data";

/**
 * Thin banner shown while local-only demo sample data is present (seeded for brand-new shops
 * so the first screen isn't blank). "Clear & start fresh" removes every demo record. Renders
 * nothing once the shop has only real data.
 */
export function DemoModeBanner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void hasDemoData().then(setActive).catch(() => setActive(false));
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener("kirana:local-data-changed", onChange);
    return () => window.removeEventListener("kirana:local-data-changed", onChange);
  }, [refresh]);

  if (!active) return null;

  const startFresh = async () => {
    setBusy(true);
    try {
      const { removed } = await clearDemoShopData();
      await queryClient.invalidateQueries();
      setActive(false);
      toast({ title: "Started fresh", description: `Cleared ${removed} sample records. Add your own products to begin.` });
    } catch {
      toast({ title: "Could not clear demo data", description: "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
      <Sparkles size={15} className="shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-tight">
        You're exploring with <strong>sample data</strong>. It stays only on this device.
      </p>
      <button
        type="button"
        onClick={() => void startFresh()}
        disabled={busy}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-[12px] font-bold text-white hover:bg-amber-700 disabled:opacity-50"
      >
        <X size={13} aria-hidden="true" /> {busy ? "Clearing…" : "Clear & start fresh"}
      </button>
    </div>
  );
}
