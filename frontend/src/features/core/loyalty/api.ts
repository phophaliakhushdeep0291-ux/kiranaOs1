import { apiRequest } from "@/lib/api/http";

export interface LoyaltyProgramSummary {
  active: boolean;
  redemptionPaisePerPoint: number;
  minimumRedeemPoints: number;
}

export interface LoyaltyAccountSummary {
  account: {
    pointsBalance: number;
    tier?: string;
    expiresAt?: string | null;
  };
}

export function getLoyaltyProgram() {
  return apiRequest<LoyaltyProgramSummary>("/loyalty/program");
}

export function getLoyaltyAccount(customerId: string) {
  return apiRequest<LoyaltyAccountSummary>(`/loyalty/accounts/${encodeURIComponent(customerId)}`);
}
