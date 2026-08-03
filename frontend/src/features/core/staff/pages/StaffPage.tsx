import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { FeatureGate } from "@/features/core/subscription";

import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import {
  PERMISSION_LABELS,
  POS_PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  permissionsForRole,
  usePermission,
  type PermissionName,
  type StaffRole,
} from "@/features/core/staff/permissions";
import { createStaffLocalFirst, deactivateStaffLocalFirst, listStaffLocalFirst, updateStaffLocalFirst, type StaffMember } from "@/features/core/staff/local-actions";
import { getStaffLocationAssignments, updateStaffLocationAssignments, type StaffLocationAccessRow } from "@/features/core/staff/api";
import { Edit, MapPin, ShieldAlert, UserPlus, UserRoundX, UsersRound } from "lucide-react";
import { DataTableCard, EmptyState, PageHeader, PageShell, PermissionDenied, SyncBadge } from "@/components/shared";

const STAFF_QUERY_KEY = ["staff-users-local"];

interface StaffFormState {
  id?: string;
  name: string;
  mobile: string;
  email: string;
  password: string;
  role: StaffRole;
  permissions: PermissionName[];
}

const emptyForm: StaffFormState = {
  name: "",
  mobile: "",
  email: "",
  password: "",
  role: "cashier",
  permissions: ROLE_PERMISSIONS.cashier,
};

function roleBadgeVariant(role: StaffRole) {
  if (role === "owner") return "default" as const;
  if (role === "manager") return "secondary" as const;
  return "outline" as const;
}

function memberToForm(member: StaffMember): StaffFormState {
  return {
    id: member.id,
    name: member.name,
    mobile: member.mobile ?? "",
    email: member.email ?? "",
    password: "",
    role: member.role,
    permissions: member.permissions?.length ? member.permissions : permissionsForRole(member.role),
  };
}

function isActive(member: StaffMember) {
  return member.isActive !== false && !member.deletedAt && !member.deactivatedAt;
}

export default function StaffPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const manageStaff = usePermission("manage_staff");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<StaffFormState>(emptyForm);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"save" | "deactivate" | "locations" | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<StaffMember | null>(null);
  const [saving, setSaving] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationTarget, setLocationTarget] = useState<StaffMember | null>(null);
  const [locationDraft, setLocationDraft] = useState<StaffLocationAccessRow[]>([]);

  const staff = useQuery({ queryKey: STAFF_QUERY_KEY, queryFn: listStaffLocalFirst, staleTime: 2_000 });
  const locationTargetId = locationTarget?.server_id ?? (locationTarget?.sync_status === "synced" ? locationTarget.id : undefined);
  const locationAccess = useQuery({
    queryKey: ["staff-location-access", locationTargetId],
    queryFn: () => getStaffLocationAssignments(locationTargetId!),
    enabled: locationOpen && Boolean(locationTargetId),
  });

  useEffect(() => {
    if (locationAccess.data) setLocationDraft(locationAccess.data.locations);
  }, [locationAccess.data]);

  const activeCount = useMemo(() => (staff.data ?? []).filter(isActive).length, [staff.data]);
  const inactiveCount = useMemo(() => (staff.data ?? []).filter((member) => !isActive(member)).length, [staff.data]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: STAFF_QUERY_KEY });
  }

  function openCreate() {
    if (!manageStaff.allowed) {
      toast({ title: "Permission denied", description: manageStaff.reason, variant: "destructive" });
      return;
    }
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(member: StaffMember) {
    if (!manageStaff.allowed) {
      toast({ title: "Permission denied", description: manageStaff.reason, variant: "destructive" });
      return;
    }
    setForm(memberToForm(member));
    setFormOpen(true);
  }

  function togglePermission(permission: PermissionName, checked: boolean) {
    setForm((current) => ({
      ...current,
      permissions: checked ? Array.from(new Set([...current.permissions, permission])) : current.permissions.filter((item) => item !== permission),
    }));
  }

  function changeRole(role: StaffRole) {
    setForm((current) => ({ ...current, role, permissions: permissionsForRole(role) }));
  }

  function requestSave() {
    if (!manageStaff.allowed) {
      toast({ title: "Permission denied", description: manageStaff.reason, variant: "destructive" });
      return;
    }
    if (!form.name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!form.mobile.trim() && !form.email.trim()) {
      toast({ title: "Mobile or email required", variant: "destructive" });
      return;
    }
    if (!form.id && form.password.trim().length < 6) {
      toast({ title: "Password required", description: "New staff login needs at least 6 characters.", variant: "destructive" });
      return;
    }
    setPendingAction("save");
    setPinError(null);
    setPinOpen(true);
  }

  function requestDeactivate(member: StaffMember) {
    if (!manageStaff.allowed) {
      toast({ title: "Permission denied", description: manageStaff.reason, variant: "destructive" });
      return;
    }
    setDeactivateTarget(member);
    setPendingAction("deactivate");
    setPinError(null);
    setPinOpen(true);
  }

  function openLocations(member: StaffMember) {
    if (!manageStaff.allowed) return;
    setLocationTarget(member);
    setLocationDraft([]);
    setLocationOpen(true);
  }

  function changeLocation(locationId: string, patch: Partial<StaffLocationAccessRow>) {
    setLocationDraft((current) => current.map((row) => row.id === locationId ? { ...row, ...patch } : row));
  }

  function requestLocationSave() {
    if (!locationDraft.some((row) => row.assigned)) {
      toast({ title: "Assign at least one location", description: "Deactivate the staff account if it should have no store access.", variant: "destructive" });
      return;
    }
    setPendingAction("locations");
    setPinError(null);
    setPinOpen(true);
  }

  async function confirmWithPin(ownerPin: string, reason: string) {
    setSaving(true);
    setPinError(null);
    try {
      if (pendingAction === "save") {
        if (form.id) {
          await updateStaffLocalFirst({ ...form, id: form.id, ownerPin, ownerPinReason: reason || "Staff permission change" });
          toast({ title: "Staff permissions updated", description: "Saved locally and queued for cloud sync." });
        } else {
          await createStaffLocalFirst({ ...form, ownerPin, ownerPinReason: reason || "Staff permission change" });
          toast({ title: "Staff member added", description: "Saved locally and queued for cloud sync." });
        }
        setFormOpen(false);
      }
      if (pendingAction === "deactivate" && deactivateTarget) {
        await deactivateStaffLocalFirst(deactivateTarget.id, ownerPin, reason || "Deactivated by owner");
        toast({ title: "Staff deactivated", description: "This is a soft deactivate and will sync later." });
      }
      if (pendingAction === "locations" && locationTargetId) {
        const locations = locationDraft.filter((row) => row.assigned).map((row) => ({
          locationId: row.id,
          canSell: row.canSell,
          canPurchase: row.canPurchase,
          canManageInventory: row.canManageInventory,
          canTransfer: row.canTransfer,
        }));
        await updateStaffLocationAssignments(locationTargetId, locations, ownerPin);
        toast({ title: "Store access updated", description: `${locationTarget?.name ?? "Staff"} can now work only in the selected locations.` });
        setLocationOpen(false);
        void queryClient.invalidateQueries({ queryKey: ["staff-location-access", locationTargetId] });
      }
      setPinOpen(false);
      setPendingAction(null);
      setDeactivateTarget(null);
      refresh();
    } catch (error) {
      setPinError(error instanceof Error ? error.message : "Action failed. Check PIN and try again.");
    } finally {
      setSaving(false);
    }
  }

  const content = (
    <>
        <PageHeader
          title={<span className="flex items-center gap-2"><UsersRound size={24} />Staff & Permissions</span>}
          description="Manage roles and enforce exactly which stores each person can sell, purchase, or adjust stock in."
          actions={(
            <>
              <Badge variant="outline">{activeCount} active</Badge>
              <Badge variant="outline">{inactiveCount} inactive</Badge>
              <Button onClick={openCreate}><UserPlus size={15} className="mr-1.5" />Add staff</Button>
            </>
          )}
        />

        {!manageStaff.allowed ? <PermissionDenied message={manageStaff.reason} /> : null}

        <Tabs defaultValue="staff" className="space-y-4">
          <TabsList>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="matrix">Permission matrix</TabsTrigger>
          </TabsList>

          <TabsContent value="staff" className="space-y-3">
            <DataTableCard title="Activated staff" loading={staff.isLoading} empty={!staff.isLoading && (staff.data ?? []).length === 0} emptyState={<EmptyState title="No staff added yet" description="Owner account can still use the app." />}>
              <div className="space-y-3">
                {(staff.data ?? []).map((member) => (
                  <div key={member.id} className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{member.name}</p>
                        <Badge variant={roleBadgeVariant(member.role)}>{ROLE_LABELS[member.role]}</Badge>
                        <Badge variant={isActive(member) ? "secondary" : "outline"}>{isActive(member) ? "Active" : "Deactivated"}</Badge>
                        <SyncBadge status={member.sync_status === "synced" ? "synced" : member.sync_status === "failed" ? "failed" : "local"} label={member.sync_status ?? "local"} />
                      </div>
                      <p className="text-xs text-muted-foreground">{member.mobile || member.email || "No contact"} {member.lastActiveAt ? `• Last active ${new Date(member.lastActiveAt).toLocaleString("en-IN")}` : ""}</p>
                      <p className="text-xs text-muted-foreground">{member.permissions.map((permission) => PERMISSION_LABELS[permission]).join(", ")}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(member)} disabled={!manageStaff.allowed || member.role === "owner"}><Edit size={14} className="mr-1" />Edit</Button>
                      {member.role !== "owner" ? <Button size="sm" variant="outline" onClick={() => openLocations(member)} disabled={!manageStaff.allowed}><MapPin size={14} className="mr-1" />Stores</Button> : null}
                      {member.role !== "owner" && isActive(member) ? <Button size="sm" variant="outline" onClick={() => requestDeactivate(member)} disabled={!manageStaff.allowed}><UserRoundX size={14} className="mr-1" />Deactivate</Button> : null}
                    </div>
                  </div>
                ))}
              </div>
            </DataTableCard>
          </TabsContent>

          <TabsContent value="matrix">
            <Card>
              <CardHeader><CardTitle>Role permission matrix</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/50">
                    <tr><th className="px-3 py-2 text-left">Permission</th>{STAFF_ROLES.map((role) => <th key={role} className="px-3 py-2 text-center">{ROLE_LABELS[role]}</th>)}</tr>
                  </thead>
                  <tbody>
                    {POS_PERMISSIONS.map((permission) => (
                      <tr key={permission} className="border-t">
                        <td className="px-3 py-2 font-medium">{PERMISSION_LABELS[permission]}</td>
                        {STAFF_ROLES.map((role) => <td key={role} className="px-3 py-2 text-center">{ROLE_PERMISSIONS[role].includes(permission) ? "✅" : "—"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{form.id ? "Edit staff permissions" : "Add staff login"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
                <div><Label>Name *</Label><Input className="mt-1" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div>
                <div><Label>Mobile</Label><Input className="mt-1" value={form.mobile} onChange={(event) => setForm((current) => ({ ...current, mobile: event.target.value }))} /></div>
                <div><Label>Email</Label><Input className="mt-1" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></div>
                <div><Label>{form.id ? "New password optional" : "Password *"}</Label><Input type="password" className="mt-1" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></div>
              </div>
              <div><Label>Role</Label><Select value={form.role} onValueChange={(value) => changeRole(value as StaffRole)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{STAFF_ROLES.filter((role) => role !== "owner").map((role) => <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>)}</SelectContent></Select></div>
              <div className="rounded-xl border p-3">
                <div className="mb-2 flex items-center gap-2 font-medium"><ShieldAlert size={16} />Permissions</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {POS_PERMISSIONS.filter((permission) => permission !== "manage_staff").map((permission) => (
                    <label key={permission} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                      <Checkbox checked={form.permissions.includes(permission)} onCheckedChange={(checked) => togglePermission(permission, checked === true)} />
                      <span>{PERMISSION_LABELS[permission]}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">Changing staff permissions requires owner PIN and is written to the audit log.</div>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button><Button onClick={requestSave}>Continue with PIN</Button></div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={locationOpen} onOpenChange={setLocationOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Store access · {locationTarget?.name}</DialogTitle></DialogHeader>
            {!locationTargetId ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                This staff account is still waiting for cloud sync. Sync it first, then store-level restrictions can be enforced on every device.
              </div>
            ) : locationAccess.isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading store permissions…</div>
            ) : locationAccess.isError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not load store access. Check the connection and try again.</div>
            ) : (
              <div className="space-y-3">
                {!locationAccess.data?.explicitScope ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">This user currently has legacy all-store access. Saving below switches them to deny-by-default access outside selected stores.</div> : null}
                {locationDraft.map((location) => (
                  <div key={location.id} className="rounded-xl border p-4">
                    <label className="flex items-start gap-3">
                      <Checkbox checked={location.assigned} onCheckedChange={(checked) => changeLocation(location.id, { assigned: checked === true })} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 font-semibold">{location.name}{location.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}</span>
                        <span className="text-xs text-muted-foreground">{location.code}{location.city ? ` · ${location.city}` : ""}</span>
                      </span>
                    </label>
                    <div className="mt-3 grid gap-2 pl-7 sm:grid-cols-2 lg:grid-cols-4">
                      {([
                        ["canSell", "Sell & return"],
                        ["canPurchase", "Purchase & receive"],
                        ["canManageInventory", "Adjust inventory"],
                        ["canTransfer", "Transfer stock"],
                      ] as const).map(([field, label]) => (
                        <label key={field} className="flex items-center gap-2 rounded-lg bg-muted/40 p-2 text-xs">
                          <Checkbox disabled={!location.assigned} checked={location.assigned && location[field]} onCheckedChange={(checked) => changeLocation(location.id, { [field]: checked === true })} />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setLocationOpen(false)}>Cancel</Button><Button onClick={requestLocationSave}>Save with owner PIN</Button></div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <OwnerPinModal
          open={pinOpen}
          onCancel={() => setPinOpen(false)}
          title={pendingAction === "deactivate" ? "Deactivate staff" : pendingAction === "locations" ? "Approve store access" : "Approve staff permission change"}
          description={pendingAction === "locations" ? "This immediately changes which store data and actions this user can access." : "Owner PIN is required for staff create, edit, or deactivation."}
          confirmLabel={pendingAction === "deactivate" ? "Deactivate" : pendingAction === "locations" ? "Save access" : "Save staff"}
          reasonRequired
          loading={saving}
          error={pinError}
          onConfirm={({ ownerPin, reason }) => confirmWithPin(ownerPin, reason)}
        />
    </>
  );

  if (embedded) return <div className="space-y-4">{content}</div>;

  return (
    <FeatureGate featureName="staff_login">
      <PageShell className="space-y-5">{content}</PageShell>
    </FeatureGate>
  );
}
