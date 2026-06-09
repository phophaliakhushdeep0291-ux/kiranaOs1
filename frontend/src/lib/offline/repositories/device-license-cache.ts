import { LocalRepository } from "@/lib/offline/repositories/base";

export const deviceLicenseCacheRepository = new LocalRepository<Record<string, unknown>>("device_license_cache", "device_license");
