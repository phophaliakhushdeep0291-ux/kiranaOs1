import { LocalRepository } from "@/lib/offline/repositories/base";

export const productsRepository = new LocalRepository<Record<string, unknown>>("products", "product");
