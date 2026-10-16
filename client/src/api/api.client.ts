export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

const TOKEN_KEY = "auth_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = `${API_BASE_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    return { ok: false, status: 0, error: "Network error — is the server running?" };
  }

  if (response.status === 401 && token && onUnauthorized) {
    clearStoredToken();
    onUnauthorized();
    return { ok: false, status: 401, error: "Session expired" };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      return { ok: false, status: response.status, error: `Server error (${response.status})` };
    }
    return { ok: false, status: response.status, error: "Invalid JSON response" };
  }

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof (data as { error: string }).error === "string"
        ? (data as { error: string }).error
        : `Server error (${response.status})`;
    return { ok: false, status: response.status, error: message };
  }

  return { ok: true, data: data as T };
}
