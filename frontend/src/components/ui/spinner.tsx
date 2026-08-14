import { useAppLanguage } from "@/features/core/settings/i18n";
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { t } = useAppLanguage();
  return (
    <Loader2Icon
      role="status"
      aria-label={t("chrome.loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
