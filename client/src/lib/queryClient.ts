import { QueryClient, type QueryFunction } from "@tanstack/react-query";

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = res.statusText;
  try {
    const body = await res.clone().json();
    if (body?.message) message = body.message;
  } catch {
    const text = await res.text().catch(() => "");
    if (text) message = text;
  }
  throw new Error(`${res.status}: ${message}`);
}

/** Fire a mutating request. Returns the parsed JSON body. */
export async function apiRequest<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  await throwIfNotOk(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type UnauthorizedBehavior = "returnNull" | "throw";

/** Default query function: the queryKey's first element is the request URL. */
export function getQueryFn<T>(options: { on401: UnauthorizedBehavior }): QueryFunction<T> {
  return async ({ queryKey }) => {
    const url = queryKey[0] as string;
    const res = await fetch(url, { credentials: "include" });
    if (options.on401 === "returnNull" && res.status === 401) {
      return null as T;
    }
    await throwIfNotOk(res);
    return (await res.json()) as T;
  };
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: false,
    },
    mutations: { retry: false },
  },
});
