"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchAuthSession, logoutSession } from "@/lib/auth-client";
import type { AuthSession } from "@/lib/types";

interface AuthContextValue extends AuthSession {
  loading: boolean;
  refreshSession: () => Promise<AuthSession>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EMPTY_SESSION: AuthSession = {
  user: null,
  profiles: [],
  passwordResetConfigured: false,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession>(EMPTY_SESSION);
  const [loading, setLoading] = useState(true);

  const refreshSession = async () => {
    try {
      const nextSession = await fetchAuthSession();
      setSession(nextSession);
      return nextSession;
    } catch {
      setSession(EMPTY_SESSION);
      return EMPTY_SESSION;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await logoutSession();
    setSession(EMPTY_SESSION);
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...session,
      loading,
      refreshSession,
      logout,
    }),
    [loading, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
