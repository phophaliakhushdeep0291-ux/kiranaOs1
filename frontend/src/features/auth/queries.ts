import { useMutation } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api/http";
import { getMutationOptions, type MutationHookOptions } from "@/lib/api/query-options";
import * as authApi from "@/features/auth/api";
import type { AuthResponse } from "@/types/api";

export interface LoginVariables { data: authApi.LoginRequest }
export interface RegisterVariables<TData extends authApi.RegisterRequest = authApi.RegisterRequest> { data: TData }

export function useLogin(options?: MutationHookOptions<AuthResponse, LoginVariables>) {
  return useMutation<AuthResponse, ApiClientError, LoginVariables>({
    ...getMutationOptions<AuthResponse, LoginVariables>(options),
    mutationFn: ({ data }) => authApi.login(data),
  });
}

export function useRegister<TData extends authApi.RegisterRequest = authApi.RegisterRequest>(
  options?: MutationHookOptions<AuthResponse, RegisterVariables<TData>>,
) {
  return useMutation<AuthResponse, ApiClientError, RegisterVariables<TData>>({
    ...getMutationOptions<AuthResponse, RegisterVariables<TData>>(options),
    mutationFn: ({ data }) => authApi.register(data),
  });
}
