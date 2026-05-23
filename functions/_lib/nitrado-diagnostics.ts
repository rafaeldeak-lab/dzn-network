export type NitradoFileReadMethod = "seek" | "download" | "tokenized_download" | "tokenized_sample";
export type NitradoFileReadEndpointKind = "nitrado_seek" | "nitrado_download" | "tokenized_url";
export type NitradoFileReadStatus =
  | "success"
  | "non_ok_response"
  | "fetch_threw"
  | "timeout"
  | "empty_body"
  | "unreadable";

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
  } catch (error) {
    console.warn("DZN NITRADO FILE READ DIAGNOSTIC RECORD SKIPPED", {
      serviceId: payload.serviceId,
      fileName: payload.fileName ?? filenameFromPath(payload.filePath ?? null),
      message: error instanceof Error ? error.message : "record failed",
    });
  }
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
    : values.method === "download"
      ? "Nitrado download"
      : values.method?.startsWith("tokenized")
        ? "Tokenized download"
        : "Nitrado file read";
  if (values.httpStatus) return `${method} returned HTTP ${values.httpStatus}`;
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
