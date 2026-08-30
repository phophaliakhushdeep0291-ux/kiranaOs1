import { lazy, Suspense, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAppLanguage } from "@/features/core/settings/i18n";

/**
 * The floating way in, and nothing else.
 *
 * The panel is loaded only once someone opens it. It is a screen a shopkeeper
 * touches occasionally, not on the path to billing, and the till has to start
 * fast on a cheap Android — so it has no business sitting in the startup bundle.
 *
 * Unlike the voice button next to it, this is not desktop-only. The person most
 * likely to ask "what is running out" is standing in the shop holding a phone.
 */
const AssistantPanel = lazy(() =>
  import("./AssistantPanel").then((module) => ({ default: module.AssistantPanel })));

export function AssistantLauncher() {
  const { t } = useAppLanguage();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("assistant.open")}
        className="fixed bottom-20 right-4 z-40 grid h-12 w-12 place-items-center rounded-full bg-[var(--brand)] text-white shadow-lg transition hover:scale-105 lg:bottom-6"
      >
        <Sparkles size={20} />
      </button>
      {open ? (
        <Suspense fallback={null}>
          <AssistantPanel open onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}

export default AssistantLauncher;
