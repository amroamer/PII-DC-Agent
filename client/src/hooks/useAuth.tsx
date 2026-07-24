import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface MeResponse {
  user: AuthUser | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<MeResponse | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn<MeResponse | null>({ on401: "returnNull" }),
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: (vars: { username: string; password: string }) =>
      apiRequest<{ user: AuthUser }>("POST", "/api/auth/login", vars),
    onSuccess: (res) => {
      queryClient.setQueryData(["/api/auth/me"], { user: res.user });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/logout"),
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], { user: null });
      queryClient.clear();
    },
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user: data?.user ?? null,
      isLoading,
      login: async (username, password) => {
        await loginMutation.mutateAsync({ username, password });
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
    }),
    [data, isLoading, loginMutation, logoutMutation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
