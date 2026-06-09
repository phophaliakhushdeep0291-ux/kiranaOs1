import { LocalRepository } from "@/lib/offline/repositories/base";

export const billItemsRepository = new LocalRepository<Record<string, unknown>>("bill_items", "bill_item");
