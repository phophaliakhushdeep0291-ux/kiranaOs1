import { LocalRepository } from "@/lib/offline/repositories/base";

export const localAuditLogsRepository = new LocalRepository<Record<string, unknown>>("local_audit_logs", "audit_log");
