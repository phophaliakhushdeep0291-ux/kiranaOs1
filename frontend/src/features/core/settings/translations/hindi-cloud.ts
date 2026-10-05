// The Hindi mirror of english-cloud.ts: the tables only an `onlineOnly` route can
// render, kept out of the offline precache.
//
// The module list here must match EN_CLOUD_MODULES exactly. The completeness test
// compares EN_MODULES and HI_MODULES key-for-key, so a table moved into the cloud
// tier on one side and left in the deferred half on the other fails a test rather
// than shipping a half-translated admin screen. See english-cloud.ts for the
// qualifying tables and the candidates that were rejected.
//
// Nothing here may be imported statically from shell code.
import { assuranceHi } from "./assurance.hi";
import { devicesHi } from "./devices.hi";
import { marketPreviewHi } from "./market-preview.hi";

export const hindiCloudTranslations = {
  ...marketPreviewHi,
  ...assuranceHi,
  ...devicesHi,
};

/** Registered cloud-only modules. `hindi.ts` re-exports these into HI_MODULES. */
export const HI_CLOUD_MODULES = {
  marketPreview: marketPreviewHi,
  assurance: assuranceHi,
  devices: devicesHi,
} as const;
