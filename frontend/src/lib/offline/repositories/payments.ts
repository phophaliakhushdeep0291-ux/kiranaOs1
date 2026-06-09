import { LocalRepository } from "@/lib/offline/repositories/base";

export const paymentsRepository = new LocalRepository<Record<string, unknown>>("payments", "payment");
