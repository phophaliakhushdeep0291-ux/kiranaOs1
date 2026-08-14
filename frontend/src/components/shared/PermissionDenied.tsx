import { useAppLanguage } from "@/features/core/settings/i18n";
import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface PermissionDeniedProps {
  title?: ReactNode;
  message: ReactNode;
}

export function PermissionDenied({ title, message }: PermissionDeniedProps) {
  const { t } = useAppLanguage();
  return (
    <Alert variant="destructive" role="alert">
      <ShieldAlert className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{title ?? t("products.bulk.ownerPinRequired")}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
