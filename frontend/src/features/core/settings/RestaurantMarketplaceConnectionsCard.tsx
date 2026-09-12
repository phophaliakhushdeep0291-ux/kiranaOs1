import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, ShoppingBag } from "lucide-react";
import { useAuth } from "@/features/core/auth/useAuth";
import { apiRequest } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { useShopBusinessProfile } from "./business-profile-bootstrap";
import { useAppLanguage } from "./i18n";
import { Badge, Card, CardHead, Fld } from "./ui";

type Provider = { id: "zomato" | "swiggy"; name: string; implemented: boolean; docsUrl: string };
type Connection = { id: string; provider: string; locationId: string; externalOutletId: string; environment: "sandbox" | "live"; status: "pending" | "verified" };
type Overview = { providers: Provider[]; connections: Connection[]; locations: { id: string; name: string; code: string }[]; inboxEnabled: boolean; liveOrdersSupported: boolean };
type Draft = { provider: Provider; locationId: string; externalOutletId: string; environment: "sandbox" | "live" };

export function RestaurantMarketplaceConnectionsCard() {
  const { user, shop } = useAuth();
  const profile = useShopBusinessProfile();
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const visible = user?.role === "owner" && profile.data?.shop.id === shop?.id && profile.data?.shop.businessType === "restaurant";
  const query = useQuery({
    queryKey: ["restaurant-marketplaces", shop?.id],
    queryFn: () => apiRequest<Overview>("/integrations/restaurant-marketplaces"),
    enabled: visible && Boolean(shop?.id), retry: 1,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (provider: Provider, connection?: Connection) => {
    setDraft({ provider, locationId: connection?.locationId ?? query.data?.locations[0]?.id ?? "", externalOutletId: connection?.externalOutletId ?? "", environment: connection?.environment ?? "sandbox" });
  };
  const selectLocation = (locationId: string) => {
    if (!draft) return;
    const saved = query.data?.connections.find((row) => row.provider === draft.provider.id && row.locationId === locationId);
    setDraft({ ...draft, locationId, externalOutletId: saved?.externalOutletId ?? "", environment: saved?.environment ?? "sandbox" });
  };
  const confirm = async (ownerPin: string) => {
    if (!pending || busy) return;
    setBusy(true); setError(null);
    try {
      await apiRequest(`/integrations/restaurant-marketplaces/${pending.provider.id}`, {
        method: "PUT", ownerPin,
        body: JSON.stringify({ locationId: pending.locationId, externalOutletId: pending.externalOutletId.trim(), environment: pending.environment }),
      });
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: ["restaurant-marketplaces", shop?.id] });
      toast({ title: t("restaurant.marketplace.savedTitle"), description: t("restaurant.marketplace.savedHelp") });
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("restaurant.marketplace.saveFailed")); }
    finally { setBusy(false); }
  };

  if (!visible) return null;
  const existing = query.data?.connections.find((row) => row.provider === draft?.provider.id && row.locationId === draft?.locationId);
  const valid = Boolean(draft?.locationId && /^[A-Za-z0-9_-]{1,80}$/.test(draft.externalOutletId.trim()) && existing?.status !== "verified");

  return <>
    <Card>
      <CardHead icon={<ShoppingBag size={15} />} title={t("restaurant.marketplace.title")} sub={t("restaurant.marketplace.subtitle")} />
      <div className="space-y-4 px-5 pb-5">
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t("restaurant.marketplace.notLive")}</p>
        {query.isLoading ? <p className="flex items-center gap-2 text-sm" role="status"><Loader2 className="animate-spin" size={16} />{t("restaurant.marketplace.loading")}</p>
          : query.isError ? <div role="alert" className="space-y-2"><p className="text-sm text-rose-700">{t("restaurant.marketplace.loadFailed")}</p><Button variant="outline" onClick={() => void query.refetch()}>{t("restaurant.marketplace.retry")}</Button></div>
          : <div className="grid gap-4 lg:grid-cols-2">{query.data?.providers.map((provider) => {
            const connections = query.data.connections.filter((row) => row.provider === provider.id);
            return <section key={provider.id} className="space-y-3 rounded-xl border p-4" aria-label={provider.name}>
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{provider.name}</h3><Badge tone="amber">{t("restaurant.marketplace.notConnected")}</Badge></div>
              <p className="text-sm text-slate-600">{t(`restaurant.marketplace.${provider.id}Help`)}</p>
              {connections.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                <div><p className="font-medium">{query.data.locations.find((location) => location.id === row.locationId)?.name ?? t("restaurant.marketplace.inactiveLocation")}</p><p className="break-all text-xs text-slate-600">{row.externalOutletId} · {t(`restaurant.marketplace.${row.environment}`)}</p><p className="mt-1 text-xs text-amber-800">{t("restaurant.marketplace.detailsSaved")}</p></div>
                <Button size="sm" variant="outline" disabled={row.status === "verified"} onClick={() => edit(provider, row)}>{t("restaurant.marketplace.edit")}</Button>
              </div>)}
              {!query.data.locations.length && <p className="text-sm text-slate-600">{t("restaurant.marketplace.noLocation")}</p>}
              <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!query.data.locations.length} onClick={() => edit(provider)}>{t("restaurant.marketplace.saveDetails")}</Button><Button variant="outline" asChild><a href={provider.docsUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />{t("restaurant.marketplace.partnerPortal")}</a></Button></div>
            </section>;
          })}</div>}
        <p className="text-xs text-slate-500">{t("restaurant.marketplace.noSecrets")}</p>
      </div>
    </Card>
    <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) setDraft(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{t("restaurant.marketplace.formTitle", { provider: draft?.provider.name ?? "" })}</DialogTitle><DialogDescription>{t("restaurant.marketplace.savedHelp")}</DialogDescription></DialogHeader>
        {draft && <div className="space-y-4">
          <Fld label={t("restaurant.marketplace.location")}><select aria-label={t("restaurant.marketplace.location")} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.locationId} onChange={(event) => selectLocation(event.target.value)}>{query.data?.locations.map((location) => <option key={location.id} value={location.id}>{location.name} ({location.code})</option>)}</select></Fld>
          <Fld label={t("restaurant.marketplace.outletId")} hint={t("restaurant.marketplace.outletHelp")}><Input aria-label={t("restaurant.marketplace.outletId")} autoComplete="off" maxLength={80} value={draft.externalOutletId} onChange={(event) => setDraft({ ...draft, externalOutletId: event.target.value })} /></Fld>
          <Fld label={t("restaurant.marketplace.environment")}><select aria-label={t("restaurant.marketplace.environment")} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.environment} onChange={(event) => setDraft({ ...draft, environment: event.target.value as Draft["environment"] })}><option value="sandbox">{t("restaurant.marketplace.sandbox")}</option><option value="live">{t("restaurant.marketplace.live")}</option></select></Fld>
        </div>}
        <DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>{t("restaurant.marketplace.cancel")}</Button><Button disabled={!valid} onClick={() => { setPending(draft); setDraft(null); setError(null); }}>{t("restaurant.marketplace.saveDetails")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <OwnerPinModal open={Boolean(pending)} title={t("restaurant.marketplace.approve")} description={t("restaurant.marketplace.savedHelp")} confirmLabel={t("restaurant.marketplace.saveDetails")} loading={busy} error={error} onCancel={() => { if (!busy) setPending(null); }} onConfirm={({ ownerPin }) => confirm(ownerPin)} />
  </>;
}
