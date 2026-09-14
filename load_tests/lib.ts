export type SeededUser = {
  userId: string;
  email: string;
  password: string;
};

/** k6 `open()` is relative to the script file, not the process CWD. */
export function fromProjectRoot(relPath: string): string {
  if (relPath.startsWith("/")) {
    return relPath;
  }
  return `../${relPath}`;
}

export type CookieJar = Record<string, string>;

export function parseSetCookie(
  headers: Record<string, string[] | string | undefined>
): CookieJar {
  const jar: CookieJar = {};
  const raw = headers["Set-Cookie"] ?? headers["set-cookie"];
  if (!raw) {
    return jar;
  }
  const list = Array.isArray(raw) ? raw : [raw];
  for (const line of list) {
    const part = line.split(";")[0]?.trim();
    const eq = part?.indexOf("=");
    if (eq && eq > 0) {
      jar[part!.slice(0, eq)] = part!.slice(eq + 1);
    }
  }
  return jar;
}

export function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export function jsonHeaders(jar: CookieJar): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Cookie: cookieHeader(jar),
  };
}

export function cookieHeaders(jar: CookieJar): Record<string, string> {
  return { Cookie: cookieHeader(jar) };
}

export function emailFor(index: number): string {
  return `k6-user-${String(index + 1).padStart(4, "0")}@loadtest.local`;
}

export function isSeededUser(value: unknown): value is SeededUser {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as SeededUser;
  return Boolean(row.userId && row.email && row.password);
}

type JsonResponse = {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  json: (selector?: string) => unknown;
};

export function jsonBody<T>(res: JsonResponse): T | null {
  if (res.status < 200 || res.status >= 300) {
    return null;
  }
  const raw = res.body;
  if (raw == null || raw === "") {
    return null;
  }
  if (typeof raw === "string" && !raw.trim()) {
    return null;
  }
  try {
    return res.json() as T;
  } catch {
    return null;
  }
}

export function retryAfterSeconds(res: JsonResponse, fallback = 2): number {
  const header = res.headers?.["Retry-After"] ?? res.headers?.["retry-after"];
  const raw = Array.isArray(header) ? header[0] : header;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 15);
}
