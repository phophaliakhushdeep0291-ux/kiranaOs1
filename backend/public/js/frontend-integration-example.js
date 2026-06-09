/**
 * Example only — do not include directly unless you want this exact behavior.
 *
 * Minimal usage from the existing billing UI:
 *
 * import { backend, confirmBillOnlineFirst, hydrateFrontendCache } from './js/backend-modules.js';
 *
 * await backend.auth.login({ mobile, password });
 * await hydrateFrontendCache();
 * const result = await confirmBillOnlineFirst(billPayload);
 *
 * Keep your current UI functions. Replace only their localStorage read/write
 * calls module by module when you are ready.
 */
