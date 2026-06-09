import type { QueryKey, UseMutationOptions, UseQueryOptions } from "@tanstack/react-query";
import type { ApiClientError } from "@/lib/api/http";

export type ClientQueryOptions<TData, TQueryKey extends QueryKey = QueryKey> = Omit<
  UseQueryOptions<TData, ApiClientError, TData, TQueryKey>,
  "queryKey" | "queryFn"
>;

export interface QueryHookOptions<TData, TQueryKey extends QueryKey = QueryKey> {
  query?: ClientQueryOptions<TData, TQueryKey>;
}

export type ClientMutationOptions<TData, TVariables, TContext = unknown> = Omit<
  UseMutationOptions<TData, ApiClientError, TVariables, TContext>,
  "mutationFn"
>;

export interface MutationHookOptions<TData, TVariables, TContext = unknown> {
  mutation?: ClientMutationOptions<TData, TVariables, TContext>;
}

export function getQueryOptions<TData, TQueryKey extends QueryKey = QueryKey>(
  options?: QueryHookOptions<TData, TQueryKey>,
): ClientQueryOptions<TData, TQueryKey> {
  return options?.query ?? {};
}

export function getMutationOptions<TData, TVariables, TContext = unknown>(
  options?: MutationHookOptions<TData, TVariables, TContext>,
): ClientMutationOptions<TData, TVariables, TContext> {
  return options?.mutation ?? {};
}
