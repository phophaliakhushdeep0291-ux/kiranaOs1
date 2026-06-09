import { LocalRepository } from "@/lib/offline/repositories/base";

export const billsRepository = new LocalRepository<Record<string, unknown>>("bills", "bill");
