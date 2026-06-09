import { LocalRepository } from "@/lib/offline/repositories/base";

export const suppliersRepository = new LocalRepository<Record<string, unknown>>("suppliers", "supplier");
