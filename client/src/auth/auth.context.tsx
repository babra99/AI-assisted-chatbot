import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiRequest, clearStoredToken, getStoredToken, setOnUnauthorized, setStoredToken } from "../api/api.client.ts";
import type { AuthState, LoginResponse, MeResponse, RegisterResponse } from "./auth.types.ts";

type AuthContextValue = {
  auth: AuthState;
  login: (email: string, password: string) => Promise<string | null>;
  register: (name: string, email: string, password: string) => Promise<string | null>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  const resetToUnauthenticated = useCallback(() => {
    setAuth({ status: "unauthenticated" });
  }, []);

  useEffect(() => {
    setOnUnauthorized(resetToUnauthenticated);
    return () => setOnUnauthorized(null);
  }, [resetToUnauthenticated]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuth({ status: "unauthenticated" });
      return;
    }

    let cancelled = false;

    async function validate() {
      const result = await apiRequest<MeResponse>("/api/auth/me");
      if (cancelled) return;
      if (result.ok) {
        setAuth({ status: "authenticated", user: result.data });
      } else {
        clearStoredToken();
        setAuth({ status: "unauthenticated" });
      }
    }

    void validate();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const result = await apiRequest<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (!result.ok) return result.error;

    setStoredToken(result.data.token);
    setAuth({ status: "authenticated", user: result.data.user });
    return null;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string): Promise<string | null> => {
    const result = await apiRequest<RegisterResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });

    if (!result.ok) return result.error;

    setStoredToken(result.data.token);
    setAuth({ status: "authenticated", user: result.data.user });
    return null;
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    setAuth({ status: "unauthenticated" });
  }, []);

  return (
    <AuthContext value={{ auth, login, register, logout }}>
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
