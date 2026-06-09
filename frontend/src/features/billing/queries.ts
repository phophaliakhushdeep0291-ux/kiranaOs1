import { useMutation } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api/http";
import { getMutationOptions, type MutationHookOptions } from "@/lib/api/query-options";
import { createBillLocalFirst } from "@/features/billing/local-actions";
import type { Bill, BillInput } from "@/types/api";

export interface ConfirmBillVariables { data: BillInput }

export function useConfirmBill(options?: MutationHookOptions<Bill, ConfirmBillVariables>) {
  return useMutation<Bill, ApiClientError, ConfirmBillVariables>({
    ...getMutationOptions<Bill, ConfirmBillVariables>(options),
    mutationFn: ({ data }) => createBillLocalFirst(data),
  });
}
