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
  const refresh = useCallback(async () => {
    const rows = await listGuestRequests().catch(() => [] as RestaurantGuestRequest[]);
    setRequests(rows.filter((row) => row.status === "pending" || row.status === "acknowledged"));
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  if (requests.length === 0) return null;
  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-3">
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
    </section>
  );
}
