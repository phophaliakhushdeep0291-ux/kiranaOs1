import { useEffect, useState } from "react";
import { Link } from "wouter";
import { getGetShopQueryKey, useChangePassword, useGetShop, useUpdateShop } from "@/lib/api/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Archive,
  Bell,
  Check,
  Cloud,
  CreditCard,
  Languages,
  LayoutGrid,
  LifeBuoy,
  Loader2,
  MonitorSmartphone,
  Palette,
  ReceiptText,
  Recycle,
  Shield,
  Sparkles,
  Store,
  Truck,
  UserCircle,
  UsersRound,
} from "lucide-react";
import { useAppTheme, ACCENT_COLORS, type AccentColor } from "@/features/settings/theme";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { usePermission } from "@/features/staff/permissions";
import { useAppLanguage, type AppLanguage } from "@/features/settings/i18n";
import { offlineDB } from "@/lib/offline/db";
import { PageHeader, PageShell } from "@/components/shared";

const shopSchema = z.object({
  name: z.string().min(1),
  ownerName: z.string().min(1),
  city: z.string().min(1),
  address: z.string().min(1),
  gstNumber: z.string().optional(),
  phone: z.string().optional(),
});
type ShopFormData = z.infer<typeof shopSchema>;

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Required"),
  newPassword: z.string().min(6, "Min 6 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] });
type PasswordFormData = z.infer<typeof passwordSchema>;

const profileSchema = z.object({
  displayName: z.string().min(1, "Name required"),
  mobile: z.string().optional(),
  counterName: z.string().optional(),
});
type ProfileFormData = z.infer<typeof profileSchema>;

const PROFILE_SETTING_KEY = "ui:owner-profile:v1";

const advancedLinks = [
  { href: "/suppliers", label: "Suppliers", description: "Purchase parties", icon: Truck },
  { href: "/staff", label: "Staff & roles", description: "Users and permissions", icon: UsersRound },
  { href: "/devices", label: "Devices", description: "Licensed devices", icon: MonitorSmartphone },
  { href: "/sync-status", label: "Cloud backup", description: "Backup health", icon: Cloud },
  { href: "/smart-tools", label: "Smart tools", description: "Voice and automation", icon: Sparkles },
  { href: "/recovery-mode", label: "Recovery mode", description: "Recover local drafts", icon: LifeBuoy },
  { href: "/audit-logs", label: "Audit logs", description: "Owner approvals", icon: ReceiptText },
  { href: "/recycle-bin", label: "Recycle bin", description: "Restore deleted records", icon: Recycle },
  { href: "/plans", label: "Plans", description: "From Rs 299/month", icon: CreditCard },
  { href: "/subscription", label: "Subscription", description: "Plan and expiry", icon: Bell },
] as const;

export default function Settings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { language, setLanguage, t } = useAppLanguage();
  const { accent, setAccent } = useAppTheme();
  const changeSettingsPermission = usePermission("change_settings");
  const queryClient = useQueryClient();
  const [settingsPinOpen, setSettingsPinOpen] = useState(false);
  const [settingsPinError, setSettingsPinError] = useState<string | null>(null);
  const [pendingShopSettings, setPendingShopSettings] = useState<ShopFormData | null>(null);

  const shop = useGetShop();

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.name ?? "Owner",
      mobile: user?.mobile ?? "",
      counterName: "Main counter",
    },
  });

  useEffect(() => {
    let cancelled = false;
    void offlineDB.getSetting<ProfileFormData>(PROFILE_SETTING_KEY).then((saved) => {
      if (cancelled || !saved) return;
      profileForm.reset({
        displayName: saved.displayName || user?.name || "Owner",
        mobile: saved.mobile || user?.mobile || "",
        counterName: saved.counterName || "Main counter",
      });
    });
    return () => { cancelled = true; };
  }, [profileForm, user?.mobile, user?.name]);

  const shopForm = useForm<ShopFormData>({
    resolver: zodResolver(shopSchema),
    values: {
      name: shop.data?.name ?? "",
      ownerName: shop.data?.ownerName ?? "",
      city: shop.data?.city ?? "",
      address: shop.data?.address ?? "",
      gstNumber: shop.data?.gstNumber ?? "",
      phone: shop.data?.phone ?? "",
    },
  });

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const updateShop = useUpdateShop({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetShopQueryKey() });
        toast({ title: "Shop settings saved" });
      },
      onError: (err: unknown) => toast({ title: "Error", description: (err as { data?: { message?: string } })?.data?.message ?? "Failed", variant: "destructive" }),
    },
  });

  const changePassword = useChangePassword({
    mutation: {
      onSuccess: () => {
        passwordForm.reset();
        toast({ title: "Password changed" });
      },
      onError: (err: unknown) => toast({ title: "Error", description: (err as { data?: { message?: string } })?.data?.message ?? "Incorrect password", variant: "destructive" }),
    },
  });

  async function saveProfile(values: ProfileFormData) {
    await offlineDB.setSetting(PROFILE_SETTING_KEY, values);
    toast({ title: "Profile saved", description: "This profile is saved locally for the counter UI." });
  }

  function changeLanguage(nextLanguage: AppLanguage) {
    setLanguage(nextLanguage);
    toast({ title: "Language changed" });
  }

  return (
    <PageShell className="space-y-4">
      <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-muted/60 p-1 sm:grid-cols-6 lg:max-w-5xl">
          <TabsTrigger value="profile" data-testid="tab-profile"><UserCircle size={14} className="mr-1.5" />{t("settings.profile")}</TabsTrigger>
          <TabsTrigger value="shop" data-testid="tab-shop"><Store size={14} className="mr-1.5" />{t("settings.shop")}</TabsTrigger>
          <TabsTrigger value="language" data-testid="tab-language"><Languages size={14} className="mr-1.5" />{t("settings.language")}</TabsTrigger>
          <TabsTrigger value="appearance" data-testid="tab-appearance"><Palette size={14} className="mr-1.5" />Appearance</TabsTrigger>
          <TabsTrigger value="advanced" data-testid="tab-advanced"><LayoutGrid size={14} className="mr-1.5" />{t("settings.advanced")}</TabsTrigger>
          <TabsTrigger value="security" data-testid="tab-security"><Shield size={14} className="mr-1.5" />{t("settings.security")}</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="rounded-lg border bg-card p-5">
              <h2 className="font-semibold mb-1">{t("settings.profileTitle")}</h2>
              <p className="text-sm text-muted-foreground mb-4">Visible owner/counter profile for this device. Backend account details still come from login.</p>
              <form onSubmit={profileForm.handleSubmit(saveProfile)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Display name</Label>
                    <Input className="mt-1" {...profileForm.register("displayName")} />
                  </div>
                  <div>
                    <Label>Mobile</Label>
                    <Input className="mt-1" {...profileForm.register("mobile")} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Counter name</Label>
                    <Input className="mt-1" placeholder="Main counter" {...profileForm.register("counterName")} />
                  </div>
                </div>
                <Button type="submit">Save profile</Button>
              </form>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground"><UserCircle /></div>
                <div>
                  <p className="font-semibold">{user?.name ?? "Owner"}</p>
                  <p className="text-xs text-muted-foreground">{user?.role ?? "owner"}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Account mobile</span><span>{user?.mobile ?? "Not set"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Shop</span><span>{shop.data?.name ?? "Local shop"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Language</span><Badge>{language === "hi" ? "Hindi" : "English"}</Badge></div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="shop">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold mb-4">Shop Profile</h2>
            {shop.isLoading ? (
              <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (
              <form onSubmit={shopForm.handleSubmit((v) => {
                if (!changeSettingsPermission.allowed) {
                  toast({ title: "Permission denied", description: changeSettingsPermission.reason, variant: "destructive" });
                  return;
                }
                setPendingShopSettings(v);
                setSettingsPinError(null);
                setSettingsPinOpen(true);
              })} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Shop Name</Label>
                    <Input data-testid="input-shop-name" className="mt-1" {...shopForm.register("name")} />
                  </div>
                  <div>
                    <Label>Owner Name</Label>
                    <Input data-testid="input-owner-name" className="mt-1" {...shopForm.register("ownerName")} />
                  </div>
                  <div>
                    <Label>City</Label>
                    <Input data-testid="input-city" className="mt-1" {...shopForm.register("city")} />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input data-testid="input-phone" className="mt-1" {...shopForm.register("phone")} />
                  </div>
                </div>
                <div>
                  <Label>Address</Label>
                  <Input data-testid="input-address" className="mt-1" {...shopForm.register("address")} />
                </div>
                <div>
                  <Label>GST Number (optional)</Label>
                  <Input data-testid="input-gst" className="mt-1" placeholder="22AAAAA0000A1Z5" {...shopForm.register("gstNumber")} />
                </div>
                <Button type="submit" data-testid="button-save-shop" disabled={updateShop.isPending}>
                  {updateShop.isPending ? <><Loader2 size={14} className="mr-1.5 animate-spin" />Saving...</> : "Save Settings"}
                </Button>
              </form>
            )}
          </div>
        </TabsContent>

        <TabsContent value="language">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold mb-1">{t("settings.languageTitle")}</h2>
            <p className="text-sm text-muted-foreground mb-4">{t("settings.languageHelp")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => changeLanguage("en")} className={`rounded-lg border p-4 text-left transition ${language === "en" ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "hover:bg-accent"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{t("settings.english")}</span>
                  {language === "en" && <Badge>Active</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Clean English labels for counter staff.</p>
              </button>
              <button type="button" onClick={() => changeLanguage("hi")} className={`rounded-lg border p-4 text-left transition ${language === "hi" ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "hover:bg-accent"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{t("settings.hindi")}</span>
                  {language === "hi" && <Badge>Active</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Shopkeeper-friendly Hindi/Hinglish labels.</p>
              </button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="appearance">
          <div className="space-y-5">
            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="border-b px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Palette size={16} />
                  </span>
                  <div>
                    <h2 className="font-display text-base font-black tracking-tight">Accent colour</h2>
                    <p className="text-[11px] text-muted-foreground">Changes buttons, sidebar, highlights and focus rings across the entire app. Applied instantly.</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3 p-5 sm:grid-cols-8">
                {(Object.entries(ACCENT_COLORS) as [AccentColor, typeof ACCENT_COLORS[AccentColor]][]).map(([key, def]) => {
                  const active = accent === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setAccent(key);
                        toast({ title: `${def.label} theme applied` });
                      }}
                      className={cn(
                        "group flex flex-col items-center gap-2.5 rounded-xl border-2 p-3 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-transparent hover:border-muted-foreground/20 hover:bg-muted/40"
                      )}
                    >
                      <div className="relative">
                        <div
                          className="h-11 w-11 rounded-full shadow-md transition-transform duration-150 group-hover:scale-105"
                          style={{ backgroundColor: def.swatch }}
                        />
                        {active && (
                          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background shadow ring-2 ring-primary">
                            <Check size={11} className="text-primary" />
                          </span>
                        )}
                      </div>
                      <p className={cn("text-xs font-bold", active ? "text-primary" : "text-foreground")}>{def.label}</p>
                    </button>
                  );
                })}
              </div>
              <div className="border-t bg-muted/30 px-5 py-3">
                <p className="text-[11px] text-muted-foreground">
                  Saved to this browser. Each device can have its own colour preference.
                </p>
              </div>
            </div>

            {/* Live preview card */}
            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="border-b px-5 py-4">
                <h2 className="font-display text-base font-black tracking-tight">Preview</h2>
                <p className="text-[11px] text-muted-foreground">See how the selected accent looks across UI elements.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 p-5">
                <button type="button" className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-sm transition hover:opacity-90">
                  Primary button
                </button>
                <button type="button" className="rounded-xl border border-primary px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary/10">
                  Outline button
                </button>
                <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary">Badge</span>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded border-2 border-primary bg-primary" />
                  <span className="text-sm text-muted-foreground">Checkbox</span>
                </div>
                <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-3/5 rounded-full bg-primary transition-all duration-500" />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="advanced">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold mb-1">{t("settings.advancedTitle")}</h2>
            <p className="text-sm text-muted-foreground mb-4">{t("settings.advancedHelp")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {advancedLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <div className="flex min-h-20 cursor-pointer gap-3 rounded-lg border p-3 transition hover:bg-accent">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon size={17} /></div>
                      <div>
                        <p className="font-semibold">{item.label}</p>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="security">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold mb-4">Change Password</h2>
            <form onSubmit={passwordForm.handleSubmit((v) => changePassword.mutate({ data: { currentPassword: v.currentPassword, newPassword: v.newPassword } }))} className="space-y-4 max-w-sm">
              <div>
                <Label>Current Password</Label>
                <Input data-testid="input-current-password" type="password" className="mt-1" {...passwordForm.register("currentPassword")} />
                {passwordForm.formState.errors.currentPassword && <p className="text-destructive text-xs mt-1">{passwordForm.formState.errors.currentPassword.message}</p>}
              </div>
              <div>
                <Label>New Password</Label>
                <Input data-testid="input-new-password" type="password" className="mt-1" {...passwordForm.register("newPassword")} />
                {passwordForm.formState.errors.newPassword && <p className="text-destructive text-xs mt-1">{passwordForm.formState.errors.newPassword.message}</p>}
              </div>
              <div>
                <Label>Confirm New Password</Label>
                <Input data-testid="input-confirm-password" type="password" className="mt-1" {...passwordForm.register("confirmPassword")} />
                {passwordForm.formState.errors.confirmPassword && <p className="text-destructive text-xs mt-1">{passwordForm.formState.errors.confirmPassword.message}</p>}
              </div>
              <Button type="submit" data-testid="button-change-password" disabled={changePassword.isPending}>
                {changePassword.isPending ? <><Loader2 size={14} className="mr-1.5 animate-spin" />Changing...</> : "Change Password"}
              </Button>
            </form>
          </div>
        </TabsContent>
      </Tabs>

      <OwnerPinModal
        open={settingsPinOpen}
        onCancel={() => setSettingsPinOpen(false)}
        title="Approve settings change"
        description="Owner PIN is required before changing shop settings. Data is saved locally first and backend must enforce it again."
        confirmLabel="Save settings"
        loading={updateShop.isPending}
        error={settingsPinError}
        onConfirm={async ({ ownerPin }) => {
          if (!pendingShopSettings) return;
          try {
            await updateShop.mutateAsync({ data: { ...pendingShopSettings, ownerPin } });
            setSettingsPinOpen(false);
            setPendingShopSettings(null);
          } catch (error) {
            setSettingsPinError(error instanceof Error ? error.message : "Settings update failed. Check owner PIN.");
          }
        }}
      />
    </PageShell>
  );
}
