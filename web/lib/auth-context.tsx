"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

interface AuthState {
  userId: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((res) => setUserId(res.userId))
      .catch(() => setUserId(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await api.login(email, password);
    setUserId(res.user.id);
  }

  async function register(email: string, password: string) {
    const res = await api.register(email, password);
    setUserId(res.user.id);
  }

  async function logout() {
    await api.logout();
    setUserId(null);
  }

  return (
    <AuthContext.Provider value={{ userId, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Redirects to /login if the session is missing/expired — Section 1's
 *  "a signed-out visitor cannot reach protected pages." */
export function useRequireAuth(): AuthState {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.loading && !auth.userId) {
      router.replace("/login");
    }
  }, [auth.loading, auth.userId, router]);

  return auth;
}
