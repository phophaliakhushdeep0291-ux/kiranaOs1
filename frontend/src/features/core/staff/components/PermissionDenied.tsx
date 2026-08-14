import { useAppLanguage } from "@/features/core/settings/i18n";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function PermissionDenied({ title, message }: { title?: string; message: string }) {
  const { t } = useAppLanguage();
  return (
    <Alert variant="destructive">
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>{title ?? t("products.bulk.ownerPinRequired")}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
