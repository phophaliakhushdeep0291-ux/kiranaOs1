import { useMemo, useState } from "react";
import {
  useListSuppliers, useCreateSupplier, useUpdateSupplier, useDeleteSupplier,
  getListSuppliersQueryKey, type Supplier
} from "@/lib/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Pencil, Loader2, Phone, MapPin, Trash2, FileText, AlertTriangle, CheckCircle2, RefreshCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { TradeFocusStrip } from "@/components/shared";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useBusinessTypeKey } from "@/features/core/settings/business-types";
import { getShopSuppliersProfile } from "@/features/core/settings/shop-suppliers";
import { getSupplierStatement, rebuildSupplierStatement } from "@/features/core/suppliers/api";
import { formatMoney } from "@/lib/money";

// Validation messages are dictionary keys rather than sentences: the schema is
// built inside the component so it can resolve them, since a module-level schema
// would be frozen in whichever language happened to load first.
function supplierSchema(message: (key: "nameRequired" | "gstinInvalid") => string) {
  return z.object({
    name: z.string().min(1, message("nameRequired")),
    mobile: z.string().optional(),
    address: z.string().optional(),
    // Validated here too so a typo is caught at the keyboard, not by the server:
    // the first two digits pick which government receives the input tax credit.
    gstin: z.string().trim().optional().refine((v) => !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v.toUpperCase()), message("gstinInvalid")),
  });
}
type FormData = z.infer<ReturnType<typeof supplierSchema>>;

export default function Suppliers() {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // A chemist buys from distributors and a factory from vendors — the plural
  // goes in counts and empty states, the singular in buttons and dialog titles.
  const tradeProfile = getShopSuppliersProfile(useBusinessTypeKey());
  const plural = t(tradeProfile.pluralWordKey);
  const singular = t(tradeProfile.singularWordKey);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [statementTarget, setStatementTarget] = useState<Supplier | null>(null);
  const [repairStatement, setRepairStatement] = useState(false);
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");

  const suppliers = useListSuppliers();
  const statementQuery = useQuery({
    queryKey: ["supplier-statement", statementTarget?.id, statementFrom, statementTo],
    queryFn: () => getSupplierStatement(statementTarget!.id, { from: statementFrom || undefined, to: statementTo || undefined }),
    enabled: Boolean(statementTarget),
    staleTime: 2_000,
    refetchOnWindowFocus: true,
  });

  const repairMutation = useMutation({
    mutationFn: (ownerPin: string) => rebuildSupplierStatement(statementTarget!.id, ownerPin),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["supplier-statement", statementTarget?.id] });
      setRepairStatement(false);
      toast({
        title: result.repairIncomplete
          ? t("suppliers.statement.repairMore", { count: result.repairedPurchaseCount })
          : result.repairedPurchaseCount
          ? t("suppliers.statement.repaired", { count: result.repairedPurchaseCount })
          : t("suppliers.statement.noRepairNeeded"),
      });
    },
  });

  const schema = useMemo(
    () => supplierSchema((key) => t(key === "nameRequired" ? "suppliers.form.nameRequired" : "suppliers.form.gstinInvalid")),
    [t],
  );
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", mobile: "", address: "", gstin: "" },
  });

  const failed = (err: unknown) =>
    (err as { data?: { message?: string } })?.data?.message ?? t("suppliers.toast.failed");

  const createSupplier = useCreateSupplier({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
        setOpen(false); form.reset();
        toast({ title: t("suppliers.toast.added", { supplier: singular }) });
      },
      onError: (err: unknown) => toast({ title: t("suppliers.toast.error"), description: failed(err), variant: "destructive" }),
    },
  });

  const updateSupplier = useUpdateSupplier({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
        setOpen(false); setEditing(null); form.reset();
        toast({ title: t("suppliers.toast.updated", { supplier: singular }) });
      },
      onError: (err: unknown) => toast({ title: t("suppliers.toast.error"), description: failed(err), variant: "destructive" }),
    },
  });

  const deleteSupplier = useDeleteSupplier({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
        setDeleteTarget(null);
        toast({ title: t("suppliers.toast.recycled", { supplier: singular }) });
      },
      onError: (err: unknown) => toast({
        title: t("suppliers.toast.deleteBlocked"),
        description: (err as { data?: { message?: string }; message?: string })?.data?.message
          ?? (err as { message?: string })?.message
          ?? t("suppliers.toast.ownerPinRequired"),
        variant: "destructive",
      }),
    },
  });

  const openEdit = (s: Supplier) => {
    setEditing(s);
    form.reset({ name: s.name, mobile: s.mobile ?? "", address: s.address ?? "", gstin: s.gstin ?? "" });
    setOpen(true);
  };

  const openAdd = () => {
    setEditing(null);
    form.reset({ name: "", mobile: "", address: "", gstin: "" });
    setOpen(true);
  };

  const onSubmit = (values: FormData) => {
    const data = { name: values.name, mobile: values.mobile || undefined, address: values.address || undefined, gstin: values.gstin ? values.gstin.toUpperCase() : null };
    if (editing) {
      updateSupplier.mutate({ id: editing.id, data });
    } else {
      createSupplier.mutate({ data });
    }
  };

  const filtered = (suppliers.data ?? []).filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.mobile?.includes(search)
  );
  const total = suppliers.data?.length ?? 0;

  return (
    <div className="p-6 w-full max-w-none">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t(tradeProfile.headingKey)}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {total === 1 ? t("suppliers.count.one", { supplier: plural }) : t("suppliers.count.many", { count: total, supplier: plural })}
          </p>
        </div>
        <Button data-testid="button-add-supplier" onClick={openAdd}>
          <Plus size={16} className="mr-1.5" />{t("suppliers.add", { supplier: singular })}
        </Button>
      </div>

      <TradeFocusStrip
        titleKey="suppliers.trade.title"
        focusKey={tradeProfile.focusKey}
        links={tradeProfile.links}
        className="mb-5"
      />

      <div className="relative mb-5">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input data-testid="input-search" className="pl-9" placeholder={t("suppliers.search.placeholder")} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {suppliers.isLoading ? (
        <div className="grid gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border rounded-xl p-12 text-center text-muted-foreground">
          {search ? t("suppliers.empty.noMatch", { supplier: plural }) : t("suppliers.empty.none", { supplier: plural })}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((s) => (
            <div key={s.id} data-testid={`card-supplier-${s.id}`} className="bg-card border rounded-xl p-4 flex items-center justify-between hover:shadow-sm transition-shadow">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground">{s.name}</p>
                <div className="flex flex-wrap gap-3 mt-1">
                  {s.mobile && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone size={11} />{s.mobile}
                    </span>
                  )}
                  {s.address && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin size={11} />{s.address}
                    </span>
                  )}
                </div>
              </div>
              {/* These were two 31px icon buttons a thumb's width apart, neither
                  carrying a name — a screen reader heard "button, button", and a
                  finger aiming at Edit could take Delete with it. Both are now
                  full 44px targets, named, and separated by enough space that
                  missing one does not mean hitting the other. */}
              <div className="ml-2 flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  data-testid={`button-statement-${s.id}`}
                  onClick={() => setStatementTarget(s)}
                  aria-label={t("suppliers.row.statement", { name: s.name })}
                  className="grid h-11 w-11 place-items-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground active:scale-95"
                >
                  <FileText size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-testid={`button-edit-${s.id}`}
                  onClick={() => openEdit(s)}
                  aria-label={t("suppliers.row.edit", { name: s.name })}
                  className="grid h-11 w-11 place-items-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground active:scale-95"
                >
                  <Pencil size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-testid={`button-delete-${s.id}`}
                  onClick={() => setDeleteTarget(s)}
                  aria-label={t("suppliers.row.delete", { name: s.name })}
                  className="grid h-11 w-11 place-items-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive active:scale-95"
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? t("suppliers.form.editTitle", { supplier: singular }) : t("suppliers.form.addTitle", { supplier: singular })}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div>
              <Label>{t("suppliers.form.name")}</Label>
              <Input data-testid="input-supplier-name" className="mt-1" placeholder={t("suppliers.form.namePlaceholder")} {...form.register("name")} />
              {form.formState.errors.name && <p className="text-destructive text-xs mt-1">{form.formState.errors.name.message}</p>}
            </div>
            <div>
              <Label>{t("suppliers.form.mobile")}</Label>
              <Input data-testid="input-supplier-mobile" className="mt-1" placeholder="9876543210" {...form.register("mobile")} />
            </div>
            <div>
              <Label>{t("suppliers.form.address")}</Label>
              <Input data-testid="input-supplier-address" className="mt-1" placeholder={t("suppliers.form.address")} {...form.register("address")} />
            </div>
            <div>
              <Label>{t("suppliers.form.gstin")}</Label>
              <Input data-testid="input-supplier-gstin" className="mt-1 uppercase" placeholder="27AAECS1234F1Z5" maxLength={15} {...form.register("gstin")} />
              {form.formState.errors.gstin && <p className="text-destructive text-xs mt-1">{form.formState.errors.gstin.message}</p>}
              <p className="text-muted-foreground text-xs mt-1">{t("suppliers.form.gstinHelp")}</p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => { setOpen(false); setEditing(null); }}>{t("suppliers.form.cancel")}</Button>
              <Button type="submit" className="flex-1" disabled={createSupplier.isPending || updateSupplier.isPending}>
                {createSupplier.isPending || updateSupplier.isPending ? <Loader2 size={14} className="animate-spin" /> : editing ? t("suppliers.form.save") : t("suppliers.form.addAction")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(statementTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !repairMutation.isPending) {
            setStatementTarget(null);
            setRepairStatement(false);
            setStatementFrom("");
            setStatementTo("");
          }
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("suppliers.statement.title", { name: statementTarget?.name ?? "" })}</DialogTitle>
          </DialogHeader>

          {statementQuery.isPending ? (
            <div className="space-y-3 py-3" aria-label={t("suppliers.statement.loading")}>
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          ) : statementQuery.isError ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-bold">{t("suppliers.statement.unavailable")}</p>
                  <p className="mt-1">{t("suppliers.statement.onlineRequired")}</p>
                  <Button className="mt-3" size="sm" variant="outline" onClick={() => void statementQuery.refetch()}>
                    <RefreshCcw size={14} className="mr-1.5" />{t("suppliers.statement.retry")}
                  </Button>
                </div>
              </div>
            </div>
          ) : statementQuery.data ? (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="supplier-statement-from">{t("suppliers.statement.from")}</Label>
                  <Input id="supplier-statement-from" type="date" className="mt-1" value={statementFrom} max={statementTo || undefined} onChange={(event) => setStatementFrom(event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="supplier-statement-to">{t("suppliers.statement.to")}</Label>
                  <Input id="supplier-statement-to" type="date" className="mt-1" value={statementTo} min={statementFrom || undefined} onChange={(event) => setStatementTo(event.target.value)} />
                </div>
              </div>
              <div className={`rounded-xl border p-4 ${statementQuery.data.reconciliationStatus === "balanced" ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2">
                    {statementQuery.data.reconciliationStatus === "balanced"
                      ? <CheckCircle2 size={20} className="mt-0.5 text-emerald-700" aria-hidden="true" />
                      : <AlertTriangle size={20} className="mt-0.5 text-amber-700" aria-hidden="true" />}
                    <div>
                      <p className="font-bold">
                        {statementQuery.data.reconciliationStatus === "balanced"
                          ? t("suppliers.statement.balanced")
                          : t("suppliers.statement.attention")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("suppliers.statement.coverage", {
                          linked: statementQuery.data.coverage.linkedPurchaseCount,
                          unlinked: statementQuery.data.coverage.unlinkedPurchaseCount,
                        })}
                      </p>
                    </div>
                  </div>
                  {statementQuery.data.reconciliationStatus !== "balanced" ? (
                    <Button size="sm" variant="outline" onClick={() => setRepairStatement(true)}>
                      <RefreshCcw size={14} className="mr-1.5" />{t("suppliers.statement.repair")}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  [t("suppliers.statement.currentDue"), statementQuery.data.currentBalancePaise],
                  [t("suppliers.statement.purchaseDue"), statementQuery.data.operationalDuePaise],
                  [t("suppliers.statement.opening"), statementQuery.data.openingBalancePaise],
                  [t("suppliers.statement.difference"), statementQuery.data.differencePaise],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border bg-card p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-lg font-black">{formatMoney(Number(value) / 100)}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">{t("suppliers.statement.date")}</th>
                      <th className="px-3 py-2">{t("suppliers.statement.reference")}</th>
                      <th className="px-3 py-2 text-right">{t("suppliers.statement.purchase")}</th>
                      <th className="px-3 py-2 text-right">{t("suppliers.statement.paid")}</th>
                      <th className="px-3 py-2 text-right">{t("suppliers.statement.change")}</th>
                      <th className="px-3 py-2 text-right">{t("suppliers.statement.balance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statementQuery.data.rows.length ? statementQuery.data.rows.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="whitespace-nowrap px-3 py-2">{new Date(row.businessDate).toLocaleDateString()}</td>
                        <td className="max-w-[220px] truncate px-3 py-2 font-medium">{row.reference}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(row.purchasePaise / 100)}</td>
                        <td className="px-3 py-2 text-right">{formatMoney((row.immediatePaymentPaise + row.settlementPaise + row.creditPaise) / 100)}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(row.payableChangePaise / 100)}</td>
                        <td className="px-3 py-2 text-right font-bold">{formatMoney(row.balancePaise / 100)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">{t("suppliers.statement.empty")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {statementQuery.data.hasMore ? <p className="text-xs text-muted-foreground">{t("suppliers.statement.more")}</p> : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <OwnerPinModal
        open={repairStatement}
        title={t("suppliers.statement.repairTitle")}
        description={t("suppliers.statement.repairDescription")}
        confirmLabel={t("suppliers.statement.repairConfirm")}
        loading={repairMutation.isPending}
        error={repairMutation.isError ? failed(repairMutation.error) : null}
        onCancel={() => { if (!repairMutation.isPending) setRepairStatement(false); }}
        // Awaited, not fired and forgotten: OwnerPinModal keys its own close on the
        // returned promise. The repair RESULT is not part of that contract, and
        // returning it made the handler Promise<{...}> where the modal wants
        // Promise<void> — which failed the typecheck and the release gate with it.
        onConfirm={async ({ ownerPin }) => { await repairMutation.mutateAsync(ownerPin); }}
      />

      <OwnerPinModal
        open={Boolean(deleteTarget)}
        title={t("suppliers.delete.title")}
        description={t("suppliers.delete.description", { name: deleteTarget?.name ?? t("suppliers.delete.thisOne") })}
        confirmLabel={t("suppliers.delete.confirm")}
        reasonRequired
        loading={deleteSupplier.isPending}
        onCancel={() => { if (!deleteSupplier.isPending) setDeleteTarget(null); }}
        onConfirm={({ ownerPin, reason }) => {
          if (!deleteTarget) return;
          deleteSupplier.mutate({ id: deleteTarget.id, ownerPin, reason });
        }}
      />
    </div>
  );
}
