import { createContext } from "react";
import type { Shop, User } from "@/lib/api/client";

export interface AuthContextType {
  user: User | null;
  shop: Shop | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (token: string | undefined | null, refresh: string | undefined | null, user: User, shop?: Shop | null) => void;
  updateShop: (shop: Shop | null) => void;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
