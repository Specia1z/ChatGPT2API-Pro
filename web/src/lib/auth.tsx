"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { BASE } from "@/lib/api";

interface User {
  id: number;
  email: string;
  name: string;
  points: number;
  plan_name?: string;
  plan_id?: number;
  subscription_expires_at?: string;
  token_capacity?: number;
  token_refill_per_hour?: number;
  plan_concurrency?: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null, token: null, loading: true,
  login: () => {}, logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = localStorage.getItem("auth-token");
    const u = localStorage.getItem("user-data");
    if (t && u) {
      setToken(t);
      setUser(JSON.parse(u));
      // 验证 token 是否仍有效
      fetch(`${BASE}/api/user/profile`, {
        headers: { Authorization: `Bearer ${t}` },
      })
        .then(async (r) => {
          if (r.status === 401) {
            localStorage.removeItem("auth-token");
            localStorage.removeItem("user-data");
            setToken(null);
            setUser(null);
            window.location.replace("/login");
            return;
          }
          const d = await r.json();
          const fresh = d.data || d;
          if (fresh && fresh.id) {
            setUser(fresh);
            localStorage.setItem("user-data", JSON.stringify(fresh));
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = (u: User, t: string) => {
    setUser(u); setToken(t);
    localStorage.setItem("auth-token", t);
    localStorage.setItem("user-data", JSON.stringify(u));
  };

  const logout = () => {
    setUser(null); setToken(null);
    localStorage.removeItem("auth-token");
    localStorage.removeItem("user-data");
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
