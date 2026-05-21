"use client";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [300, 900];

export class FetchJsonError extends Error {
  status: number | null;
  url: string;
  aborted: boolean;
  body: unknown;

  constructor(message: string, options: { status?: number | null; url: string; aborted?: boolean; body?: unknown }) {
    super(message);
    this.name = "FetchJsonError";
    this.status = options.status ?? null;
    this.url = options.url;
    this.aborted = Boolean(options.aborted);
    this.body = options.body;
  }
}

export type FetchJsonWithRetryOptions = RequestInit & {
  retries?: number;
  retryDelayMs?: number | number[];
  timeoutMs?: number;
};

export async function fetchJsonWithRetry<T>(url: string, options: FetchJsonWithRetryOptions = {}): Promise<T> {
  const {
    retries = 2,
    retryDelayMs = DEFAULT_RETRY_DELAYS_MS,
    timeoutMs = 15_000,
    signal,
    ...requestInit
  } = options;

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const controller = new AbortController();
    const onAbort = () => controller.abort();

    if (signal?.aborted) {
      throw new FetchJsonError("Request aborted", { url, aborted: true });
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    try {
      const response = await fetch(url, {
        ...requestInit,
        signal: controller.signal,
      });
      const body = await parseJsonBody(response);
      if (!response.ok) {
        const message = responseErrorMessage(body) ?? `Request failed: ${response.status}`;
        throw new FetchJsonError(message, { status: response.status, url, body });
      }
      return body as T;
    } catch (error) {
      const callerAborted = Boolean(signal?.aborted);
      if (callerAborted) {
        throw new FetchJsonError("Request aborted", { url, aborted: true });
      }

      lastError = normalizeFetchError(error, url, timedOut);
      const retryable = isRetryableError(lastError);
      if (!retryable || attempt >= retries) throw lastError;

      console.warn("DZN FETCH RETRY", {
        url: safeLogUrl(url),
        attempt: attempt + 1,
        status: lastError instanceof FetchJsonError ? lastError.status : null,
        message: lastError instanceof Error ? lastError.message : "Unknown fetch failure",
      });
      await delay(retryDelayForAttempt(retryDelayMs, attempt));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    }

    attempt += 1;
  }

  throw lastError instanceof Error ? lastError : new FetchJsonError("Request failed", { url });
}

function isRetryableError(error: unknown) {
  if (error instanceof FetchJsonError) {
    if (error.aborted) return false;
    return error.status === null || RETRYABLE_STATUSES.has(error.status);
  }
  return true;
}

async function parseJsonBody(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function normalizeFetchError(error: unknown, url: string, timedOut: boolean) {
  if (error instanceof FetchJsonError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new FetchJsonError(timedOut ? "Request timed out" : "Request aborted", {
      url,
      aborted: !timedOut,
    });
  }
  if (error instanceof Error) {
    return new FetchJsonError(error.message, { url });
  }
  return new FetchJsonError("Network request failed", { url });
}

function responseErrorMessage(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const message = record.message ?? record.error ?? record.error_code;
  return typeof message === "string" && message.trim() ? message : null;
}

function retryDelayForAttempt(retryDelayMs: number | number[], attempt: number) {
  if (Array.isArray(retryDelayMs)) {
    return retryDelayMs[Math.min(attempt, retryDelayMs.length - 1)] ?? DEFAULT_RETRY_DELAYS_MS[0];
  }
  return retryDelayMs;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function safeLogUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname;
  } catch {
    return url.split("?")[0] ?? "unknown";
  }
}
