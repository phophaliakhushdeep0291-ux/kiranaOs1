import { LocalRepository } from "@/lib/offline/repositories/base";

export const customerLedgerRepository = new LocalRepository<Record<string, unknown>>("customer_ledger", "ledger_entry");
