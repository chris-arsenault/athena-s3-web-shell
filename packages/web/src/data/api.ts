import { API_BASE } from "@athena-shell/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface AuthHeader {
  name: string;
  value: string;
}

export interface ApiOptions {
  signal?: AbortSignal;
  authHeader?: AuthHeader | null;
  query?: Record<string, string | number | undefined>;
}

function buildUrl(path: string, query?: ApiOptions["query"]): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + url.search;
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  opts: ApiOptions
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.authHeader) headers[opts.authHeader.name] = opts.authHeader.value;

  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  });

  if (!res.ok) {
    let payload: unknown = undefined;
    try {
      payload = await res.json();
    } catch {
      // ignore
    }
    const msg =
      (payload as { error?: { message?: string } })?.error?.message ??
      `${method} ${path} failed: ${res.status}`;
    throw new ApiError(res.status, msg, payload);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  return request<T>("GET", path, undefined, opts);
}

export function apiPost<T>(path: string, body: unknown, opts: ApiOptions = {}): Promise<T> {
  return request<T>("POST", path, body, opts);
}

export function apiDelete<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  return request<T>("DELETE", path, undefined, opts);
}
