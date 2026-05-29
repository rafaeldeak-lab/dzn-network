export type NitradoFileReadMethod =
  | "admin_logs"
  | "seek"
  | "seek_probe"
  | "seek_chunk"
  | "seek_no_raw"
  | "download"
  | "tokenized_download"
  | "tokenized_sample";
export type NitradoFileReadEndpointKind = "nitrado_admin_logs" | "nitrado_seek" | "nitrado_download" | "tokenized_url";
export type NitradoFileReadStatus =
  | "success"
  | "non_ok_response"
  | "redirect_response"
  | "fetch_threw"
  | "timeout"
  | "empty_body"
  | "unreadable";

export type NitradoLiveSourceName =
  | "admin_logs"
  | "gameserver_details_log_files_noftp_download"
  | "gameserver_details_log_files_noftp_seek_raw"
  | "gameserver_details_log_files_noftp_seek_no_raw"
  | "file_server_relative_download"
  | "file_server_relative_seek_raw"
  | "file_server_relative_seek_no_raw"
  | "file_server_leading_slash_download"
  | "file_server_leading_slash_seek_raw"
  | "file_server_leading_slash_seek_no_raw"
  | "tokenized_download";

export type NitradoFileReadAttemptPayload = {
  serverId?: string | null;
  serviceId: string;
  fileName?: string | null;
  filePath?: string | null;
  method: NitradoFileReadMethod;
  endpointKind: NitradoFileReadEndpointKind;
  attemptNumber?: number;
  status: NitradoFileReadStatus;
  httpStatus?: number | null;
  httpStatusText?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  responseExcerpt?: string | null;
  responseHeadersJson?: string | null;
  durationMs?: number | null;
  requestUrlRedacted?: string | null;
};

export type NitradoFileReadDiagnosticsContext = {
  db?: D1Database | null;
  serverId?: string | null;
  serviceId: string;
  fileName?: string | null;
  filePath?: string | null;
  budget?: {
    maxRows?: number;
    rowsRecorded?: number;
  };
};

export type NitradoSourceBackoff = {
  active: boolean;
  sourceName: NitradoLiveSourceName;
  retryAt: string | null;
  errorCode: string | null;
  message: string | null;
};

const SECRET_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "auth",
  "authorization",
  "signature",
  "sig",
  "expires",
  "key",
  "secret",
]);

const SAFE_QUERY_KEYS = new Set(["file", "offset", "length", "mode", "count"]);
const SAFE_HEADER_KEYS = new Set([
  "content-type",
  "content-length",
  "date",
  "server",
  "cf-ray",
  "retry-after",
  "x-request-id",
  "x-correlation-id",
]);

export function sanitizeNitradoUrl(value: string | URL | null | undefined) {
  if (!value) return null;
  const raw = String(value);
  try {
    const url = new URL(raw);
    const sanitizedPath = url.pathname
      .split("/")
      .map((segment) => {
        if (!segment) return segment;
        const decoded = safeDecodeURIComponent(segment);
        return looksTokenLike(decoded) ? "REDACTED" : sanitizeTokenLikeText(segment);
      })
      .join("/");
    const sanitized = new URL(`${url.protocol}//${url.host}${sanitizedPath}`);
    const strictTokenizedUrl = !/api\.nitrado\.net$/i.test(url.hostname);
    for (const [key, queryValue] of url.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (SAFE_QUERY_KEYS.has(lower)) {
        sanitized.searchParams.append(key, sanitizeTokenLikeText(queryValue).slice(0, 300));
      } else if (strictTokenizedUrl || SECRET_QUERY_KEYS.has(lower) || looksTokenLike(queryValue)) {
        sanitized.searchParams.append(key, "REDACTED");
      } else {
        sanitized.searchParams.append(key, sanitizeTokenLikeText(queryValue).slice(0, 120));
      }
    }
    return sanitized.toString();
  } catch {
    return sanitizeTokenLikeText(raw).replace(/\?.*$/, "?REDACTED").slice(0, 1000);
  }
}

export function sanitizeHeaders(headers: Headers | HeadersInit | null | undefined) {
  if (!headers) return null;
  const safe: Record<string, string> = {};
  const entries = headers instanceof Headers
    ? [...headers.entries()]
    : Array.isArray(headers)
      ? headers
      : Object.entries(headers);

  for (const [name, rawValue] of entries) {
    const key = String(name).toLowerCase();
    if (!SAFE_HEADER_KEYS.has(key)) continue;
    safe[key] = sanitizeTokenLikeText(String(rawValue)).slice(0, 300);
  }

  return JSON.stringify(safe);
}

export function sanitizeResponseExcerpt(text: string | null | undefined, maxLength = 1000) {
  if (!text) return null;
  return sanitizeTokenLikeText(text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(1, Math.min(1000, maxLength)));
}

export function classifyFetchError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const rawMessage = error instanceof Error ? error.message : String(error ?? "fetch failed");
  const message = sanitizeResponseExcerpt(rawMessage, 500) ?? "fetch failed";
  const lower = `${name} ${message}`.toLowerCase();
  if (lower.includes("too many subrequests")) {
    return { status: "fetch_threw" as const, errorCode: "WORKER_SUBREQUEST_LIMIT", errorMessage: message };
  }
  if (name === "AbortError" || lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted")) {
    return { status: "timeout" as const, errorCode: "FETCH_TIMEOUT", errorMessage: message };
  }
  return { status: "fetch_threw" as const, errorCode: "FETCH_THREW", errorMessage: message };
}

export function errorCodeForHttpStatus(status: number | null | undefined, fallback = "NITRADO_NON_OK_RESPONSE") {
  if (status === 401) return "NITRADO_UNAUTHORIZED";
  if (status === 403) return "NITRADO_FORBIDDEN";
  if (status === 404) return "NITRADO_FILE_NOT_FOUND";
  if (status === 429) return "NITRADO_RATE_LIMITED";
  if (status && status >= 500 && status <= 504) return "NITRADO_UPSTREAM_DOWN";
  return fallback;
}

export async function recordNitradoFileReadAttempt(db: D1Database | null | undefined, payload: NitradoFileReadAttemptPayload) {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO nitrado_file_read_attempts (
          id, server_id, service_id, file_name, file_path, method, endpoint_kind,
          attempt_number, status, http_status, http_status_text, error_code,
          error_message, response_excerpt, response_headers_json, duration_ms,
          request_url_redacted, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        crypto.randomUUID(),
        payload.serverId ?? null,
        payload.serviceId,
        payload.fileName ?? filenameFromPath(payload.filePath ?? null),
        payload.filePath ?? null,
        payload.method,
        payload.endpointKind,
        Math.max(1, Math.trunc(Number(payload.attemptNumber ?? 1) || 1)),
        payload.status,
        payload.httpStatus ?? null,
        payload.httpStatusText ? sanitizeResponseExcerpt(payload.httpStatusText, 120) : null,
        payload.errorCode ?? null,
        sanitizeResponseExcerpt(payload.errorMessage, 500),
        sanitizeResponseExcerpt(payload.responseExcerpt, 1000),
        payload.responseHeadersJson ?? null,
        payload.durationMs ?? null,
        sanitizeNitradoUrl(payload.requestUrlRedacted) ?? null,
      )
      .run();
    await recordNitradoLiveSourceState(db, payload);
  } catch (error) {
    console.warn("DZN NITRADO FILE READ DIAGNOSTIC RECORD SKIPPED", {
      serviceId: payload.serviceId,
      fileName: payload.fileName ?? filenameFromPath(payload.filePath ?? null),
      message: error instanceof Error ? error.message : "record failed",
    });
  }
}

export async function getNitradoReadSourceBackoff(
  db: D1Database | null | undefined,
  serviceId: string,
  sourceName: NitradoLiveSourceName,
  nowIso = new Date().toISOString(),
): Promise<NitradoSourceBackoff> {
  if (!db) return { active: false, sourceName, retryAt: null, errorCode: null, message: null };
  const nowMs = Date.parse(nowIso);
  try {
    const rateLimit = await db
      .prepare(
        `SELECT rate_limited_until
         FROM nitrado_rate_limits
         WHERE service_id = ?
         LIMIT 1`,
      )
      .bind(serviceId)
      .first<{ rate_limited_until: string | null }>();
    if (isFutureIso(rateLimit?.rate_limited_until, nowMs)) {
      return {
        active: true,
        sourceName,
        retryAt: rateLimit?.rate_limited_until ?? null,
        errorCode: "NITRADO_RATE_LIMITED",
        message: `Nitrado rate limited ADM reads. DZN will retry after ${rateLimit?.rate_limited_until}.`,
      };
    }

    const source = await db
      .prepare(
        `SELECT next_test_at, last_error_code
         FROM adm_live_source_state
         WHERE service_id = ? AND source_name = ?
         LIMIT 1`,
      )
      .bind(serviceId, sourceName)
      .first<{ next_test_at: string | null; last_error_code: string | null }>();
    if (isFutureIso(source?.next_test_at, nowMs)) {
      return {
        active: true,
        sourceName,
        retryAt: source?.next_test_at ?? null,
        errorCode: source?.last_error_code ?? "NITRADO_SOURCE_BACKOFF_ACTIVE",
        message: `${sourceName} is in ADM read backoff until ${source?.next_test_at}.`,
      };
    }
  } catch {
    return { active: false, sourceName, retryAt: null, errorCode: null, message: null };
  }
  return { active: false, sourceName, retryAt: null, errorCode: null, message: null };
}

export async function getActiveNitradoRateLimit(
  db: D1Database | null | undefined,
  serviceId: string,
  nowIso = new Date().toISOString(),
) {
  if (!db) return null;
  try {
    const row = await db
      .prepare(
        `SELECT service_id, rate_limited_until, last_rate_limit_at, rate_limit_count,
                last_rate_limit_method, last_rate_limit_endpoint
         FROM nitrado_rate_limits
         WHERE service_id = ?
         LIMIT 1`,
      )
      .bind(serviceId)
      .first<{
        service_id: string;
        rate_limited_until: string | null;
        last_rate_limit_at: string | null;
        rate_limit_count: number | null;
        last_rate_limit_method: string | null;
        last_rate_limit_endpoint: string | null;
      }>();
    if (!row || !isFutureIso(row.rate_limited_until, Date.parse(nowIso))) return null;
    return row;
  } catch {
    return null;
  }
}

export function nitradoLiveSourceNameForRead(values: {
  method: NitradoFileReadMethod;
  endpointKind: NitradoFileReadEndpointKind;
  filePath?: string | null;
}): NitradoLiveSourceName {
  if (values.endpointKind === "nitrado_admin_logs" || values.method === "admin_logs") return "admin_logs";
  if (values.endpointKind === "tokenized_url" || values.method.startsWith("tokenized")) return "tokenized_download";
  const path = String(values.filePath ?? "").trim();
  const leadingSlash = path.startsWith("/");
  const noFtpPath = /(?:^|\/)(?:games|noftp)\//i.test(path);
  if (values.method === "download") {
    if (noFtpPath) return "gameserver_details_log_files_noftp_download";
    return leadingSlash ? "file_server_leading_slash_download" : "file_server_relative_download";
  }
  const noRaw = values.method === "seek_no_raw";
  if (noFtpPath) return noRaw ? "gameserver_details_log_files_noftp_seek_no_raw" : "gameserver_details_log_files_noftp_seek_raw";
  if (leadingSlash) return noRaw ? "file_server_leading_slash_seek_no_raw" : "file_server_leading_slash_seek_raw";
  return noRaw ? "file_server_relative_seek_no_raw" : "file_server_relative_seek_raw";
}

export function humanNitradoReadError(values: {
  method?: string | null;
  endpointKind?: string | null;
  status?: string | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const method = values.method === "seek"
    ? "Nitrado seek"
    : values.method === "admin_logs"
      ? "Nitrado admin logs"
    : values.method === "seek_probe"
      ? "Nitrado seek probe"
      : values.method === "seek_chunk"
        ? "Nitrado seek chunk"
    : values.method === "download"
      ? "Nitrado download"
      : values.method?.startsWith("tokenized")
        ? "Tokenized download"
        : "Nitrado file read";
  if (values.httpStatus) return `${method} returned HTTP ${values.httpStatus}`;
  if (values.errorCode === "WORKER_SUBREQUEST_LIMIT") return `${method} failed: Cloudflare Worker subrequest limit reached`;
  if (values.errorCode === "NITRADO_DOWNLOAD_REDIRECT") return `${method} returned a tokenized redirect`;
  if (values.status === "timeout" || values.errorCode === "FETCH_TIMEOUT") return `${method} fetch threw: timeout`;
  if (values.status === "empty_body" || values.errorCode === "TOKENIZED_EMPTY_BODY") return `${method} returned empty body`;
  if (values.errorMessage) return `${method} failed: ${values.errorMessage}`;
  return `${method} failed`;
}

function sanitizeTokenLikeText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer REDACTED")
    .replace(/(token|access_token|authorization|signature|sig|secret|key)=([^&\s]+)/gi, "$1=REDACTED")
    .replace(/[A-Za-z0-9._~+/=-]{80,}/g, "REDACTED");
}

function looksTokenLike(value: string) {
  return /[A-Za-z0-9._~+/=-]{80,}/.test(value);
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function filenameFromPath(value: string | null) {
  return value ? value.split("/").filter(Boolean).at(-1) ?? null : null;
}

async function recordNitradoLiveSourceState(db: D1Database, payload: NitradoFileReadAttemptPayload) {
  const sourceName = nitradoLiveSourceNameForRead({
    method: payload.method,
    endpointKind: payload.endpointKind,
    filePath: payload.filePath,
  });
  const now = new Date();
  const nowIso = now.toISOString();
  const works = payload.status === "success" && (!payload.httpStatus || (payload.httpStatus >= 200 && payload.httpStatus < 300));
  let rateLimitedUntil: string | null = null;

  if (payload.httpStatus === 429 || payload.errorCode === "NITRADO_RATE_LIMITED") {
    const previous = await db
      .prepare("SELECT rate_limit_count FROM nitrado_rate_limits WHERE service_id = ? LIMIT 1")
      .bind(payload.serviceId)
      .first<{ rate_limit_count: number | null }>()
      .catch(() => null);
    const count = Math.max(0, Number(previous?.rate_limit_count ?? 0)) + 1;
    rateLimitedUntil = addMinutes(now, rateLimitBackoffMinutes(count));
    await db
      .prepare(
        `INSERT INTO nitrado_rate_limits (
           service_id, rate_limited_until, last_rate_limit_at, rate_limit_count,
           last_rate_limit_method, last_rate_limit_endpoint, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(service_id) DO UPDATE SET
           rate_limited_until = excluded.rate_limited_until,
           last_rate_limit_at = excluded.last_rate_limit_at,
           rate_limit_count = excluded.rate_limit_count,
           last_rate_limit_method = excluded.last_rate_limit_method,
           last_rate_limit_endpoint = excluded.last_rate_limit_endpoint,
           updated_at = excluded.updated_at`,
      )
      .bind(payload.serviceId, rateLimitedUntil, nowIso, count, payload.method, payload.endpointKind, nowIso)
      .run()
      .catch(() => null);
  } else if (works) {
    await db
      .prepare(
        `INSERT INTO nitrado_rate_limits (service_id, rate_limited_until, updated_at)
         VALUES (?, NULL, ?)
         ON CONFLICT(service_id) DO UPDATE SET
           rate_limited_until = NULL,
           updated_at = excluded.updated_at`,
      )
      .bind(payload.serviceId, nowIso)
      .run()
      .catch(() => null);
  }

  const nextTestAt = works ? nowIso : rateLimitedUntil ?? addMinutes(now, sourceBackoffMinutes(payload));
  await db
    .prepare(
      `INSERT INTO adm_live_source_state (
         id, service_id, source_name, last_tested_at, last_status, last_http_status,
         last_error_code, last_response_excerpt, works, preferred, next_test_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(service_id, source_name) DO UPDATE SET
         last_tested_at = excluded.last_tested_at,
         last_status = excluded.last_status,
         last_http_status = excluded.last_http_status,
         last_error_code = excluded.last_error_code,
         last_response_excerpt = excluded.last_response_excerpt,
         works = excluded.works,
         preferred = CASE WHEN excluded.works = 1 THEN 1 ELSE adm_live_source_state.preferred END,
         next_test_at = excluded.next_test_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      payload.serviceId,
      sourceName,
      nowIso,
      payload.status,
      payload.httpStatus ?? null,
      payload.errorCode ?? null,
      sanitizeResponseExcerpt(payload.responseExcerpt, 500),
      works ? 1 : 0,
      works ? 1 : 0,
      nextTestAt,
      nowIso,
    )
    .run()
    .catch(() => null);
}

function sourceBackoffMinutes(payload: NitradoFileReadAttemptPayload) {
  if (payload.endpointKind === "nitrado_admin_logs" && payload.errorCode === "NITRADO_ADMIN_LOGS_NO_ADM_TEXT") return 5;
  if (payload.httpStatus === 404 || payload.errorCode === "NITRADO_FILE_NOT_FOUND") return 60;
  if (payload.httpStatus && payload.httpStatus >= 500 && payload.httpStatus <= 504) return 30;
  if (payload.status === "timeout" || payload.errorCode === "FETCH_TIMEOUT") return 15;
  if (payload.status === "fetch_threw" || payload.errorCode === "FETCH_THREW") return 15;
  if (payload.status === "empty_body") return 10;
  return 15;
}

function rateLimitBackoffMinutes(count: number) {
  if (count <= 1) return 15;
  if (count === 2) return 30;
  if (count === 3) return 60;
  return Math.min(360, 60 * Math.max(1, count - 2));
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + Math.max(1, Math.trunc(minutes)) * 60_000).toISOString();
}

function isFutureIso(value: string | null | undefined, nowMs: number) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Number.isFinite(nowMs) && timestamp > nowMs;
}
