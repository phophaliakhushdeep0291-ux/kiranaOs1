import { LocalRepository } from "@/lib/offline/repositories/base";

export const customersRepository = new LocalRepository<Record<string, unknown>>("customers", "customer");
