import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { isActionProtected, loadSecurityPolicy } from "@/features/core/settings/security-policy";
import { recordDataExportLocalFirst, type DataExportApprovalInput } from "./local-actions";
import { useAuth } from "@/features/core/auth/useAuth";

type ExportDetails = Omit<DataExportApprovalInput, "ownerPin" | "reason">;
type ExportRequest = { details: ExportDetails; download: () => void | Promise<unknown> };
type RequestExport = (details: ExportDetails, download: ExportRequest["download"]) => void;
const ExportContext = createContext<RequestExport | null>(null);

export function DataExportProvider({ children }: { children: ReactNode }) {
  const { t } = useAppLanguage();
  const { user } = useAuth();
  const [location] = useLocation();
  const [request, setRequest] = useState<ExportRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const running = useRef(false);

  useEffect(() => {
    generation.current += 1;
    setRequest(null);
    setError(null);
  }, [location, user?.id]);

  async function execute(next: ExportRequest, ownerPin: string, reason: string, expectedGeneration: number) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await recordDataExportLocalFirst({ ...next.details, ownerPin, reason });
      if (expectedGeneration !== generation.current) return;
      await next.download();
      setRequest(null);
    } catch (cause) {
      if (expectedGeneration === generation.current) setError(cause instanceof Error ? cause.message : t("settings.export.failed"));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const requestExport: RequestExport = (details, download) => {
    if (!user || running.current || request) return;
    const next = { details, download };
    setRequest(next);
    setError(null);
    const expectedGeneration = generation.current;
    void loadSecurityPolicy().then((policy) => {
      if (expectedGeneration !== generation.current) return;
      if (!isActionProtected("exportData", policy)) void execute(next, "", "Export allowed by shop security policy", expectedGeneration);
    });
  };

  return <ExportContext.Provider value={requestExport}>
    {children}
    <OwnerPinModal open={Boolean(request)} title={t("settings.export.approve")} description={t("settings.export.help")}
      confirmLabel={t("settings.export.download")} reasonLabel={t("settings.export.reason")} reasonRequired
      loading={busy} error={error} onCancel={() => { if (!running.current) { generation.current += 1; setRequest(null); setError(null); } }}
      onConfirm={({ ownerPin, reason }) => request ? execute(request, ownerPin, reason, generation.current) : undefined} />
  </ExportContext.Provider>;
}

export function useDataExport(): RequestExport {
  const request = useContext(ExportContext);
  if (!request) throw new Error("DataExportProvider is required");
  return request;
}
