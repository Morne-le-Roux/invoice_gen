"use client";

import pb from "@/lib/pocketbase";
import type { RecordModel } from "pocketbase";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type AuthContextValue = {
  user: RecordModel | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<RecordModel | null>(
    pb.authStore.record ?? null,
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Sync user state whenever the auth store changes
    const unsub = pb.authStore.onChange((_, record) => {
      setUser(record ?? null);
    });

    // Verify the stored token is still valid
    if (pb.authStore.isValid) {
      pb.collection("users")
        .authRefresh()
        .catch(() => pb.authStore.clear())
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }

    return unsub;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await pb.collection("users").authWithPassword(email, password);
  }, []);

  const logout = useCallback(() => {
    pb.authStore.clear();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
