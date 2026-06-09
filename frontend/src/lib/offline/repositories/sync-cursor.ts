import { LocalRepository } from "@/lib/offline/repositories/base";

export const syncCursorRepository = new LocalRepository<Record<string, unknown>>("sync_cursor", "sync_cursor");
