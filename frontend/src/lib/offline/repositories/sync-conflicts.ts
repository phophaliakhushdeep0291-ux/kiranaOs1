import { LocalRepository } from "@/lib/offline/repositories/base";

export const syncConflictsRepository = new LocalRepository<Record<string, unknown>>("sync_conflicts", "sync_conflict");
