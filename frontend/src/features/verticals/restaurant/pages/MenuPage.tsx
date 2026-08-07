import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ChefHat, Clock, ExternalLink, Flame, Loader2, Palette, Search, Sparkles, Utensils,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { useAuth } from "@/features/core/auth/useAuth";
import { useSettingsPrefs } from "@/features/core/settings/use-settings-prefs";
import type { FoodType, MenuBoard, MenuDish } from "@/types/api";
import { getMenuBoard, updateDishMenu } from "../service/restaurant-api";
import {
  BLANK_BRAND, guestOrdersEnabled, MENU_THEME_OPTIONS, readMenuBrand, readRestaurantSettings,
  themeOption, toStoredBrand, type MenuBrand,
} from "../service/menu-branding";

/**
 * The menu card, from the kitchen's side.
 *
 * A dish is an ordinary product and keeps its price, tax and stock on the
 * Products screen — this page owns only what a menu adds and a shelf has no
 * word for: which course it belongs to, whether it is veg, how hot, how long
 * the kitchen needs, and whether it can be served tonight.
 *
 * That last one is the reason this screen exists as something separate from
 * Products. "We've run out of fish tonight" happens at 8pm, in a hurry, and it
 * is not the same statement as "we don't sell fish" — one is an apology and the
 * other is a delisting. A catalogue with a single Active switch forces a cook to
 * say the wrong one, and a dish delisted at 8pm is a dish nobody remembers to
 * bring back on Tuesday.
 */

const FOOD_TYPES: Array<{ key: FoodType; label: string; ring: string }> = [
  { key: "veg", label: "Veg", ring: "#15803d" },
  { key: "nonveg", label: "Non-veg", ring: "#b91c1c" },
  { key: "egg", label: "Egg", ring: "#d97706" },
  { key: "vegan", label: "Vegan", ring: "#15803d" },
  { key: "jain", label: "Jain", ring: "#15803d" },
];

const SUGGESTED_TAGS = ["bestseller", "chef-special", "new", "must-try"];

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function MenuPage() {
  const { toast } = useToast();
  const { shop } = useAuth();
  const [, navigate] = useLocation();
  const { prefs, patch, hydrated } = useSettingsPrefs();

  const [board, setBoard] = useState<MenuBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MenuDish | null>(null);
  const [brandOpen, setBrandOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBoard(await getMenuBoard());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the menu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const courses = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!board) return [];
    return board.courses
      .map((section) => ({
        course: section.course,
        dishes: needle
          ? section.dishes.filter((dish) => dish.name.toLowerCase().includes(needle))
          : section.dishes,
      }))
      .filter((section) => section.dishes.length > 0);
  }, [board, search]);

  const stats = useMemo(() => {
    const all = board?.courses.flatMap((section) => section.dishes) ?? [];
    return {
      total: all.length,
      offTonight: all.filter((dish) => !dish.menuAvailable).length,
      uncategorised: all.filter((dish) => !dish.menuCourse).length,
      withRecipes: all.filter((dish) => dish.hasRecipe).length,
    };
  }, [board]);

  /**
   * Optimistic, because 86ing a dish happens with a guest already waiting and a
   * switch that takes a round trip to move is a switch a cook taps twice. The
   * board is refetched on failure so the screen can never keep a change the
   * server refused.
   */
  async function saveDish(dish: MenuDish, patchBody: Parameters<typeof updateDishMenu>[1]) {
    setBoard((current) => current && {
      ...current,
      courses: current.courses.map((section) => ({
        ...section,
        dishes: section.dishes.map((row) => (row.id === dish.id ? { ...row, ...patchBody } as MenuDish : row)),
      })),
    });
    try {
      await updateDishMenu(dish.id, patchBody);
      // A course change moves the dish between sections, which only a refetch
      // can regroup correctly.
      if ("menuCourse" in patchBody) await refresh();
    } catch (err) {
      await refresh();
      toast({
        title: "Could not save that",
        description: err instanceof Error ? err.message : "The menu was put back as it was.",
        variant: "destructive",
      });
    }
  }

  const brand = readMenuBrand(prefs);
  const guestOrders = guestOrdersEnabled(prefs);
  const menuUrl = shop?.id ? `/t/${shop.id}` : "";

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-[#64748b]">
        <Loader2 className="mr-2 animate-spin" size={18} /> Loading the menu…
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 lg:p-6" data-testid="menu-page">
      <PageHeader
        title="Menu"
        description="How your dishes read to a guest: the course they sit in, the veg mark, how long the kitchen needs — and what you've run out of tonight."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10 gap-2 rounded-[10px] font-bold" onClick={() => setBrandOpen(true)}>
              <Palette size={15} /> Menu look
            </Button>
            <Button variant="outline" className="h-10 gap-2 rounded-[10px] font-bold" onClick={() => navigate("/kitchen-stock")}>
              <ChefHat size={15} /> Kitchen stock
            </Button>
            {menuUrl ? (
              <Button asChild className="h-10 gap-2 rounded-[10px] font-black">
                <a href={menuUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} /> Preview guest menu
                </a>
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] p-3 text-[13px] text-[#b91c1c]">{error}</div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Utensils size={15} />} label="Dishes" value={String(stats.total)} />
        <Stat icon={<Flame size={15} />} label="Off tonight" value={String(stats.offTonight)} tone={stats.offTonight > 0 ? "orange" : undefined} />
        <Stat icon={<Sparkles size={15} />} label="No course yet" value={String(stats.uncategorised)} tone={stats.uncategorised > 0 ? "amber" : undefined} />
        <Stat icon={<ChefHat size={15} />} label="With recipes" value={String(stats.withRecipes)} />
      </div>

      <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2">
        <Search size={15} className="text-[#94a3b8]" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a dish"
          className="w-full bg-transparent text-[13px] outline-none"
          data-testid="menu-search"
        />
      </div>

      {courses.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-[13px] text-[#64748b]">
          {board?.dishCount === 0
            ? "No dishes yet. Add them on the Products screen — then set the course and veg mark here."
            : "Nothing matches that search."}
        </div>
      ) : null}

      {courses.map((section) => (
        <section key={section.course} className="space-y-2">
          <h2 className="text-[12px] font-black uppercase tracking-wider text-[#64748b]">
            {section.course} <span className="text-[#b6c0d1]">· {section.dishes.length}</span>
          </h2>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {section.dishes.map((dish) => (
              <DishCard
                key={dish.id}
                dish={dish}
                onEdit={() => setEditing(dish)}
                onToggleAvailable={(next) => void saveDish(dish, { menuAvailable: next })}
              />
            ))}
          </div>
        </section>
      ))}

      {editing ? (
        <DishEditor
          dish={editing}
          courses={board?.suggestedCourses ?? []}
          usedCourses={board?.courses.map((section) => section.course) ?? []}
          onClose={() => setEditing(null)}
          onSave={async (patchBody) => {
            await saveDish(editing, patchBody);
            setEditing(null);
          }}
        />
      ) : null}

      <BrandEditor
        open={brandOpen}
        brand={brand}
        guestOrders={guestOrders}
        disabled={!hydrated}
        shopName={shop?.name ?? ""}
        onClose={() => setBrandOpen(false)}
        onSave={async (next, nextGuestOrders) => {
          const existing = readRestaurantSettings(prefs);
          await patch({
            restaurant: {
              ...existing,
              brand: toStoredBrand(next),
              dineIn: { ...(existing.dineIn ?? {}), guestOrders: nextGuestOrders },
            },
          }, { immediate: true });
          setBrandOpen(false);
          toast({ title: "Menu look saved", description: "Guests scanning a table QR will see it on their next open." });
        }}
      />
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: keyof typeof CHIP_TONES }) {
  return (
    <div className="rounded-2xl border bg-white p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-[#64748b]">
        {icon} {label}
      </div>
      <div className={cn("mt-1 font-display text-[20px] font-black", tone ? "text-[#b45309]" : "text-[var(--brand-ink)]")}>{value}</div>
    </div>
  );
}

function FoodMark({ foodType }: { foodType: FoodType | null }) {
  const mark = FOOD_TYPES.find((row) => row.key === foodType);
  if (!mark) return null;
  return (
    <span
      title={mark.label}
      aria-label={mark.label}
      className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px]"
      style={{ borderColor: mark.ring }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: mark.ring }} />
    </span>
  );
}

function DishCard({
  dish, onEdit, onToggleAvailable,
}: {
  dish: MenuDish;
  onEdit: () => void;
  onToggleAvailable: (next: boolean) => void;
}) {
  // A dish with a recipe that cannot be made is a different fact from one the
  // cook switched off, and the card says which — otherwise the only way to find
  // out is to turn the switch back on and watch it do nothing.
  const shortOfIngredients = dish.hasRecipe && dish.portionsLeft !== null && dish.portionsLeft <= 0;
  return (
    <div
      data-testid={`menu-dish-${dish.id}`}
      className={cn("flex flex-col gap-2 rounded-2xl border bg-white p-3.5", !dish.menuAvailable && "bg-[#fafafa]")}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <FoodMark foodType={dish.foodType} />
            <span className={cn("truncate font-display text-[15px] font-black text-[var(--brand-ink)]", !dish.menuAvailable && "text-[#94a3b8] line-through")}>
              {dish.name}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[#64748b]">
            <span className="font-black text-[var(--brand-ink)]">{rupees(dish.price)}</span>
            {dish.prepMinutes ? <span className="flex items-center gap-0.5"><Clock size={10} /> {dish.prepMinutes}m</span> : null}
            {dish.spiceLevel ? (
              <span className="flex items-center">
                {Array.from({ length: dish.spiceLevel }).map((_, index) => <Flame key={index} size={10} className="text-[#dc2626]" />)}
              </span>
            ) : null}
            {dish.hasRecipe && dish.portionsLeft !== null ? (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[9.5px] font-black uppercase",
                CHIP_TONES[dish.portionsLeft <= 0 ? "red" : dish.portionsLeft <= 5 ? "amber" : "green"])}>
                {dish.portionsLeft} left
              </span>
            ) : null}
          </div>
          {dish.tags.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {dish.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-[#eef2ff] px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wide text-[#4338ca]">
                  {tag.replace(/-/g, " ")}
                </span>
              ))}
            </div>
          ) : null}
        </button>

        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={dish.menuAvailable}
            onCheckedChange={onToggleAvailable}
            aria-label={`${dish.name} available tonight`}
            data-testid={`menu-available-${dish.id}`}
          />
          <span className="text-[9.5px] font-black uppercase tracking-wide text-[#94a3b8]">
            {dish.menuAvailable ? "On" : "86'd"}
          </span>
        </div>
      </div>

      {shortOfIngredients ? (
        <p className="rounded-lg bg-[#fff7ed] px-2 py-1.5 text-[11px] font-semibold text-[#9a3412]">
          Ingredients have run out — guests can't order this even while it's switched on.
        </p>
      ) : null}
    </div>
  );
}

function DishEditor({
  dish, courses, usedCourses, onClose, onSave,
}: {
  dish: MenuDish;
  courses: string[];
  usedCourses: string[];
  onClose: () => void;
  onSave: (patch: Parameters<typeof updateDishMenu>[1]) => Promise<void>;
}) {
  const [course, setCourse] = useState(dish.menuCourse ?? "");
  const [foodType, setFoodType] = useState<FoodType | null>(dish.foodType);
  const [spice, setSpice] = useState(dish.spiceLevel ?? 0);
  const [prep, setPrep] = useState(dish.prepMinutes ? String(dish.prepMinutes) : "");
  const [tags, setTags] = useState<string[]>(dish.tags);
  const [saving, setSaving] = useState(false);

  const options = useMemo(
    () => [...new Set([...usedCourses.filter((row) => row !== "Other"), ...courses])],
    [usedCourses, courses],
  );

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{dish.name}</DialogTitle></DialogHeader>

        <div className="space-y-3.5 py-1">
          <div className="space-y-1.5">
            <Label>Course</Label>
            <Input
              value={course}
              list="menu-course-options"
              placeholder="Starters / Main course / Breads"
              onChange={(event) => setCourse(event.target.value)}
            />
            {/* A datalist rather than a select: "Dim sum", "Thali" and "Tandoor"
                are courses too, and a fixed list quietly tells every restaurant
                that is not North Indian that this was not built for them. */}
            <datalist id="menu-course-options">
              {options.map((option) => <option key={option} value={option} />)}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <Label>Food type</Label>
            <div className="flex flex-wrap gap-1.5">
              {FOOD_TYPES.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => setFoodType(foodType === row.key ? null : row.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold",
                    foodType === row.key ? "border-[var(--brand)] bg-[#eff6ff] text-[var(--brand)]" : "text-[#64748b]",
                  )}
                >
                  <span className="grid h-3 w-3 place-items-center rounded-[2px] border-[1.5px]" style={{ borderColor: row.ring }}>
                    <span className="h-1 w-1 rounded-full" style={{ background: row.ring }} />
                  </span>
                  {row.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Spice</Label>
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setSpice(level)}
                    className={cn("flex h-9 flex-1 items-center justify-center rounded-[8px] border text-[12px] font-black",
                      spice === level ? "border-[#dc2626] bg-[#fef2f2] text-[#dc2626]" : "text-[#64748b]")}
                  >
                    {level === 0 ? "—" : Array.from({ length: level }).map((_, index) => <Flame key={index} size={11} />)}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Kitchen time (min)</Label>
              <Input value={prep} inputMode="numeric" placeholder="15" onChange={(event) => setPrep(event.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...SUGGESTED_TAGS, ...tags])].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTags((current) => current.includes(tag) ? current.filter((row) => row !== tag) : [...current, tag])}
                  className={cn("rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-wide",
                    tags.includes(tag) ? "border-[#4338ca] bg-[#eef2ff] text-[#4338ca]" : "text-[#64748b]")}
                >
                  {tag.replace(/-/g, " ")}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave({
                menuCourse: course.trim() || null,
                foodType,
                spiceLevel: spice > 0 ? spice : null,
                prepMinutes: prep.trim() ? Math.max(0, Number(prep) || 0) : null,
                tags,
              });
              setSaving(false);
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What makes one restaurant's guest page look like that restaurant's.
 *
 * The preview is a real render of the theme rather than a swatch, because the
 * question an owner is actually asking is "does my menu look right", and a row
 * of coloured circles cannot answer it.
 */
function BrandEditor({
  open, brand, guestOrders, disabled, shopName, onClose, onSave,
}: {
  open: boolean;
  brand: MenuBrand;
  guestOrders: boolean;
  disabled: boolean;
  shopName: string;
  onClose: () => void;
  onSave: (brand: MenuBrand, guestOrders: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState<MenuBrand>(brand);
  const [orders, setOrders] = useState(guestOrders);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setDraft(brand ?? BLANK_BRAND); setOrders(guestOrders); }
  }, [open, brand, guestOrders]);

  const preview = themeOption(draft.theme);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>How your guest menu looks</DialogTitle></DialogHeader>

        <div className="space-y-3.5 py-1">
          <div className="rounded-2xl p-4 text-center" style={{ background: preview.surface, color: preview.ink }}>
            <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: `${preview.accent}1f`, color: preview.accent }}>
              <ChefHat size={20} />
            </div>
            <div className="font-display text-[17px] font-black">{draft.displayName.trim() || shopName || "Your restaurant"}</div>
            {draft.tagline.trim() ? <div className="mt-0.5 text-[11px] opacity-70">{draft.tagline}</div> : null}
            <div className="mx-auto mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black"
              style={{ background: `${preview.accent}1f`, color: preview.accent }}>
              <Utensils size={11} /> T5 · Dining
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {MENU_THEME_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, theme: option.key }))}
                className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold",
                  draft.theme === option.key ? "border-[var(--brand)] text-[var(--brand)]" : "text-[#64748b]")}
              >
                <span className="h-3 w-3 rounded-full" style={{ background: option.accent }} />
                {option.label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>Name on the menu</Label>
            <Input
              value={draft.displayName}
              placeholder={shopName || "Spice Route"}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tagline</Label>
            <Input
              value={draft.tagline}
              placeholder="South Indian kitchen since 1998"
              onChange={(event) => setDraft({ ...draft, tagline: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Logo URL <span className="font-normal text-[#94a3b8]">(optional)</span></Label>
            <Input
              value={draft.logoUrl}
              placeholder="https://…"
              onChange={(event) => setDraft({ ...draft, logoUrl: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Note at the bottom</Label>
            <Input
              value={draft.footerNote}
              placeholder="Prices exclusive of taxes · 5% service charge"
              onChange={(event) => setDraft({ ...draft, footerNote: event.target.value })}
            />
          </div>

          <label className="flex items-start gap-3 rounded-xl border p-3">
            <Switch checked={orders} onCheckedChange={setOrders} aria-label="Let guests order from the QR" />
            <span className="text-[12px] leading-relaxed text-[#52627e]">
              <span className="block font-black text-[var(--brand-ink)]">Let guests order from the table QR</span>
              Turn this off to show the menu only — guests still scan and read it, but order through your staff.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={disabled || saving}
            onClick={async () => { setSaving(true); await onSave(draft, orders); setSaving(false); }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
