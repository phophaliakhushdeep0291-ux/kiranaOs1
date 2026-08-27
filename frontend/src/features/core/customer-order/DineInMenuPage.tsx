import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { guestWebsiteRedirect } from "./restaurant-website";
import {
  AlertTriangle, ChefHat, CheckCircle2, Clock, Flame, Leaf, Loader2, Minus, Plus,
  RefreshCw, Search, ShoppingBag, Utensils, WifiOff, X,
} from "lucide-react";
import {
  CatalogUnavailableError,
  fetchOrderStatus,
  forgetMyOrder,
  loadCustomerCatalog,
  readCachedCatalog,
  readMyOrder,
  rememberMyOrder,
  submitCustomerOrder,
  type CustomerCatalog,
  type CustomerMenuItem,
  type CustomerOrderStatus,
  type SubmitOrderResult,
} from "./catalog";
import { dineInTheme } from "./dine-in-theme";

/**
 * What a guest sees after scanning the QR taped to their table.
 *
 * This is deliberately not the shop storefront with a restaurant skin. A guest
 * at table 5 is not shopping: they are already in the building, they are not
 * choosing a delivery slot, and the one thing they must never have to do is
 * explain where they are sitting. So the page has no address, no basket icon in
 * a corner, and no login — it has a menu, a table name it read off the sticker,
 * and one button.
 *
 * Every restaurant's page looks different because the server sends its own
 * presentation (name, tagline, colours) and the whole page is themed from those
 * custom properties. Two restaurants using this software do not hand their
 * guests the same page with a different logo on it.
 *
 * It lives in core rather than in the restaurant pack for a reason worth stating:
 * the guest is not logged in and has no shop, so the client cannot know which
 * trade this is. The SERVER decides which storefront a shop serves and says so
 * in the catalogue; this page renders what it is told. That is what keeps the
 * public page free of any one trade's code.
 */

const FOOD_TYPE_MARK: Record<string, { label: string; ring: string; dot: string }> = {
  veg: { label: "Veg", ring: "#15803d", dot: "#15803d" },
  vegan: { label: "Vegan", ring: "#15803d", dot: "#15803d" },
  jain: { label: "Jain", ring: "#15803d", dot: "#15803d" },
  egg: { label: "Egg", ring: "#b45309", dot: "#d97706" },
  nonveg: { label: "Non-veg", ring: "#b91c1c", dot: "#b91c1c" },
};

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; catalog: CustomerCatalog }
  | { kind: "error"; message: string; unavailable: boolean };

type GuestAddon = { optionId: string; groupName: string; name: string; price: number; quantity: number };
type GuestCartLine = {
  key: string;
  itemId: string;
  count: number;
  unitPrice: number;
  variationCode?: string;
  variationName?: string;
  addons: GuestAddon[];
};

function newIdempotencyKey(shopCode: string, tableCode: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `dine-in:${shopCode}:${tableCode}:${random}`;
}

export default function DineInMenuPage() {
  const params = useParams<{ shopCode: string; tableCode?: string }>();
  const shopCode = params.shopCode ?? "";
  const tableCode = params.tableCode ?? new URLSearchParams(window.location.search).get("table") ?? "";

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [cartLines, setCartLines] = useState<GuestCartLine[]>([]);
  const [search, setSearch] = useState("");
  const [course, setCourse] = useState("all");
  const [vegOnly, setVegOnly] = useState(false);
  const [note, setNote] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<SubmitOrderResult | null>(null);
  const [tracked, setTracked] = useState<CustomerOrderStatus | null>(null);
  const [configuring, setConfiguring] = useState<CustomerMenuItem | null>(null);

  const reload = useCallback(() => {
    let active = true;
    const cached = readCachedCatalog(shopCode);
    if (cached) setState({ kind: "ready", catalog: cached });
    loadCustomerCatalog(shopCode, {}, undefined, tableCode)
      .then((res) => {
        if (!active) return;
        const destination = res.source === "network" ? guestWebsiteRedirect(res.catalog, window.location.href, tableCode) : null;
        if (destination) { window.location.replace(destination); return; }
        setState({ kind: "ready", catalog: res.catalog });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof CatalogUnavailableError) {
          setState({ kind: "error", unavailable: true, message: err.message });
          return;
        }
        if (!cached) {
          setState({
            kind: "error",
            unavailable: false,
            message: err instanceof Error ? err.message : "Could not load this menu.",
          });
        }
      });
    return () => { active = false; };
  }, [shopCode, tableCode]);

  useEffect(() => reload(), [reload]);

  // The guest's own last order, so closing the tab and reopening the QR shows
  // "your food is being prepared" rather than an empty menu they have to guess at.
  useEffect(() => {
    const mine = readMyOrder(shopCode);
    if (!mine) return;
    let active = true;
    const poll = () => {
      fetchOrderStatus(shopCode, mine.orderId)
        .then((status) => { if (active) setTracked(status); })
        .catch(() => { if (active) forgetMyOrder(shopCode); });
    };
    poll();
    const timer = window.setInterval(poll, 20_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [shopCode, placed]);

  const catalog = state.kind === "ready" ? state.catalog : null;
  const storefront = catalog?.storefront ?? null;
  const theme = useMemo(() => dineInTheme(storefront?.branding), [storefront?.branding]);
  const sections = storefront?.menu ?? [];
  const table = storefront?.table ?? null;

  const itemsById = useMemo(() => {
    const map = new Map<string, CustomerMenuItem>();
    for (const section of sections) for (const item of section.items) map.set(item.id, item);
    return map;
  }, [sections]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sections
      .filter((section) => course === "all" || section.course === course)
      .map((section) => ({
        course: section.course,
        items: section.items.filter((item) => {
          if (vegOnly && item.foodType !== "veg" && item.foodType !== "vegan" && item.foodType !== "jain") return false;
          if (!needle) return true;
          return item.name.toLowerCase().includes(needle) || (item.description ?? "").toLowerCase().includes(needle);
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [sections, course, search, vegOnly]);

  const chosen = useMemo(
    () => cartLines
      .map((line) => ({ line, item: itemsById.get(line.itemId) }))
      .filter((row): row is { line: GuestCartLine; item: CustomerMenuItem } => Boolean(row.item)),
    [cartLines, itemsById],
  );
  const total = chosen.reduce((sum, row) => sum + row.line.unitPrice * row.line.count, 0);
  const itemCount = chosen.reduce((sum, row) => sum + row.line.count, 0);
  // The longest single dish, not the sum: a kitchen cooks a table's order
  // together, so adding the times would promise a wait nobody is going to have.
  const waitMinutes = chosen.reduce((max, row) => Math.max(max, row.item.prepMinutes ?? 0), 0);

  function itemQuantity(itemId: string) {
    return cartLines.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.count, 0);
  }

  function addConfiguredLine(item: CustomerMenuItem, variationCode: string | undefined, variationName: string | undefined, basePrice: number, addons: GuestAddon[]) {
    const fingerprint = addons.map((addon) => `${addon.optionId}x${addon.quantity}`).sort().join(",") || "plain";
    const key = `${item.id}::${variationCode ?? "default"}::${fingerprint}`;
    const unitPrice = basePrice + addons.reduce((sum, addon) => sum + addon.price * addon.quantity, 0);
    setCartLines((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) return current.map((line) => line.key === key ? { ...line, count: Math.min(30, line.count + 1) } : line);
      return [...current, { key, itemId: item.id, count: 1, unitPrice, variationCode, variationName, addons }];
    });
  }

  function addItem(item: CustomerMenuItem) {
    if ((item.variations?.length ?? 0) > 0 || (item.addonGroups?.length ?? 0) > 0) {
      setConfiguring(item);
      return;
    }
    addConfiguredLine(item, undefined, undefined, item.price, []);
  }

  function removeOneItem(itemId: string) {
    setCartLines((current) => {
      const index = current.map((line) => line.itemId).lastIndexOf(itemId);
      if (index < 0) return current;
      const target = current[index];
      if (target.count > 1) return current.map((line, row) => row === index ? { ...line, count: line.count - 1 } : line);
      return current.filter((_, row) => row !== index);
    });
  }

  function setLineQuantity(key: string, next: number) {
    setCartLines((current) => current
      .map((line) => line.key === key ? { ...line, count: Math.max(0, Math.min(30, next)) } : line)
      .filter((line) => line.count > 0));
  }

  async function placeOrder() {
    if (chosen.length === 0 || !catalog) return;
    setPlacing(true);
    setSubmitError(null);
    try {
      const result = await submitCustomerOrder(
        shopCode,
        {
          customerName: "",
          customerMobile: "",
          note: note.trim(),
          locationId: catalog.location?.id ?? "",
          fulfillmentType: "pickup",
          tableCode,
        },
        chosen.map(({ item, line }) => ({
          productId: item.id,
          qty: line.count,
          variationCode: line.variationCode,
          addons: line.addons.map((addon) => ({ optionId: addon.optionId, quantity: addon.quantity })),
        })),
        newIdempotencyKey(shopCode, tableCode),
      );
      rememberMyOrder(shopCode, result.orderId);
      setPlaced(result);
      setCartLines([]);
      setNote("");
      setReviewOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not send your order.");
    } finally {
      setPlacing(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-[#faf7f2] text-[#57534e]">
        <div className="flex items-center gap-2 text-[14px]"><Loader2 className="animate-spin" size={18} /> Loading the menu…</div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="grid min-h-screen place-items-center bg-[#faf7f2] p-6 text-center">
        <div className="max-w-sm space-y-3">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#fee2e2] text-[#b91c1c]">
            {state.unavailable ? <Utensils size={26} /> : <WifiOff size={26} />}
          </div>
          <p className="text-[16px] font-black text-[#1c1917]">
            {state.unavailable ? "This menu isn't available" : "Couldn't load the menu"}
          </p>
          <p className="text-[13px] leading-relaxed text-[#57534e]">{state.message}</p>
          <button
            type="button"
            onClick={() => reload()}
            className="mx-auto flex items-center gap-2 rounded-xl bg-[#1c1917] px-4 py-2.5 text-[13px] font-bold text-white"
          >
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      </div>
    );
  }

  const guestOrdersOn = storefront?.guestOrdersEnabled !== false;
  const canOrder = guestOrdersOn && Boolean(table);

  return (
    <div
      data-testid="dine-in-menu"
      className="min-h-screen pb-32"
      style={{ ...theme.style, background: "var(--menu-surface)", color: "var(--menu-ink)" } as React.CSSProperties}
    >
      <header className="px-4 pt-7 text-center">
        {storefront?.branding?.logoUrl ? (
          <img src={storefront.branding.logoUrl} alt="" className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover" />
        ) : (
          <div
            className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl"
            style={{ background: "var(--menu-tint)", color: "var(--menu-accent)" }}
          >
            <ChefHat size={26} />
          </div>
        )}
        <h1 className="font-display text-[26px] font-black leading-tight tracking-tight">
          {storefront?.branding?.displayName ?? catalog?.shop.name}
        </h1>
        {storefront?.branding?.tagline ? (
          <p className="mt-1 text-[13px]" style={{ color: "var(--menu-muted)" }}>{storefront.branding.tagline}</p>
        ) : null}

        {table ? (
          <div
            className="mx-auto mt-3 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-black"
            style={{ background: "var(--menu-tint)", color: "var(--menu-accent)" }}
          >
            <Utensils size={13} /> {table.name} · {table.section}
          </div>
        ) : (
          <div className="mx-auto mt-3 flex max-w-sm items-start gap-2 rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-3 text-left text-[12px] leading-relaxed text-[#9a3412]">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              {storefront?.tableRequested
                ? "We couldn't match that table code, so this is the menu only. Please order with a member of staff."
                : "You're viewing the menu. Scan the QR on your table to order from your seat."}
            </span>
          </div>
        )}
      </header>

      {tracked && tracked.stage !== "declined" ? (
        <div className="mx-4 mt-5 rounded-2xl border p-3.5" style={{ borderColor: "var(--menu-line)", background: "var(--menu-card)" }}>
          <div className="flex items-center gap-2 text-[13px] font-black">
            {tracked.stage === "ready" ? <CheckCircle2 size={16} style={{ color: "var(--menu-accent)" }} /> : <Clock size={16} style={{ color: "var(--menu-accent)" }} />}
            {tracked.stage === "received" ? "Order sent to the kitchen" : tracked.stage === "preparing" ? "Your food is being prepared" : "Ready"}
          </div>
          <p className="mt-1 text-[12px]" style={{ color: "var(--menu-muted)" }}>
            {tracked.itemCount} item{tracked.itemCount === 1 ? "" : "s"} · {rupees(tracked.estimatedTotal)}
            {tracked.tableName ? ` · ${tracked.tableName}` : ""}
          </p>
        </div>
      ) : null}

      <div className="sticky top-0 z-20 mt-5 px-4 pb-2 pt-2 backdrop-blur" style={{ background: "color-mix(in srgb, var(--menu-surface) 88%, transparent)" }}>
        <div className="flex min-h-12 items-center gap-2 rounded-xl border px-3" style={{ borderColor: "var(--menu-line)", background: "var(--menu-card)" }}>
          <Search size={15} style={{ color: "var(--menu-muted)" }} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search the menu"
            className="h-11 w-full bg-transparent text-[13px] outline-none placeholder:text-[color:var(--menu-muted)]"
          />
          {search ? <button type="button" onClick={() => setSearch("")} aria-label="Clear" className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl"><X size={14} style={{ color: "var(--menu-muted)" }} /></button> : null}
        </div>

        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip active={vegOnly} onClick={() => setVegOnly((on) => !on)} accentWhenActive="#15803d">
            <Leaf size={12} /> Veg only
          </Chip>
          <Chip active={course === "all"} onClick={() => setCourse("all")}>All</Chip>
          {sections.map((section) => (
            <Chip key={section.course} active={course === section.course} onClick={() => setCourse(section.course)}>
              {section.course}
            </Chip>
          ))}
        </div>
      </div>

      <main className="space-y-6 px-4 pt-3">
        {visible.length === 0 ? (
          <p className="py-14 text-center text-[13px]" style={{ color: "var(--menu-muted)" }}>
            Nothing matches that. Try another search.
          </p>
        ) : null}

        {visible.map((section) => (
          <section key={section.course}>
            <h2 className="mb-2.5 text-[12px] font-black uppercase tracking-[0.14em]" style={{ color: "var(--menu-accent)" }}>
              {section.course}
            </h2>
            <div className="space-y-2.5">
              {section.items.map((item) => (
                <DishRow
                  key={item.id}
                  item={item}
                  qty={itemQuantity(item.id)}
                  canOrder={canOrder}
                  onAdd={() => addItem(item)}
                  onRemove={() => removeOneItem(item.id)}
                />
              ))}
            </div>
          </section>
        ))}

        {storefront?.branding?.footerNote ? (
          <p className="pb-4 pt-2 text-center text-[11px]" style={{ color: "var(--menu-muted)" }}>
            {storefront.branding.footerNote}
          </p>
        ) : null}
        {!guestOrdersOn ? (
          <p className="pb-4 text-center text-[12px]" style={{ color: "var(--menu-muted)" }}>
            Please place your order with a member of staff.
          </p>
        ) : null}
      </main>

      {canOrder && itemCount > 0 ? (
        <button
          type="button"
          data-testid="dine-in-review"
          onClick={() => setReviewOpen(true)}
          className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-between rounded-2xl px-4 py-3.5 text-white shadow-lg"
          style={{ background: "var(--menu-accent)" }}
        >
          <span className="flex items-center gap-2 text-[13px] font-black">
            <ShoppingBag size={16} /> {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          <span className="text-[14px] font-black">{rupees(total)} · Review</span>
        </button>
      ) : null}

      {reviewOpen ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={() => setReviewOpen(false)}>
          <div
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl p-5"
            style={{ background: "var(--menu-surface)", color: "var(--menu-ink)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-[18px] font-black">Your order · {table?.name}</p>
              <button type="button" aria-label="Close" onClick={() => setReviewOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"><X size={20} /></button>
            </div>

            <div className="space-y-2">
              {chosen.map(({ item, line }) => (
                <div key={line.key} className="flex items-center gap-3 rounded-xl border p-2.5" style={{ borderColor: "var(--menu-line)", background: "var(--menu-card)" }}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{item.name}{line.variationName ? ` · ${line.variationName}` : ""}</div>
                    {line.addons.length > 0 ? <div className="mt-0.5 line-clamp-2 text-[10.5px]" style={{ color: "var(--menu-muted)" }}>{line.addons.map((addon) => `${addon.quantity > 1 ? `${addon.quantity}× ` : ""}${addon.name}`).join(", ")}</div> : null}
                    <div className="text-[11px]" style={{ color: "var(--menu-muted)" }}>{rupees(line.unitPrice)} each</div>
                  </div>
                  <Stepper qty={line.count} onChange={(next) => setLineQuantity(line.key, next)} />
                  <div className="w-16 text-right text-[13px] font-black">{rupees(line.unitPrice * line.count)}</div>
                </div>
              ))}
            </div>

            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 300))}
              placeholder="Anything the kitchen should know? (less spicy, no onion…)"
              rows={2}
              className="mt-3 w-full rounded-xl border p-3 text-[13px] outline-none"
              style={{ borderColor: "var(--menu-line)", background: "var(--menu-card)", color: "var(--menu-ink)" }}
            />

            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-[13px]" style={{ color: "var(--menu-muted)" }}>
                {itemCount} item{itemCount === 1 ? "" : "s"}
                {waitMinutes > 0 ? ` · about ${waitMinutes} min` : ""}
              </span>
              <span className="font-display text-[20px] font-black">{rupees(total)}</span>
            </div>
            <p className="mt-1 text-[11px]" style={{ color: "var(--menu-muted)" }}>
              Taxes and any service charge are added to the bill you settle at the table.
            </p>

            {submitError ? (
              <p className="mt-2 rounded-xl bg-[#fee2e2] p-2.5 text-[12px] font-semibold text-[#b91c1c]">{submitError}</p>
            ) : null}

            <button
              type="button"
              data-testid="dine-in-place-order"
              disabled={placing || chosen.length === 0}
              onClick={() => void placeOrder()}
              className="mt-3 w-full rounded-2xl py-3.5 text-[14px] font-black text-white disabled:opacity-60"
              style={{ background: "var(--menu-accent)" }}
            >
              {placing ? "Sending to the kitchen…" : `Send to kitchen · ${table?.name}`}
            </button>
          </div>
        </div>
      ) : null}

      {placed ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" onClick={() => setPlaced(null)}>
          <div className="w-full max-w-sm rounded-3xl p-6 text-center" style={{ background: "var(--menu-surface)", color: "var(--menu-ink)" }} onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl" style={{ background: "var(--menu-tint)", color: "var(--menu-accent)" }}>
              <CheckCircle2 size={32} />
            </div>
            <p className="mt-3 font-display text-[19px] font-black">The kitchen has your order</p>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--menu-muted)" }}>
              {placed.itemCount} item{placed.itemCount === 1 ? "" : "s"} for {placed.tableName ?? table?.name}.
              Add more anytime from this page — it all goes on one bill.
            </p>
            <button
              type="button"
              onClick={() => setPlaced(null)}
              className="mt-4 w-full rounded-2xl py-3 text-[14px] font-black text-white"
              style={{ background: "var(--menu-accent)" }}
            >
              Back to the menu
            </button>
          </div>
        </div>
      ) : null}

      {configuring ? (
        <GuestDishConfigurator
          item={configuring}
          onCancel={() => setConfiguring(null)}
          onConfirm={(selection) => {
            addConfiguredLine(configuring, selection.variationCode, selection.variationName, selection.basePrice, selection.addons);
            setConfiguring(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Chip({
  active, onClick, children, accentWhenActive,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accentWhenActive?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border px-3 py-2 text-[12px] font-bold transition"
      style={active
        ? { background: accentWhenActive ?? "var(--menu-accent)", borderColor: "transparent", color: "#fff" }
        : { background: "var(--menu-card)", borderColor: "var(--menu-line)", color: "var(--menu-muted)" }}
    >
      {children}
    </button>
  );
}

/**
 * One dish.
 *
 * The veg/non-veg mark is drawn as the square-with-a-dot Indian menus are
 * expected to carry rather than written as a word, because that is the mark a
 * diner scans for without reading — and a menu that only says "Veg" in small
 * text is a menu somebody has to squint at to use.
 */
function DishRow({
  item, qty, canOrder, onAdd, onRemove,
}: {
  item: CustomerMenuItem;
  qty: number;
  canOrder: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const mark = item.foodType ? FOOD_TYPE_MARK[item.foodType] : null;
  return (
    <article
      data-testid={`dish-${item.id}`}
      className="flex gap-3 rounded-2xl border p-3"
      style={{ borderColor: "var(--menu-line)", background: "var(--menu-card)", boxShadow: "var(--menu-shadow)" }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {mark ? (
            <span
              aria-label={mark.label}
              title={mark.label}
              className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px]"
              style={{ borderColor: mark.ring }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: mark.dot }} />
            </span>
          ) : null}
          <h3 className="truncate text-[14px] font-black">{item.name}</h3>
          {item.spiceLevel ? (
            <span className="flex shrink-0 items-center" title={`Spice level ${item.spiceLevel}`}>
              {Array.from({ length: item.spiceLevel }).map((_, index) => (
                <Flame key={index} size={11} className="text-[#dc2626]" />
              ))}
            </span>
          ) : null}
        </div>

        {item.tags.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wide"
                style={{ background: "var(--menu-tint)", color: "var(--menu-accent)" }}>
                {tag.replace(/-/g, " ")}
              </span>
            ))}
          </div>
        ) : null}

        {item.description ? (
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed" style={{ color: "var(--menu-muted)" }}>{item.description}</p>
        ) : null}

        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[14px] font-black">{rupees(item.price)}</span>
          {item.prepMinutes ? (
            <span className="flex items-center gap-1 text-[11px]" style={{ color: "var(--menu-muted)" }}>
              <Clock size={11} /> {item.prepMinutes} min
            </span>
          ) : null}
          {item.lastFew ? (
            <span className="rounded-full bg-[#fef3c7] px-1.5 py-0.5 text-[9.5px] font-black uppercase text-[#92400e]">Last few</span>
          ) : null}
        </div>
      </div>

      {item.imageUrl ? (
        <img src={item.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
      ) : null}

      {canOrder ? (
        <div className="flex shrink-0 items-end">
          {qty > 0
            ? <Stepper qty={qty} onChange={(next) => next < qty ? onRemove() : onAdd()} />
            : (
              <button
                type="button"
                onClick={onAdd}
                className="min-h-11 rounded-xl border-[1.5px] px-4 py-2 text-[12px] font-black"
                style={{ borderColor: "var(--menu-accent)", color: "var(--menu-accent)" }}
              >
                {(item.variations?.length ?? 0) > 0 || (item.addonGroups?.length ?? 0) > 0 ? "Choose" : "Add"}
              </button>
            )}
        </div>
      ) : null}
    </article>
  );
}

function GuestDishConfigurator({
  item, onCancel, onConfirm,
}: {
  item: CustomerMenuItem;
  onCancel: () => void;
  onConfirm: (selection: { variationCode?: string; variationName?: string; basePrice: number; addons: GuestAddon[] }) => void;
}) {
  const variations = item.variations ?? [];
  const groups = item.addonGroups ?? [];
  const defaultVariation = variations.find((variation) => variation.isDefault) ?? variations[0];
  const [variationCode, setVariationCode] = useState(defaultVariation?.unitCode ?? "");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [attempted, setAttempted] = useState(false);
  const variation = variations.find((row) => row.unitCode === variationCode) ?? defaultVariation;

  const groupState = groups.map((group) => {
    const count = group.options.reduce((sum, option) => sum + (selected[option.id] ?? 0), 0);
    return { group, count, valid: count >= group.minSelect && (group.maxSelect <= 0 || count <= group.maxSelect) };
  });
  const valid = groupState.every((row) => row.valid);
  const addons: GuestAddon[] = groups.flatMap((group) => group.options
    .filter((option) => (selected[option.id] ?? 0) > 0)
    .map((option) => ({
      optionId: option.id,
      groupName: group.name,
      name: option.name,
      price: option.price,
      quantity: selected[option.id],
    })));
  const basePrice = variation?.price ?? item.price;
  const unitPrice = basePrice + addons.reduce((sum, addon) => sum + addon.price * addon.quantity, 0);

  function setOption(group: NonNullable<CustomerMenuItem["addonGroups"]>[number], optionId: string, next: number) {
    const currentCount = group.options.reduce((sum, option) => sum + (selected[option.id] ?? 0), 0);
    const previous = selected[optionId] ?? 0;
    const clamped = Math.max(0, Math.min(20, next));
    if (group.maxSelect > 0 && currentCount - previous + clamped > group.maxSelect) return;
    setSelected((current) => {
      if (clamped <= 0) {
        const { [optionId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [optionId]: clamped };
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/55" onClick={onCancel}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl p-5" style={{ background: "var(--menu-surface)", color: "var(--menu-ink)" }} onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto max-w-xl">
          <div className="flex items-start justify-between gap-3">
            <div><p className="font-display text-[19px] font-black">{item.name}</p><p className="mt-0.5 text-[12px]" style={{ color: "var(--menu-muted)" }}>Make it exactly how you want it.</p></div>
            <button type="button" aria-label="Close choices" onClick={onCancel} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--menu-line)" }}><X size={18} /></button>
          </div>

          {variations.length > 0 ? (
            <section className="mt-4">
              <h3 className="text-[12px] font-black uppercase tracking-wider" style={{ color: "var(--menu-accent)" }}>Choose a portion</h3>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {variations.map((row) => (
                  <button key={row.unitCode} type="button" onClick={() => setVariationCode(row.unitCode)} className="flex min-h-12 items-center justify-between rounded-xl border p-3 text-left" style={row.unitCode === variation?.unitCode ? { borderColor: "var(--menu-accent)", background: "var(--menu-tint)" } : { borderColor: "var(--menu-line)", background: "var(--menu-card)" }}>
                    <span className="text-[13px] font-black">{row.name}</span><span className="text-[12px] font-bold">{rupees(row.price)}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="mt-4 space-y-4">
            {groupState.map(({ group, count, valid: groupValid }) => (
              <section key={group.id} className="rounded-2xl border p-3.5" style={{ borderColor: attempted && !groupValid ? "#fca5a5" : "var(--menu-line)", background: "var(--menu-card)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="text-[13px] font-black">{group.name}</h3><p className="text-[10.5px]" style={{ color: "var(--menu-muted)" }}>{group.minSelect > 0 ? `Choose at least ${group.minSelect}` : "Optional"}{group.maxSelect > 0 ? ` · up to ${group.maxSelect}` : ""}</p></div>
                  <span className="rounded-full px-2 py-1 text-[10px] font-black" style={{ background: "var(--menu-tint)", color: "var(--menu-accent)" }}>{count} chosen</span>
                </div>
                <div className="mt-2 space-y-2">
                  {group.options.map((option) => {
                    const quantity = selected[option.id] ?? 0;
                    return (
                      <div key={option.id} className="flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: quantity > 0 ? "var(--menu-accent)" : "var(--menu-line)" }}>
                        <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => setOption(group, option.id, quantity > 0 ? 0 : 1)}><span className="block text-[12px] font-bold">{option.name}</span><span className="text-[10.5px]" style={{ color: "var(--menu-muted)" }}>{option.price > 0 ? `+${rupees(option.price)}` : "No extra charge"}</span></button>
                        {quantity > 0 ? <Stepper qty={quantity} onChange={(next) => setOption(group, option.id, next)} /> : null}
                      </div>
                    );
                  })}
                </div>
                {attempted && !groupValid ? <p className="mt-2 text-[11px] font-bold text-[#b91c1c]">Please complete this choice.</p> : null}
              </section>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setAttempted(true);
              if (!valid) return;
              onConfirm({ variationCode: variation?.unitCode, variationName: variation?.name, basePrice, addons });
            }}
            className="mt-5 flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-[14px] font-black text-white"
            style={{ background: "var(--menu-accent)" }}
          >
            <span>Add this dish</span><span>{rupees(unitPrice)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({ qty, onChange }: { qty: number; onChange: (next: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-xl px-1 py-1" style={{ background: "var(--menu-tint)" }}>
      <button type="button" aria-label="One less" onClick={() => onChange(qty - 1)} className="grid h-11 w-11 place-items-center rounded-lg" style={{ color: "var(--menu-accent)" }}>
        <Minus size={14} />
      </button>
      <span className="min-w-[18px] text-center text-[13px] font-black" style={{ color: "var(--menu-accent)" }}>{qty}</span>
      <button type="button" aria-label="One more" onClick={() => onChange(qty + 1)} className="grid h-11 w-11 place-items-center rounded-lg" style={{ color: "var(--menu-accent)" }}>
        <Plus size={14} />
      </button>
    </div>
  );
}
