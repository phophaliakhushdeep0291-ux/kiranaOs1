import { useState } from "react";
import {
  useListSuppliers, useCreateSupplier, useUpdateSupplier, useDeleteSupplier,
  getListSuppliersQueryKey, type Supplier
} from "@/lib/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Pencil, Loader2, Phone, MapPin, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";

const schema = z.object({
  name: z.string().min(1, "Name required"),
  mobile: z.string().optional(),
  address: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export default function Suppliers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  const suppliers = useListSuppliers();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", mobile: "", address: "" },
  });

  const createSupplier = useCreateSupplier({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
        setOpen(false); form.reset();
        toast({ title: "Supplier added" });
      },
      onError: (err: unknown) => toast({ title: "Error", description: (err as { data?: { message?: string } })?.data?.message ?? "Failed", variant: "destructive" }),
    },
  });

  const updateSupplier = useUpdateSupplier({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
        setOpen(false); setEditing(null); form.reset();
        toast({ title: "Supplier updated" });
      },
      onError: (err: unknown) => toast({ title: "Error", description: (err as { data?: { message?: string } })?.data?.message ?? "Failed", variant: "destructive" }),
    },
  });

  const deleteSupplier = useDeleteSupplier({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
        setDeleteTarget(null);
        toast({ title: "Supplier moved to recycle bin locally" });
      },
      onError: (err: unknown) => toast({ title: "Delete blocked", description: (err as { data?: { message?: string }; message?: string })?.data?.message ?? (err as { message?: string })?.message ?? "Owner PIN is required.", variant: "destructive" }),
    },
  });

  const openEdit = (s: Supplier) => {
    setEditing(s);
    form.reset({ name: s.name, mobile: s.mobile ?? "", address: s.address ?? "" });
    setOpen(true);
  };

  const openAdd = () => {
    setEditing(null);
    form.reset({ name: "", mobile: "", address: "" });
    setOpen(true);
  };

  const onSubmit = (values: FormData) => {
    const data = { name: values.name, mobile: values.mobile || undefined, address: values.address || undefined };
    if (editing) {
      updateSupplier.mutate({ id: editing.id, data });
    } else {
      createSupplier.mutate({ data });
    }
  };

  const filtered = (suppliers.data ?? []).filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.mobile?.includes(search)
  );

  return (
    <div className="p-6 w-full max-w-none">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Suppliers</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{suppliers.data?.length ?? 0} {suppliers.data?.length === 1 ? "supplier" : "suppliers"}</p>
        </div>
        <Button data-testid="button-add-supplier" onClick={openAdd}>
          <Plus size={16} className="mr-1.5" />Add Supplier
        </Button>
      </div>

      <div className="relative mb-5">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input data-testid="input-search" className="pl-9" placeholder="Search by name or mobile..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {suppliers.isLoading ? (
        <div className="grid gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border rounded-xl p-12 text-center text-muted-foreground">
          {search ? "No suppliers match your search" : "No suppliers yet — add your first supplier"}
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
                  data-testid={`button-edit-${s.id}`}
                  onClick={() => openEdit(s)}
                  aria-label={`Edit ${s.name}`}
                  className="grid h-11 w-11 place-items-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground active:scale-95"
                >
                  <Pencil size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-testid={`button-delete-${s.id}`}
                  onClick={() => setDeleteTarget(s)}
                  aria-label={`Delete ${s.name}`}
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
            <DialogTitle>{editing ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div>
              <Label>Name *</Label>
              <Input data-testid="input-supplier-name" className="mt-1" placeholder="Supplier name" {...form.register("name")} />
              {form.formState.errors.name && <p className="text-destructive text-xs mt-1">{form.formState.errors.name.message}</p>}
            </div>
            <div>
              <Label>Mobile</Label>
              <Input data-testid="input-supplier-mobile" className="mt-1" placeholder="9876543210" {...form.register("mobile")} />
            </div>
            <div>
              <Label>Address</Label>
              <Input data-testid="input-supplier-address" className="mt-1" placeholder="Address" {...form.register("address")} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={createSupplier.isPending || updateSupplier.isPending}>
                {createSupplier.isPending || updateSupplier.isPending ? <Loader2 size={14} className="animate-spin" /> : editing ? "Save" : "Add"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <OwnerPinModal
        open={Boolean(deleteTarget)}
        title="Move supplier to recycle bin"
        description={`Delete ${deleteTarget?.name ?? "this supplier"}? This is a soft delete and will be queued for sync.`}
        confirmLabel="Move to recycle bin"
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
