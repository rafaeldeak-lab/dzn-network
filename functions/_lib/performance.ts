import { secureHeaders } from "./http";

export type PublicCacheTtl = {
  maxAge: number;
  staleWhileRevalidate: number;
};

export type CacheStatus = "HIT" | "MISS" | "STALE" | "BYPASS";

export type SafeRouteMetrics = {
  requestId: string;
  routeName: string;
  startedAt: number;
  cacheStatus?: CacheStatus;
  d1QueryDurationMs?: number;
  resultCount?: number;
  fallbackUsed?: boolean;
  staleAgeSeconds?: number | null;
  errorCategory?: string | null;
};

export function makeRequestId(prefix = "req") {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function privateNoStoreHeaders(headers?: HeadersInit) {
  const next = secureHeaders(headers);
  next.set("cache-control", "private, no-store, no-cache, must-revalidate");
  next.set("pragma", "no-cache");
  next.set("expires", "0");
  next.set("vary", "Cookie");
  next.set("x-dzn-cache", "BYPASS");
  return next;
}

export function publicCacheHeaders(ttl: PublicCacheTtl, status: CacheStatus = "MISS", headers?: HeadersInit) {
  const next = secureHeaders(headers);
  const maxAge = boundedSeconds(ttl.maxAge);
  next.set("cache-control", `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${boundedSeconds(ttl.staleWhileRevalidate)}`);
  next.set("x-dzn-cache", status);
  if (!next.has("server-timing")) next.set("server-timing", `dzn-cache;desc="${status}"`);
  return next;
}

export function noStoreForErrorHeaders(headers?: HeadersInit) {
  const next = secureHeaders(headers);
  next.set("cache-control", "no-store, no-cache, must-revalidate");
  next.set("pragma", "no-cache");
  next.set("expires", "0");
  next.set("x-dzn-cache", "BYPASS");
  return next;
}

export function hasPrivateRequestSignal(request: Request) {
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie") ?? "";
  if (authorization?.trim()) return true;
  return /(?:^|;\s*)(dzn_session|__Secure-|__Host-|session|cf_authorization)=/i.test(cookie);
}

export function canonicalPublicCacheKey(request: Request, allowedParams: readonly string[]) {
  const url = new URL(request.url);
  const canonical = new URL(url.origin + url.pathname);
  const allowed = new Set(allowedParams);
  [...url.searchParams.keys()].sort().forEach((key) => {
    if (!allowed.has(key)) return;
    for (const value of url.searchParams.getAll(key).sort()) {
      canonical.searchParams.append(key, value);
    }
  });
  return canonical.toString();
}

export async function withPublicGetEdgeCache(
  context: { request: Request; waitUntil?: (promise: Promise<unknown>) => void },
  options: {
    ttl: PublicCacheTtl;
    allowedParams: readonly string[];
    cacheVersion: string;
    buildResponse: () => Promise<Response>;
  },
) {
  const { request } = context;
  if (!["GET", "HEAD"].includes(request.method) || hasPrivateRequestSignal(request)) {
    const response = await options.buildResponse();
    return withCacheStatus(response, "BYPASS");
  }

  const cacheApi = getDefaultCache();
  if (!cacheApi) {
    const response = await options.buildResponse();
    return withCacheStatus(response, "MISS");
  }

  const keyUrl = new URL(canonicalPublicCacheKey(request, options.allowedParams));
  keyUrl.searchParams.set("__dzn_cache_v", options.cacheVersion);
  const key = new Request(keyUrl.toString(), {
    method: "GET",
  });
  const cached = await cacheApi.match(key).catch(() => undefined);
  if (cached) return withCacheStatus(cached, "HIT");

  const response = await options.buildResponse();
  const cacheable = response.ok && !response.headers.has("set-cookie");
  const finalResponse = withCacheStatus(response, cacheable ? "MISS" : "BYPASS");
  if (cacheable) {
    const cacheResponse = new Response(finalResponse.clone().body, finalResponse);
    const maxAge = boundedSeconds(options.ttl.maxAge);
    cacheResponse.headers.set("cache-control", `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${boundedSeconds(options.ttl.staleWhileRevalidate)}`);
    context.waitUntil?.(cacheApi.put(key, cacheResponse).catch(() => undefined));
  }
  return finalResponse;
}

export function withCacheStatus(response: Response, status: CacheStatus) {
  const headers = new Headers(response.headers);
  headers.set("x-dzn-cache", status);
  headers.set("server-timing", appendServerTiming(headers.get("server-timing"), `dzn-cache;desc="${status}"`));
  if (!response.ok) {
    headers.set("cache-control", "no-store, no-cache, must-revalidate");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, errorMessage = "operation_timeout") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(errorMessage), Math.max(100, Math.min(timeoutMs, 30_000)));
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function measureD1<T>(metrics: SafeRouteMetrics, operation: () => Promise<T>) {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    metrics.d1QueryDurationMs = Math.round(performance.now() - started);
  }
}

export function finalizeServerTiming(headers: Headers, metrics: SafeRouteMetrics) {
  const duration = Math.max(0, Math.round(performance.now() - metrics.startedAt));
  const entries = [`dzn-total;dur=${duration}`];
  if (metrics.d1QueryDurationMs !== undefined) entries.push(`dzn-d1;dur=${metrics.d1QueryDurationMs}`);
  if (metrics.resultCount !== undefined) entries.push(`dzn-results;desc="${metrics.resultCount}"`);
  headers.set("server-timing", appendServerTiming(headers.get("server-timing"), entries.join(", ")));
  headers.set("x-dzn-request-id", metrics.requestId);
  return headers;
}

export function safePerformanceWarning(metrics: SafeRouteMetrics, thresholdMs = 800) {
  const duration = performance.now() - metrics.startedAt;
  if (duration < thresholdMs) return;
  console.warn("DZN SLOW REQUEST", {
    request_id: metrics.requestId,
    route: metrics.routeName,
    duration_ms: Math.round(duration),
    cache_status: metrics.cacheStatus ?? null,
    d1_ms: metrics.d1QueryDurationMs ?? null,
    result_count: metrics.resultCount ?? null,
    fallback_used: metrics.fallbackUsed ?? false,
    stale_age_seconds: metrics.staleAgeSeconds ?? null,
    error_category: metrics.errorCategory ?? null,
  });
}

function boundedSeconds(value: number) {
  return Math.max(0, Math.min(3600, Math.trunc(value || 0)));
}

function appendServerTiming(current: string | null, next: string) {
  return current && current.trim() ? `${current}, ${next}` : next;
}

function getDefaultCache(): Cache | null {
  const cacheContainer = (globalThis as typeof globalThis & { caches?: { default?: Cache } }).caches;
  return cacheContainer?.default ?? null;
}
