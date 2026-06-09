import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface PermissionDeniedProps {
  title?: ReactNode;
  message: ReactNode;
}

export function PermissionDenied({ title = "Permission needed", message }: PermissionDeniedProps) {
  return (
    <Alert variant="destructive" role="alert">
      <ShieldAlert className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
