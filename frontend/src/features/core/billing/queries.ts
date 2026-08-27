import { useMutation } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api/http";
import { getMutationOptions, type MutationHookOptions } from "@/lib/api/query-options";
import { createBillLocalFirst } from "@/features/core/billing/local-actions";
import { createBill } from "@/features/core/billing/api";
import type { Bill, BillInput } from "@/types/api";

export interface ConfirmBillVariables { data: BillInput }

export function useConfirmBill(options?: MutationHookOptions<Bill, ConfirmBillVariables>) {
  return useMutation<Bill, ApiClientError, ConfirmBillVariables>({
    ...getMutationOptions<Bill, ConfirmBillVariables>(options),
    // This mutation writes to IndexedDB first. TanStack's default "online"
    // mode pauses it before mutationFn when navigator.onLine is false, leaving
    // the billing UI stuck on Saving and never creating the outbox record.
    networkMode: "always",
    mutationFn: ({ data }) => {
      // Guest snapshots are a server-owned contract. Do not announce a local
      // sale or clear its table before that contract and settlement commit.
      if ((data.items ?? []).some((item) => item.guestOrderId || item.guestOrderLineId)) {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          throw new ApiClientError("Connect to settle a QR order. The bill is still open and has not been saved.", 0, { code: "GUEST_SETTLEMENT_OFFLINE" });
        }
        return createBill(data);
      }
      if (data.offerId || Number(data.loyaltyPointsToRedeem || 0) > 0 || (data.payments ?? []).some((payment) => payment.mode === "gift_card")) {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          throw new ApiClientError("Coupons, rewards, and gift-card redemption need a connection so value and the bill commit together", 0, { code: "VALUE_REDEMPTION_OFFLINE" });
        }
        return createBill(data);
      }
      return createBillLocalFirst(data);
    },
  });
}
