import { useCallback, useEffect, useState } from "react";
import { Bell, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useToast } from "@/hooks/use-toast";
import { listGuestRequests, setGuestRequestStatus, type RestaurantGuestRequest } from "../../service/restaurant-api";

export function GuestRequestsStrip() {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [requests, setRequests] = useState<RestaurantGuestRequest[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const rows = await listGuestRequests();
      setRequests(rows.filter((row) => row.status === "pending" || row.status === "acknowledged"));
      setLoadFailed(false);
    } catch {
      // Keep the last visible requests. An outage must not look like every
      // waiter/bill request was completed while nobody was watching.
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);
  if (requests.length === 0 && !loadFailed) return null;
  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-3" data-testid="guest-requests-strip">
      {loadFailed ? <div role="alert" className="mb-2 rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-semibold text-amber-900">{t("restaurant.guest.requestsStale")} <button type="button" className="ml-1 min-h-11 underline" onClick={() => void refresh()}>{t("restaurant.guest.retryNow")}</button></div> : null}
      {requests.length > 0 ? <>
      <h2 className="mb-2 text-xs font-black uppercase tracking-wider text-amber-900">{t("restaurant.guest.requests")}</h2>
      <div className="flex flex-wrap gap-2">
        {requests.map((request) => (
          <div key={request.id} className="flex min-w-64 flex-1 items-center gap-2 rounded-xl bg-white p-3 shadow-sm">
            {request.type === "bill" ? <Receipt size={18} /> : <Bell size={18} />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{request.tableName} · {t(request.type === "bill" ? "restaurant.guest.bill" : "restaurant.guest.waiter")}</p>
              {request.reason ? <p className="truncate text-xs text-slate-500">{request.reason}</p> : null}
            </div>
            <Button size="sm" disabled={busy !== null} onClick={async () => {
              setBusy(request.id);
              try { await setGuestRequestStatus(request.id, request.status === "pending" ? "acknowledged" : "completed"); await refresh(); }
              catch { toast({ title: t("restaurant.guest.requestFailed"), variant: "destructive" }); }
              finally { setBusy(null); }
            }}>
              {t(request.status === "pending" ? "restaurant.guest.acknowledge" : "restaurant.guest.done")}
            </Button>
          </div>
        ))}
      </div>
      </> : null}
    </section>
  );
}
