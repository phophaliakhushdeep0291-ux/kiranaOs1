import { useMemo } from "react";
import { EyeOff, LayoutGrid, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Badge, Card, CardHead, RowToggle } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";
import {
  MODULE_DEFS,
  MODULE_GROUPS,
  type ModuleGroup,
  type ModuleId,
  type ModuleVisibility,
  useModuleVisibility,
} from "@/features/settings/modules";

const ALWAYS_ON = ["Billing", "Dashboard", "Cloud Backup", "Settings"];

/**
 * Modules tab — the owner picks which parts of the app they actually use, and
 * everything else stops taking up room in the sidebar, the mobile menu and the
 * dashboard shortcuts. Choices ride along in the shared settings blob, so the
 * same trimmed-down app appears on every device of this shop.
 */
export default function ModulesSettingsPage() {
  const { toast } = useToast();
  const { patch } = useSettingsPrefs();
  const { visibility, isEnabled, setVisibility, patchVisibility } = useModuleVisibility();

  const hiddenCount = useMemo(
    () => MODULE_DEFS.filter((module) => visibility[module.id] === false).length,
    [visibility],
  );

  /** Merges against the live store, never this render's snapshot, so flipping
   *  several switches in a row cannot drop all but the last change. */
  function toggle(id: ModuleId, on: boolean) {
    void patch({ moduleVisibility: patchVisibility({ [id]: on }) });
  }

  function toggleGroup(group: ModuleGroup, on: boolean) {
    const change: ModuleVisibility = {};
    for (const module of MODULE_DEFS) {
      if (module.group === group) change[module.id] = on;
    }
    void patch({ moduleVisibility: patchVisibility(change) });
  }

  function showEverything() {
    setVisibility({});
    void patch({ moduleVisibility: {} });
    toast({ title: "All modules are back on", description: "Every section is visible again in the menus." });
  }

  return (
    <SettingsShell>
      <Card>
        <CardHead
          icon={<LayoutGrid size={15} />}
          title="Modules"
          sub="Switch off what this shop does not use and it disappears from the menus"
          action={
            <div className="flex items-center gap-2">
              <Badge tone={hiddenCount > 0 ? "amber" : "green"}>
                {hiddenCount > 0 ? `${hiddenCount} hidden` : "Everything visible"}
              </Badge>
              {hiddenCount > 0 && (
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={showEverything}>
                  <RotateCcw size={13} /> Show all
                </Button>
              )}
            </div>
          }
        />
        <div className="px-5 pb-5">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-[12px] border border-[#e4ebf6] bg-[#f8faff] p-4">
              <div className="flex gap-3">
                <EyeOff className="mt-0.5 shrink-0 text-[var(--brand)]" size={17} />
                <div>
                  <p className="text-[13px] font-black text-[var(--brand-ink)]">Hides, never deletes</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#52627e]">
                    A module you switch off is only removed from the sidebar, the mobile menu and the
                    dashboard shortcuts. Its data stays exactly where it is, keeps syncing, and comes
                    straight back the moment you switch the module on again.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-[12px] border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="flex gap-3">
                <Sparkles className="mt-0.5 shrink-0 text-emerald-700" size={17} />
                <div>
                  <p className="text-[13px] font-black text-emerald-950">Always available</p>
                  <p className="mt-1 text-[11px] leading-5 text-emerald-800">
                    {ALWAYS_ON.join(", ")} cannot be hidden — they are how you bill, check the day and
                    keep your data backed up.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {MODULE_GROUPS.map((group) => {
        const modules = MODULE_DEFS.filter((module) => module.group === group);
        if (modules.length === 0) return null;
        const allOn = modules.every((module) => isEnabled(module.id));

        return (
          <Card key={group}>
            <CardHead
              title={group}
              sub={`${modules.filter((module) => isEnabled(module.id)).length} of ${modules.length} showing`}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => toggleGroup(group, !allOn)}
                >
                  {allOn ? "Hide all" : "Show all"}
                </Button>
              }
            />
            <div className="px-5 pb-4">
              {modules.map((module, index) => (
                <RowToggle
                  key={module.id}
                  label={module.label}
                  desc={module.description}
                  last={index === modules.length - 1}
                  pill={
                    <Switch
                      checked={isEnabled(module.id)}
                      onCheckedChange={(on) => toggle(module.id, on)}
                    />
                  }
                />
              ))}
            </div>
          </Card>
        );
      })}
    </SettingsShell>
  );
}
