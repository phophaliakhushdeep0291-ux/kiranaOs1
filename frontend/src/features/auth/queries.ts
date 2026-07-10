import { useMutation } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api/http";
import { getMutationOptions, type MutationHookOptions } from "@/lib/api/query-options";
import * as authApi from "@/features/auth/api";
import type { AuthResponse } from "@/types/api";

export interface LoginVariables { data: authApi.LoginRequest }
export interface RegisterVariables<TData extends authApi.RegisterRequest = authApi.RegisterRequest> { data: TData }
export interface ForgotPasswordVariables { data: authApi.ForgotPasswordRequest }
export interface ResetPasswordVariables { data: authApi.ResetPasswordRequest }
export interface VerifyEmailVariables { data: authApi.VerifyEmailRequest }

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

export function useForgotPassword(options?: MutationHookOptions<{ success?: boolean; message?: string }, ForgotPasswordVariables>) {
  return useMutation<{ success?: boolean; message?: string }, ApiClientError, ForgotPasswordVariables>({
    ...getMutationOptions<{ success?: boolean; message?: string }, ForgotPasswordVariables>(options),
    mutationFn: ({ data }) => authApi.forgotPassword(data),
  });
}

export function useResetPassword(options?: MutationHookOptions<{ success?: boolean; message?: string }, ResetPasswordVariables>) {
  return useMutation<{ success?: boolean; message?: string }, ApiClientError, ResetPasswordVariables>({
    ...getMutationOptions<{ success?: boolean; message?: string }, ResetPasswordVariables>(options),
    mutationFn: ({ data }) => authApi.resetPassword(data),
  });
}

export function useVerifyEmail(options?: MutationHookOptions<{ success?: boolean; message?: string }, VerifyEmailVariables>) {
  return useMutation<{ success?: boolean; message?: string }, ApiClientError, VerifyEmailVariables>({
    ...getMutationOptions<{ success?: boolean; message?: string }, VerifyEmailVariables>(options),
    mutationFn: ({ data }) => authApi.verifyEmail(data),
  });
}
