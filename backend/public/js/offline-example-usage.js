/**
 * Example only — do not include this file in production pages directly.
 *
 * Existing frontend integration idea:
 * import { saveBillOffline, registerOnlineSync } from './js/offline-sync-queue.js';
 *
 * const unsubscribe = registerOnlineSync({
 *   tokenProvider: () => localStorage.getItem('token'),
 *   onResult: (result) => console.log('Sync result', result),
 * });
 *
 * async function confirmBillWithOfflineFallback(billPayload) {
 *   if (!navigator.onLine) {
 *     return saveBillOffline(billPayload);
 *   }
 *
 *   try {
 *     const res = await fetch('/api/bills/confirm', {
 *       method: 'POST',
 *       headers: {
 *         'Content-Type': 'application/json',
 *         Authorization: `Bearer ${localStorage.getItem('token')}`,
 *       },
 *       body: JSON.stringify(billPayload),
 *     });
 *
 *     if (!res.ok) throw new Error(await res.text());
 *     return res.json();
 *   } catch (error) {
 *     return saveBillOffline(billPayload);
 *   }
 * }
 */
