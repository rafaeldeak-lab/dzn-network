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
  next.set("cache-control", `public, max-age=${maxAge}, stale-while-revalidate=${boundedSeconds(ttl.staleWhileRevalidate)}`);
  next.set("cdn-cache-control", `max-age=${maxAge}`);
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
  let acceptedValues = 0;
  let invalidAllowedValue = false;
  [...url.searchParams.keys()].sort().forEach((key) => {
    if (!allowed.has(key)) return;
    for (const value of url.searchParams.getAll(key).sort()) {
      if (value.length > 180 || acceptedValues >= 12) {
        invalidAllowedValue = true;
        continue;
      }
      canonical.searchParams.append(key, value);
      acceptedValues += 1;
    }
  });
  const key = canonical.toString();
  return !invalidAllowedValue && key.length <= 2048 ? key : null;
}

const CACHE_META_HEADER = "x-dzn-cache-meta";
const inflightRefreshes = new Set<string>();

type CacheMetadata = {
  version: string;
  cachedAt: number;
  freshUntil: number;
  staleUntil: number;
};

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
    return withBypassNoStore(response);
  }

  const cacheApi = getDefaultCache();
  if (!cacheApi) {
    const response = await options.buildResponse();
    return withCacheStatus(response, "MISS");
  }

  const canonicalKey = canonicalPublicCacheKey(request, options.allowedParams);
  if (!canonicalKey) {
    const response = await options.buildResponse();
    return withBypassNoStore(response);
  }

  const keyUrl = new URL(canonicalKey);
  keyUrl.searchParams.set("__dzn_cache_v", options.cacheVersion);
  const key = new Request(keyUrl.toString(), {
    method: "GET",
  });
  const cacheKey = key.url;
  const now = Date.now();
  const cached = await cacheApi.match(key).catch(() => undefined);
  if (cached) {
    const metadata = parseCacheMetadata(cached.headers.get(CACHE_META_HEADER), options.cacheVersion);
    if (metadata && now <= metadata.freshUntil) return responseFromCached(cached, request.method, "HIT", 0);
    if (metadata && now <= metadata.staleUntil) {
      const refresh = refreshPublicCache(cacheApi, key, cacheKey, options);
      context.waitUntil?.(refresh);
      return responseFromCached(cached, request.method, "STALE", Math.max(0, Math.round((now - metadata.freshUntil) / 1000)));
    }
    context.waitUntil?.(cacheApi.delete(key).catch(() => undefined));
  }

  if (request.method === "HEAD") {
    const response = await options.buildResponse();
    return withBypassNoStore(new Response(null, response));
  }

  const response = await options.buildResponse();
  const cacheable = isCacheablePublicResponse(response);
  const finalResponse = withCacheStatus(response, cacheable ? "MISS" : "BYPASS");
  if (cacheable) {
    const cacheResponse = makeCacheApiResponse(finalResponse, options.ttl, options.cacheVersion);
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

function withBypassNoStore(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("x-dzn-cache", "BYPASS");
  headers.set("cache-control", "no-store, no-cache, must-revalidate");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  headers.set("server-timing", appendServerTiming(headers.get("server-timing"), "dzn-cache;desc=\"BYPASS\""));
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

function parseCacheMetadata(value: string | null, version: string): CacheMetadata | null {
  if (!value || value.length > 400) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CacheMetadata>;
    if (parsed.version !== version) return null;
    if (!Number.isFinite(parsed.cachedAt) || !Number.isFinite(parsed.freshUntil) || !Number.isFinite(parsed.staleUntil)) return null;
    return parsed as CacheMetadata;
  } catch {
    return null;
  }
}

function makeCacheMetadata(ttl: PublicCacheTtl, version: string): CacheMetadata {
  const cachedAt = Date.now();
  const freshUntil = cachedAt + boundedSeconds(ttl.maxAge) * 1000;
  const staleUntil = freshUntil + boundedSeconds(ttl.staleWhileRevalidate) * 1000;
  return { version, cachedAt, freshUntil, staleUntil };
}

function makeCacheApiResponse(response: Response, ttl: PublicCacheTtl, version: string) {
  const metadata = makeCacheMetadata(ttl, version);
  const headers = new Headers(response.headers);
  headers.set(CACHE_META_HEADER, JSON.stringify(metadata));
  headers.set("cache-control", `public, max-age=${Math.ceil((metadata.staleUntil - Date.now()) / 1000)}`);
  return new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function responseFromCached(response: Response, method: string, status: CacheStatus, staleAgeSeconds: number) {
  const headers = new Headers(response.headers);
  headers.delete(CACHE_META_HEADER);
  headers.set("x-dzn-cache", status);
  headers.set("server-timing", appendServerTiming(headers.get("server-timing"), `dzn-cache;desc="${status}"${staleAgeSeconds ? `;dur=${staleAgeSeconds}` : ""}`));
  return new Response(method === "HEAD" ? null : response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isCacheablePublicResponse(response: Response) {
  return response.ok && response.status >= 200 && response.status < 300 && !response.headers.has("set-cookie");
}

async function refreshPublicCache(
  cacheApi: Cache,
  key: Request,
  cacheKey: string,
  options: {
    ttl: PublicCacheTtl;
    allowedParams: readonly string[];
    cacheVersion: string;
    buildResponse: () => Promise<Response>;
  },
) {
  if (inflightRefreshes.has(cacheKey)) return;
  inflightRefreshes.add(cacheKey);
  try {
    const response = await options.buildResponse();
    if (!isCacheablePublicResponse(response)) return;
    await cacheApi.put(key, makeCacheApiResponse(withCacheStatus(response, "MISS"), options.ttl, options.cacheVersion));
  } catch {
    // Keep serving the stale object until its stale window expires.
  } finally {
    inflightRefreshes.delete(cacheKey);
  }
}
