import { LocalRepository } from "@/lib/offline/repositories/base";

export const subscriptionCacheRepository = new LocalRepository<Record<string, unknown>>("subscription_cache", "subscription");
