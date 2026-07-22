const DEFAULT_SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), web-share=(), xr-spatial-tracking=()",
};

export function secureHeaders(headers?: HeadersInit) {
  const nextHeaders = new Headers(headers);
  for (const [name, value] of Object.entries(DEFAULT_SECURITY_HEADERS)) {
    if (!nextHeaders.has(name)) nextHeaders.set(name, value);
  }
  return nextHeaders;
}

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = secureHeaders(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    headers.set("pragma", "no-cache");
    headers.set("expires", "0");
  } else {
    headers.delete("pragma");
    headers.delete("expires");
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export function methodNotAllowed() {
  return json({ error: "Method not allowed" }, { status: 405 });
}

export function redirect(location: string, headers?: HeadersInit) {
  const nextHeaders = secureHeaders(headers);
  nextHeaders.set("location", location);
  nextHeaders.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  nextHeaders.set("pragma", "no-cache");
  nextHeaders.set("expires", "0");

  return new Response(null, {
    status: 302,
    headers: nextHeaders,
  });
}

export function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;

  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function setCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
    path?: string;
  } = {},
) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure !== false) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function clearCookie(name: string) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export type BoundedJsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 413; error: string; message: string };

export async function readBoundedJson<T>(request: Request, maxBytes: number): Promise<BoundedJsonResult<T>> {
  const boundedMax = Math.max(1, Math.min(Math.trunc(maxBytes), 64 * 1024));
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > boundedMax) {
    return { ok: false, status: 413, error: "REQUEST_TOO_LARGE", message: "Request body is too large." };
  }

  let text = "";
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "INVALID_BODY", message: "Request body could not be read." };
  }

  if (new TextEncoder().encode(text).byteLength > boundedMax) {
    return { ok: false, status: 413, error: "REQUEST_TOO_LARGE", message: "Request body is too large." };
  }
  if (!text.trim()) return { ok: true, value: {} as T };

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, status: 400, error: "INVALID_JSON", message: "Request body must be valid JSON." };
  }
}
