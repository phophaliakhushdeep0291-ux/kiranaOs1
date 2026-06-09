import { LocalRepository } from "@/lib/offline/repositories/base";

export const inventoryMovementsRepository = new LocalRepository<Record<string, unknown>>("inventory_movements", "inventory_movement");
