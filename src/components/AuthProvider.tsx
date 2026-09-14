"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AuthSnapshot = {
  loggedIn: boolean;
  email: string;
};

type AuthContextValue = AuthSnapshot & {
  isReady: boolean;
  refresh: () => Promise<AuthSnapshot>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<AuthSnapshot> {
  const res = await fetch("/api/me", { cache: "no-store", credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!data?.loggedIn) {
    return { loggedIn: false, email: "" };
  }
  return { loggedIn: true, email: String(data.email ?? "") };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthSnapshot & { isReady: boolean }>({
    isReady: false,
    loggedIn: false,
    email: "",
  });

  const apply = useCallback((next: AuthSnapshot, isReady = true) => {
    setState({ isReady, ...next });
    return next;
  }, []);

  const refresh = useCallback(async () => {
    return apply(await fetchMe());
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const next = await fetchMe();
        if (!cancelled) {
          apply(next);
        }
      } catch {
        if (!cancelled) {
          apply({ loggedIn: false, email: "" });
        }
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    apply({ loggedIn: false, email: "" });
  }, [apply]);

  const value = useMemo(
    () => ({
      isReady: state.isReady,
      loggedIn: state.loggedIn,
      email: state.email,
      refresh,
      logout,
    }),
    [state.isReady, state.loggedIn, state.email, refresh, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
