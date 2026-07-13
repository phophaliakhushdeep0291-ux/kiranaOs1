import { useMutation } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api/http";
import { getMutationOptions, type MutationHookOptions } from "@/lib/api/query-options";
import { createBillLocalFirst } from "@/features/billing/local-actions";
import { createBill } from "@/features/billing/api";
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
      if (Number(data.loyaltyPointsToRedeem || 0) > 0) {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          throw new ApiClientError("Loyalty redemption needs a connection so the points and bill can commit together", 0, "LOYALTY_REDEMPTION_OFFLINE");
        }
        return createBill(data);
      }
      return createBillLocalFirst(data);
    },
  });
}
