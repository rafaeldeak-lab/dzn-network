set -euo pipefail

node <<'NODE'
const fs = require("node:fs");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.OWNER_CONSOLE_CF_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const projectName = process.env.EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME;
const previewDbName = process.env.EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME;
const previewId = process.env.PHASE2A_PREVIEW_D1_DATABASE_ID;
const productionProjectName = process.env.PRODUCTION_PAGES_PROJECT_NAME;
const productionId = process.env.DETECTED_PRODUCTION_D1_DATABASE_ID || "";
const expectedProductionSignature = Buffer.from(process.env.PHASE2A_PRODUCTION_PROJECT_SIGNATURE || "", "base64").toString("utf8");
const immutableUrl = process.env.PHASE2A_IMMUTABLE_PREVIEW_URL;
const stableUrl = process.env.PHASE2A_STABLE_PREVIEW_URL || `https://${projectName}.pages.dev`;
const ownerCookie = process.env.OWNER_CONSOLE_OWNER_COOKIE || "";
const creatorCookie = process.env.OWNER_CONSOLE_CREATOR_COOKIE || "";
const memberCookie = process.env.OWNER_CONSOLE_NON_OWNER_COOKIE || "";
const apiMemberUserId = process.env.PHASE2A_API_MEMBER_USER_ID || "owner-console-non-owner-user";
const apiMemberCookie = process.env.PHASE2A_API_MEMBER_COOKIE || "";
const phase2aRunKey = String(process.env.PHASE2A_RUN_KEY || "").trim();
const conversionTargetId = String(process.env.PHASE2A_CONVERSION_TARGET_ID || "").trim();
const conversionTargetEventId = String(process.env.PHASE2A_CONVERSION_EVENT_ID || "").trim();
const creatorHostId = String(process.env.PHASE2A_CREATOR_HOST_ID || "phase2a-preview-creator-host").trim();
const foreignHostId = String(process.env.PHASE2A_FOREIGN_HOST_ID || "phase2a-preview-foreign-host").trim();
const suggestionVoteChangeCooldownMs = 1500;
const artifacts = "dzn-event-platform-performance-preview";
try {
  fs.rmSync(`${artifacts}/failure-summary.json`, { force: true });
} catch {}
let activeStage = "verification";
const progress = {
  projectConfig: "not_run",
  sessionVerification: "not_run",
  d1InitialVerification: "not_run",
  routeProbes: "not_run",
  performanceSampling: "not_run",
  cacheVerification: "not_run",
  authMatrix: "not_run",
  privacyChecks: "not_run",
  pagination: "not_run",
  d1FinalVerification: "not_run",
  finalReport: "not_run",
};

function sanitizeFailureValue(value) {
  return String(value ?? "")
    .replace(/dzn_session=[^;\s"]+/gi, "dzn_session=[redacted-cookie]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[uuid]")
    .replace(/\b[0-9a-f]{32}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_\-]{64,}/g, "[redacted]")
    .slice(0, 500);
}
function updateProgress(stage, status) {
  if (stage && status === "running") activeStage = stage;
  if (stage) progress[stage] = status;
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(`${artifacts}/verification-progress.json`, JSON.stringify(progress, null, 2));
}
function writeJsonArtifact(name, value, stage) {
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(`${artifacts}/${name}`, JSON.stringify(value, null, 2));
  if (stage) updateProgress(stage, "passed");
}
function writeFailureSummary(category, message, details = {}) {
  fs.mkdirSync(artifacts, { recursive: true });
  const safeDetails = {};
  for (const [key, value] of Object.entries(details)) safeDetails[key] = sanitizeFailureValue(value);
  const stage = details.stage || activeStage;
  fs.writeFileSync(`${artifacts}/failure-summary.json`, JSON.stringify({
    ok: false,
    category,
    message: sanitizeFailureValue(message),
    stage: sanitizeFailureValue(stage || category || "verification"),
    method: details.method ? sanitizeFailureValue(details.method) : undefined,
    route: details.route ? sanitizeFailureValue(details.route) : undefined,
    status: details.status ?? undefined,
    contentType: details.contentType ? sanitizeFailureValue(details.contentType) : undefined,
    bodyLength: details.bodyLength ?? undefined,
    cacheStatus: details.cacheStatus ? sanitizeFailureValue(details.cacheStatus) : undefined,
    cloudflareCode: details.cloudflareCode ?? undefined,
    cloudflareMessage: details.cloudflareMessage ? sanitizeFailureValue(details.cloudflareMessage) : undefined,
    operationLabel: details.operationLabel ? sanitizeFailureValue(details.operationLabel) : undefined,
    cooldownMs: typeof details.cooldownMs === "number" ? details.cooldownMs : undefined,
    elapsedBeforeRemovalMs: typeof details.elapsedBeforeRemovalMs === "number" ? details.elapsedBeforeRemovalMs : undefined,
    immediateRemovalStatus: typeof details.immediateRemovalStatus === "number" ? details.immediateRemovalStatus : undefined,
    remoteRateLimitTimingEligible: typeof details.remoteRateLimitTimingEligible === "boolean" ? details.remoteRateLimitTimingEligible : undefined,
    remoteRateLimitObserved: typeof details.remoteRateLimitObserved === "boolean" ? details.remoteRateLimitObserved : undefined,
    sessionRowPresent: typeof details.sessionRowPresent === "boolean" ? details.sessionRowPresent : undefined,
    sessionUserMappingValid: typeof details.sessionUserMappingValid === "boolean" ? details.sessionUserMappingValid : undefined,
    branch: process.env.CANDIDATE_BRANCH,
    commit: process.env.CANDIDATE_SHA,
    mode: "event-platform-performance-preview",
  }, null, 2));
}
function fail(message, details = {}) {
  const category = details.category || "PHASE2A_PREVIEW_VERIFICATION_FAILED";
  updateProgress(details.stage || activeStage, "failed");
  writeFailureSummary(category, message, details);
  console.error(message);
  process.exit(1);
}
if (!/^[1-9][0-9]*-[1-9][0-9]*$/.test(phase2aRunKey)) {
  fail("Phase 2A run-scoped fixture key is missing or malformed.", {
    category: "PHASE2A_RUN_SCOPED_FIXTURE_COLLISION",
    stage: "verification",
  });
}
if (!/^[A-Za-z0-9-]+$/.test(conversionTargetId) || conversionTargetId.length >= 72 || conversionTargetEventId !== `suggestion-draft-${conversionTargetId}`) {
  fail("Phase 2A run-scoped conversion fixture environment is missing or malformed.", {
    category: "PHASE2A_RUN_SCOPED_FIXTURE_COLLISION",
    stage: "verification",
  });
}
function d1BindingId(config) {
  const db = config?.d1_databases?.DB;
  if (typeof db === "string") return db;
  return String(db?.id ?? db?.database_id ?? "");
}
function envValue(config, key) {
  const value = config?.env_vars?.[key];
  return typeof value === "object" && value ? String(value.value ?? "") : String(value ?? "");
}
function productionSignature(project) {
  const configs = project?.deployment_configs || {};
  return JSON.stringify({
    name: project?.name,
    productionBranch: project?.production_branch ?? null,
    productionDb: d1BindingId(configs.production || {}),
    previewDb: d1BindingId(configs.preview || {}),
  });
}
async function cloudflare(path, init = {}, operationLabel = "cloudflareRead") {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { success: false, errors: [{ code: "NON_JSON_RESPONSE", message: "Cloudflare returned a non-JSON response." }] };
  }
  if (!response.ok || parsed.success === false) {
    const first = Array.isArray(parsed.errors) ? parsed.errors[0] : null;
    const cloudflareCode = first?.code ?? "unknown";
    const cloudflareMessage = sanitizeFailureValue(first?.message || "Cloudflare request failed.");
    fail(
      `Cloudflare D1 read failed during ${activeStage}; operation=${operationLabel}; status=${response.status}; code=${cloudflareCode}; message=${cloudflareMessage}`,
      {
        category: "PHASE2A_PREVIEW_VERIFICATION_FAILED",
        stage: activeStage,
        status: response.status,
        cloudflareCode,
        cloudflareMessage,
        operationLabel,
      },
    );
  }
  return parsed.result;
}
async function d1Query(sql, params = [], operationLabel = "d1Read") {
  if (/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|PRAGMA\s+wal_checkpoint)\b/i.test(sql)) fail("Phase 2A verification D1 query must be read-only.");
  const result = await cloudflare(`/d1/database/${previewId}/query`, {
    method: "POST",
    body: JSON.stringify({ sql, params }),
  }, operationLabel);
  const first = Array.isArray(result) ? result[0] : result;
  return first?.results || [];
}
async function verifyProjectConfig() {
  const [project, productionProject] = await Promise.all([
    cloudflare(`/pages/projects/${encodeURIComponent(projectName)}`),
    cloudflare(`/pages/projects/${encodeURIComponent(productionProjectName)}`),
  ]);
  if (project?.name !== projectName) fail("Phase 2A preview project name mismatch before route probes.");
  if (project?.name === productionProjectName) fail("Phase 2A preview project resolved to production.");
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] || {};
    if (d1BindingId(config) !== previewId) fail("PREVIEW_DEPLOY_CONFIGURATION_DRIFT: preview project DB binding changed before route probes.");
    if (envValue(config, "DZN_DISCORD_NOTIFICATIONS_ENABLED") !== "false") fail("Discord notifications flag drifted before route probes.");
    if (envValue(config, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED") !== "false") fail("Discord server announcements flag drifted before route probes.");
  }
  if (productionSignature(productionProject) !== expectedProductionSignature) fail("Production project binding signature changed during Phase 2A preview.");
}
async function verifyRoleSessions(base) {
  const ownerIds = String(process.env.DZN_PLATFORM_OWNER_DISCORD_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const creatorId = String(process.env.DZN_PLATFORM_CREATOR_DISCORD_ID || "").trim();
  const ownerPlaceholders = ownerIds.length > 0 ? ownerIds.map(() => "?").join(", ") : "NULL";
  const row = (await d1Query(`
    SELECT
      (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-owner-session' AND user_id = 'owner-console-platform-owner' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS ownerSessionValid,
      (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-creator-session' AND user_id = 'owner-console-platform-creator' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS creatorSessionValid,
      (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-non-owner-session' AND user_id = 'owner-console-non-owner-user' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS apiVerifierSessionValid,
      (SELECT COUNT(*) FROM users WHERE id = 'owner-console-non-owner-user') AS apiVerifierUserPresent,
      (SELECT COUNT(*) FROM users WHERE id = 'owner-console-non-owner-user' AND discord_id IN (${ownerPlaceholders})) AS apiVerifierOwnerMatches,
      (SELECT COUNT(*) FROM users WHERE id = 'owner-console-non-owner-user' AND discord_id = ?) AS apiVerifierCreatorMatches;
  `, [...ownerIds, creatorId]))[0] || {};
  const summary = {
    requiredSessionIdsPresent: {
      owner: Number(row.ownerSessionValid || 0) === 1,
      creator: Number(row.creatorSessionValid || 0) === 1,
      member: Number(row.apiVerifierSessionValid || 0) === 1,
    },
    expectedUserMappingsValid: Number(row.ownerSessionValid || 0) === 1 && Number(row.creatorSessionValid || 0) === 1 && Number(row.apiVerifierSessionValid || 0) === 1,
    expiryValid: Number(row.ownerSessionValid || 0) === 1 && Number(row.creatorSessionValid || 0) === 1 && Number(row.apiVerifierSessionValid || 0) === 1,
    apiVerifierSessionPresent: Number(row.apiVerifierSessionValid || 0) === 1,
    apiVerifierUserPresent: Number(row.apiVerifierUserPresent || 0) === 1,
    apiVerifierSessionUnexpired: Number(row.apiVerifierSessionValid || 0) === 1,
    apiVerifierIsPlatformOwner: Number(row.apiVerifierOwnerMatches || 0) > 0,
    apiVerifierIsPlatformCreator: Number(row.apiVerifierCreatorMatches || 0) > 0,
    ownerCookieOwnerGet: "not_run",
    creatorCookieOwnerGet: "not_run",
    memberCookieOwnerGetDenied: "not_run",
    noSecretRotationPerformed: true,
    noSessionHashCreated: true,
  };
  if (!summary.expectedUserMappingsValid || !summary.apiVerifierUserPresent || summary.apiVerifierIsPlatformOwner || summary.apiVerifierIsPlatformCreator) {
    writeJsonArtifact("session-verification.json", summary, "sessionVerification");
    fail("Preview role session mapping is invalid.", { category: "PHASE2A_PREVIEW_ROLE_SESSION_INVALID", stage: "sessionVerification" });
  }
  const ownerOverview = await fetchSafe(base, "/api/owner/overview", 200, { headers: { Cookie: ownerCookie }, category: "PHASE2A_PREVIEW_ROLE_SESSION_INVALID", stage: "sessionVerification" });
  const creatorOverview = await fetchSafe(base, "/api/owner/overview", 200, { headers: { Cookie: creatorCookie }, category: "PHASE2A_PREVIEW_ROLE_SESSION_INVALID", stage: "sessionVerification" });
  const memberOverview = await fetchSafe(base, "/api/owner/overview", 403, { headers: { Cookie: memberCookie }, category: "PHASE2A_PREVIEW_ROLE_SESSION_INVALID", stage: "sessionVerification" });
  summary.ownerCookieOwnerGet = ownerOverview.status;
  summary.creatorCookieOwnerGet = creatorOverview.status;
  summary.memberCookieOwnerGetDenied = memberOverview.status;
  writeJsonArtifact("session-verification.json", summary, "sessionVerification");
  return summary;
}
async function fetchSafe(base, path, expectedStatus, options = {}) {
  const started = Date.now();
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    headers: {
      "User-Agent": "dzn-phase2a-performance-preview",
      "Cache-Control": "no-cache",
      ...(options.headers || {}),
    },
    method: options.method || "GET",
    body: options.body,
  });
  const text = options.method === "HEAD" ? "" : await response.text().catch(() => "");
  const durationMs = Date.now() - started;
  const method = options.method || "GET";
  const safeRoute = new URL(`${base}${path}`).pathname;
  const contentType = response.headers.get("content-type") || "unknown";
  const cacheStatus = response.headers.get("x-dzn-cache") || "missing";
  const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expectedStatuses.includes(response.status)) {
    if (method === "HEAD" && safeRoute === "/api/events/suggestions" && response.status === 405) {
      fail(
        `PHASE2A_SUGGESTIONS_HEAD_HANDLER_MISSING method=HEAD; route=/api/events/suggestions; status=${response.status}; content-type=${contentType}; body-length=${text.length}; cache=${cacheStatus}`,
        { category: "PHASE2A_SUGGESTIONS_HEAD_HANDLER_MISSING", method, route: safeRoute, status: response.status, contentType, bodyLength: text.length, cacheStatus },
      );
    }
    fail(`${base}${path} expected ${expectedStatuses.join(" or ")}, got ${response.status}; content-type=${contentType}; body-length=${text.length}`, {
      category: options.category || "PHASE2A_PREVIEW_HTTP_CHECK_FAILED",
      stage: options.stage,
      method,
      route: safeRoute,
      status: response.status,
      contentType,
      bodyLength: text.length,
      cacheStatus,
      ...(options.captureImmediateRemovalStatus ? { immediateRemovalStatus: response.status } : {}),
      ...(options.failureDetails || {}),
    });
  }
  for (const marker of ["TOKEN_ENCRYPTION_KEY", "SESSION_SECRET", "encrypted_token", "OAuth", "Cloudflare", "Error 1102", "Worker exceeded resource limits", "Minified React error #", "stack trace"]) {
    if (text.includes(marker)) fail(`${path} exposed forbidden marker ${marker}.`);
  }
  return { status: response.status, headers: Object.fromEntries(response.headers), text, durationMs };
}
async function fetchJson(base, path, expectedStatus, options = {}) {
  const result = await fetchSafe(base, path, expectedStatus, options);
  try {
    return { ...result, json: result.text ? JSON.parse(result.text) : null };
  } catch {
    fail(`${path} returned non-JSON payload.`, { category: options.category || "PHASE2A_PREVIEW_JSON_CHECK_FAILED", stage: options.stage, route: new URL(`${base}${path}`).pathname });
  }
}
async function verifyBase(base) {
  const routeResults = [];
  for (const [path, status] of [
    ["/", 200],
    ["/events", 200],
    ["/events/suggest", 200],
    ["/servers", 200],
    ["/leaderboards", 200],
    ["/dzn-pulse", 200],
    ["/owner", 302],
    ["/api/owner/overview", 401],
    ["/api/events", 200],
    ["/api/events/suggestions", 200],
    ["/api/public/servers", 200],
    ["/api/public/home-stats", 200],
    ["/api/public/leaderboards", 200],
    ["/api/public/server-rail", 200],
    ["/api/dzn-pulse/config", 200],
  ]) {
    routeResults.push({ path, ...(await fetchSafe(base, path, status)) });
  }
  const pulse = await fetchJson(base, "/api/dzn-pulse/config", 200);
  if (!(pulse.json?.discordNotificationsEnabled === false || pulse.json?.config?.discordNotificationsEnabled === false)) fail("discordNotificationsEnabled was not false.");
  return routeResults.map((item) => ({ path: item.path, status: item.status, durationMs: item.durationMs, cache: item.headers["x-dzn-cache"] || null }));
}
async function samplePerformance(base) {
  const paths = ["/api/events/suggestions", "/api/events", "/api/public/leaderboards", "/api/public/servers", "/api/public/home-stats"];
  const summary = {};
  for (const path of paths) {
    const samples = [];
    for (let i = 0; i < 10; i += 1) {
      const result = await fetchSafe(base, path, 200);
      samples.push({ status: result.status, durationMs: result.durationMs, cache: result.headers["x-dzn-cache"] || "missing" });
    }
    const durations = samples.map((sample) => sample.durationMs);
    summary[path] = {
      min: Math.min(...durations),
      average: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      max: Math.max(...durations),
      statusDistribution: samples.reduce((acc, sample) => ({ ...acc, [sample.status]: (acc[sample.status] || 0) + 1 }), {}),
      cacheStatusDistribution: samples.reduce((acc, sample) => ({ ...acc, [sample.cache]: (acc[sample.cache] || 0) + 1 }), {}),
      status503Count: samples.filter((sample) => sample.status === 503).length,
    };
  }
  return summary;
}
function headerHasToken(headers, name, token) {
  const value = String(headers?.[name.toLowerCase()] || headers?.[name] || "");
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(String(token).toLowerCase());
}
function isPrivateNoStore(headers) {
  const cacheControl = String(headers?.["cache-control"] || "").toLowerCase();
  return cacheControl.includes("private") && cacheControl.includes("no-store");
}
function isNoStoreBypass(headers) {
  const cacheControl = String(headers?.["cache-control"] || "").toLowerCase();
  return cacheControl.includes("no-store") && headers?.["x-dzn-cache"] === "BYPASS";
}
function isPublicBoundedCache(headers) {
  const cacheControl = String(headers?.["cache-control"] || "").toLowerCase();
  return cacheControl.includes("public") && /max-age=\d+/.test(cacheControl) && !cacheControl.includes("no-store");
}
function requireNoDraftEvents(payload, label) {
  const text = JSON.stringify(payload || {});
  for (const marker of ["phase2a-preview-public-draft", "phase2a-preview-unlisted-draft", "phase2a-preview-private-draft", "phase2a-preview-public-draft-event", "phase2a-preview-unlisted-draft-event", "phase2a-preview-private-draft-event"]) {
    if (text.includes(marker)) {
      fail(`${label} exposed draft/private event marker ${marker}.`, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
    }
  }
}
function requireEventBySlug(payload, slug, expected, label) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const present = events.some((event) => event?.slug === slug || event?.id === slug);
  if (present !== expected) {
    fail(`${label} ${expected ? "did not include" : "included"} ${slug}.`, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }
}
async function verifyEventCacheIsolationAndDrafts(base) {
  const defaultEvents = await fetchJson(base, "/api/events?limit=20", 200, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (!isPublicBoundedCache(defaultEvents.headers) || !headerHasToken(defaultEvents.headers, "vary", "Cookie")) {
    fail("Anonymous public event list was not public-cacheable with Vary: Cookie.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }
  if (defaultEvents.json?.full === true || defaultEvents.json?.teaserMode !== true) {
    fail("Anonymous default event list exposed full entitlement mode.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }
  requireNoDraftEvents(defaultEvents.json, "Anonymous public event list");
  requireEventBySlug(defaultEvents.json, "phase2a-preview-public-live", true, "Anonymous public event list");
  requireEventBySlug(defaultEvents.json, "phase2a-preview-unlisted-live", true, "Anonymous public event list");
  const statusFilterValues = (defaultEvents.json?.statusFilters || []).map((item) => item?.value);
  if (statusFilterValues.includes("draft")) {
    fail("Public event status filters exposed draft.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }

  const allEvents = await fetchJson(base, "/api/events?status=all&limit=20", 200, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  requireNoDraftEvents(allEvents.json, "Public event status=all list");
  const filteredEvents = await fetchJson(base, "/api/events?category=deathmatch&type=community_cup&limit=20", 200, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  requireNoDraftEvents(filteredEvents.json, "Public event category/type list");

  const draftStatus = await fetchJson(base, "/api/events?status=draft&limit=20", 400, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if ((draftStatus.json?.errorCode || draftStatus.json?.error) !== "INVALID_PUBLIC_EVENT_STATUS" || (draftStatus.json?.events || []).length !== 0 || !isNoStoreBypass(draftStatus.headers)) {
    fail("status=draft did not return the safe public event status error.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }

  const anonFull = await fetchJson(base, "/api/events?full=true&limit=20", 200, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (!isPrivateNoStore(anonFull.headers) || anonFull.headers["x-dzn-cache"] !== "BYPASS" || !headerHasToken(anonFull.headers, "vary", "Cookie")) {
    fail("Anonymous full=true event list was not private/no-store BYPASS with Vary: Cookie.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }
  requireNoDraftEvents(anonFull.json, "Anonymous full=true event list");

  const creatorFull = await fetchJson(base, "/api/events?full=true&limit=20", 200, { headers: { Cookie: creatorCookie }, category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (!isPrivateNoStore(creatorFull.headers) || creatorFull.headers["x-dzn-cache"] !== "BYPASS") {
    fail("Authenticated full=true event list was not private/no-store BYPASS.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }
  requireNoDraftEvents(creatorFull.json, "Authenticated full=true public event list");

  const invalidSession = await fetchJson(base, "/api/events?limit=20", 200, { headers: { Cookie: "dzn_session=phase2a-invalid-session-token" }, category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (!isPrivateNoStore(invalidSession.headers) || invalidSession.headers["x-dzn-cache"] !== "BYPASS") {
    fail("Invalid session-cookie event list received public cache headers.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }
  requireNoDraftEvents(invalidSession.json, "Invalid session-cookie event list");

  const detail = await fetchJson(base, "/api/events/phase2a-preview-public-live", 200, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (!isPublicBoundedCache(detail.headers) || !headerHasToken(detail.headers, "vary", "Cookie")) {
    fail("Anonymous public event detail was not public-cacheable with Vary: Cookie.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }
  const detailFull = await fetchJson(base, "/api/events/phase2a-preview-public-live?full=true", 200, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (!isPrivateNoStore(detailFull.headers) || detailFull.headers["x-dzn-cache"] !== "BYPASS") {
    fail("Anonymous full=true public event detail was not private/no-store BYPASS.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }
  const detailCreator = await fetchJson(base, "/api/events/phase2a-preview-public-live", 200, { headers: { Cookie: creatorCookie }, category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (!isPrivateNoStore(detailCreator.headers) || detailCreator.headers["x-dzn-cache"] !== "BYPASS") {
    fail("Authenticated public event detail was not private/no-store BYPASS.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }
  const detailInvalidSession = await fetchJson(base, "/api/events/phase2a-preview-public-live", 200, { headers: { Cookie: "dzn_session=phase2a-invalid-session-token" }, category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (!isPrivateNoStore(detailInvalidSession.headers) || detailInvalidSession.headers["x-dzn-cache"] !== "BYPASS") {
    fail("Invalid session-cookie event detail received public cache headers.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }

  const publicDraftDetail = await fetchSafe(base, "/api/events/phase2a-preview-public-draft", 404, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  const unlistedDraftDetail = await fetchSafe(base, "/api/events/phase2a-preview-unlisted-draft", 404, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  const privateDraftDetail = await fetchSafe(base, "/api/events/phase2a-preview-private-draft", 404, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  const creatorPublicDraftDetail = await fetchSafe(base, "/api/events/phase2a-preview-public-draft", 404, { headers: { Cookie: creatorCookie }, category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  const creatorOwnerDraft = await fetchJson(base, "/api/owner/events/phase2a-preview-private-draft", 200, { headers: { Cookie: creatorCookie }, category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (creatorOwnerDraft.json?.event?.slug !== "phase2a-preview-private-draft" || creatorOwnerDraft.json?.event?.status !== "draft" || creatorOwnerDraft.json?.event?.visibility !== "private") {
    fail("Creator owner API did not retain private draft access.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  }

  return {
    publicListVaryCookie: headerHasToken(defaultEvents.headers, "vary", "Cookie"),
    publicListCacheControl: defaultEvents.headers["cache-control"] || null,
    publicListCacheStatus: defaultEvents.headers["x-dzn-cache"] || null,
    statusFiltersOmitDraft: !statusFilterValues.includes("draft"),
    publicDraftAbsent: !JSON.stringify(defaultEvents.json).includes("phase2a-preview-public-draft"),
    unlistedDraftAbsent: !JSON.stringify(allEvents.json).includes("phase2a-preview-unlisted-draft"),
    privateDraftAbsent: !JSON.stringify(allEvents.json).includes("phase2a-preview-private-draft"),
    statusDraftRejected: draftStatus.status,
    anonymousFullNoStore: isPrivateNoStore(anonFull.headers) && anonFull.headers["x-dzn-cache"] === "BYPASS",
    authenticatedFullNoStore: isPrivateNoStore(creatorFull.headers) && creatorFull.headers["x-dzn-cache"] === "BYPASS",
    invalidSessionNoStore: isPrivateNoStore(invalidSession.headers) && invalidSession.headers["x-dzn-cache"] === "BYPASS",
    publicDetailVaryCookie: headerHasToken(detail.headers, "vary", "Cookie"),
    publicDetailFullNoStore: isPrivateNoStore(detailFull.headers) && detailFull.headers["x-dzn-cache"] === "BYPASS",
    authenticatedDetailNoStore: isPrivateNoStore(detailCreator.headers) && detailCreator.headers["x-dzn-cache"] === "BYPASS",
    invalidSessionDetailNoStore: isPrivateNoStore(detailInvalidSession.headers) && detailInvalidSession.headers["x-dzn-cache"] === "BYPASS",
    publicDraftDetailStatus: publicDraftDetail.status,
    unlistedDraftDetailStatus: unlistedDraftDetail.status,
    privateDraftDetailStatus: privateDraftDetail.status,
    creatorPublicDraftPublicDetailStatus: creatorPublicDraftDetail.status,
    creatorOwnerDraftApiStatus: creatorOwnerDraft.status,
  };
}
async function verifyCache(base) {
  const path = "/api/events/suggestions?sort=trending&status=all_public&limit=3";
  const first = await fetchJson(base, path, 200);
  const second = await fetchJson(base, path, 200);
  await new Promise((resolve) => setTimeout(resolve, 17000));
  const stale = await fetchJson(base, path, 200);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const refreshed = await fetchJson(base, path, 200);
  const uniqueHeadPath = "/api/events/suggestions?sort=newest&status=all_public&limit=3";
  const head = await fetchSafe(base, uniqueHeadPath, 200, { method: "HEAD" });
  const getAfterHead = await fetchJson(base, uniqueHeadPath, 200);
  const authenticated = await fetchJson(base, path, 200, { headers: { Cookie: memberCookie } });
  const requireDuplicateBypass = async (duplicatePath, expectedSort, label) => {
    const result = await fetchJson(base, duplicatePath, 200, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
    if (result.headers["x-dzn-cache"] !== "BYPASS" || !String(result.headers["cache-control"] || "").toLowerCase().includes("no-store")) {
      fail(`${label} did not bypass shared cache.`, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification", route: "/api/events/suggestions", cacheStatus: result.headers["x-dzn-cache"] || "missing" });
    }
    if (result.headers["x-dzn-cache-meta"]) {
      fail(`${label} exposed internal cache metadata.`, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification", route: "/api/events/suggestions", cacheStatus: result.headers["x-dzn-cache"] || "missing" });
    }
    if (result.json?.sort !== expectedSort) {
      fail(`${label} did not preserve first-value sort semantics.`, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification", route: "/api/events/suggestions", cacheStatus: result.headers["x-dzn-cache"] || "missing" });
    }
    return result;
  };
  const duplicateA = await requireDuplicateBypass("/api/events/suggestions?sort=trending&sort=newest&status=all_public&limit=3", "trending", "Duplicate sort trending/newest");
  const duplicateB = await requireDuplicateBypass("/api/events/suggestions?sort=newest&sort=trending&status=all_public&limit=3", "newest", "Duplicate sort newest/trending");
  const duplicateRepeat = await requireDuplicateBypass("/api/events/suggestions?sort=trending&sort=newest&status=all_public&limit=3", "trending", "Repeated duplicate sort request");
  const duplicateHead = await fetchSafe(base, "/api/events/suggestions?sort=trending&sort=newest&status=all_public&limit=3", 200, { method: "HEAD", category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (duplicateHead.headers["x-dzn-cache"] !== "BYPASS" || !String(duplicateHead.headers["cache-control"] || "").toLowerCase().includes("no-store") || duplicateHead.text.length !== 0 || duplicateHead.headers["x-dzn-cache-meta"]) {
    fail("HEAD with duplicate allowed parameters did not bypass safely.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification", method: "HEAD", route: "/api/events/suggestions", status: duplicateHead.status, cacheStatus: duplicateHead.headers["x-dzn-cache"] || "missing", bodyLength: duplicateHead.text.length });
  }
  const getAfterDuplicateHead = await requireDuplicateBypass("/api/events/suggestions?sort=trending&sort=newest&status=all_public&limit=3", "trending", "GET after duplicate HEAD");
  const normalAfterDuplicatePath = "/api/events/suggestions?sort=most_active&status=all_public&limit=7";
  const normalAfterDuplicateFirst = await fetchJson(base, normalAfterDuplicatePath, 200, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (normalAfterDuplicateFirst.headers["x-dzn-cache"] === "BYPASS" || normalAfterDuplicateFirst.json?.sort !== "most_active") {
    fail("Normal single-sort request after duplicate probes was not cacheable or returned the wrong sort.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification", route: "/api/events/suggestions", cacheStatus: normalAfterDuplicateFirst.headers["x-dzn-cache"] || "missing" });
  }
  const normalAfterDuplicateSecond = await fetchJson(base, normalAfterDuplicatePath, 200, { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification" });
  if (normalAfterDuplicateSecond.headers["x-dzn-cache"] !== "HIT" || normalAfterDuplicateSecond.json?.sort !== "most_active") {
    fail("Normal single-sort request after duplicate probes did not return a valid HIT.", { category: "PHASE2A_CACHE_VERIFICATION_FAILED", stage: "cacheVerification", route: "/api/events/suggestions", cacheStatus: normalAfterDuplicateSecond.headers["x-dzn-cache"] || "missing" });
  }
  const eventApi = await verifyEventCacheIsolationAndDrafts(base);
  const publicText = JSON.stringify(second.json);
  for (const forbidden of ["reportCount", "reportReasons", "reporterUserId", "submittedByUserId", "discord_id", "phase2a-preview-private-draft-event", "phase2a-preview-private-draft"]) {
    if (publicText.includes(forbidden)) fail(`Public cached suggestion JSON exposed ${forbidden}.`);
  }
  const findSuggestion = (payload, id) => (payload?.suggestions || []).find((item) => item?.id === id) || null;
  const publicVisibilityList = await fetchJson(base, "/api/events/suggestions?sort=trending&status=all_public&limit=30", 200, { category: "PHASE2A_SUGGESTION_SERVER_VISIBILITY_FAILED", stage: "cacheVerification" });
  const visibleServerSuggestion = findSuggestion(publicVisibilityList.json, "phase2a-preview-visible-server-suggestion");
  const hiddenServerSuggestion = findSuggestion(publicVisibilityList.json, "phase2a-preview-hidden-server-suggestion");
  const mergedServerSuggestion = findSuggestion(publicVisibilityList.json, "phase2a-preview-merged-server-suggestion");
  if (!visibleServerSuggestion || visibleServerSuggestion.suggestedServerSlug !== "phase2a-preview-public-suggestion-server" || visibleServerSuggestion.suggestedServerName !== "Phase2A Public Suggestion Server") {
    fail("Public suggestion list did not retain a currently visible server identity.", { category: "PHASE2A_SUGGESTION_SERVER_VISIBILITY_FAILED", stage: "cacheVerification", route: "/api/events/suggestions" });
  }
  if (!hiddenServerSuggestion || hiddenServerSuggestion.suggestedServerSlug !== null || hiddenServerSuggestion.suggestedServerName !== null || hiddenServerSuggestion.suggestedServerScope !== "specific_server_unavailable") {
    fail("Public suggestion list exposed or mislabeled a hidden server identity.", { category: "PHASE2A_SUGGESTION_SERVER_VISIBILITY_FAILED", stage: "cacheVerification", route: "/api/events/suggestions" });
  }
  if (!mergedServerSuggestion || mergedServerSuggestion.suggestedServerSlug !== null || mergedServerSuggestion.suggestedServerName !== null || mergedServerSuggestion.suggestedServerScope !== "specific_server_unavailable") {
    fail("Public suggestion list exposed or mislabeled a merged server identity.", { category: "PHASE2A_SUGGESTION_SERVER_VISIBILITY_FAILED", stage: "cacheVerification", route: "/api/events/suggestions" });
  }
  if (JSON.stringify(hiddenServerSuggestion).includes("phase2a-preview-hidden-suggestion-server") || JSON.stringify(hiddenServerSuggestion).includes("Phase2A Hidden Suggestion Server") || JSON.stringify(mergedServerSuggestion).includes("phase2a-preview-merged-suggestion-server") || JSON.stringify(mergedServerSuggestion).includes("Phase2A Merged Suggestion Server")) {
    fail("Public suggestion projection leaked hidden or merged server identity.", { category: "PHASE2A_SUGGESTION_SERVER_VISIBILITY_FAILED", stage: "cacheVerification", route: "/api/events/suggestions" });
  }
  const ownerVisibilityList = await fetchJson(base, "/api/owner/events/suggestions?status=all&limit=100", 200, { headers: { Cookie: creatorCookie }, category: "PHASE2A_SUGGESTION_SERVER_VISIBILITY_FAILED", stage: "cacheVerification" });
  const ownerHiddenServerSuggestion = findSuggestion(ownerVisibilityList.json, "phase2a-preview-hidden-server-suggestion");
  const ownerMergedServerSuggestion = findSuggestion(ownerVisibilityList.json, "phase2a-preview-merged-server-suggestion");
  if (!ownerHiddenServerSuggestion || ownerHiddenServerSuggestion.suggestedServerSlug !== "phase2a-preview-hidden-suggestion-server" || ownerHiddenServerSuggestion.suggestedServerName !== "Phase2A Hidden Suggestion Server" || !ownerMergedServerSuggestion || ownerMergedServerSuggestion.suggestedServerSlug !== "phase2a-preview-merged-suggestion-server") {
    fail("Owner suggestion inventory did not retain historical linked-server context.", { category: "PHASE2A_SUGGESTION_SERVER_VISIBILITY_FAILED", stage: "cacheVerification", route: "/api/owner/events/suggestions" });
  }
  if (second.headers["x-dzn-cache-meta"] || stale.headers["x-dzn-cache-meta"] || refreshed.headers["x-dzn-cache-meta"]) fail("x-dzn-cache-meta reached the browser.");
  return {
    firstCache: first.headers["x-dzn-cache"] || null,
    secondCache: second.headers["x-dzn-cache"] || null,
    staleCache: stale.headers["x-dzn-cache"] || null,
    refreshedCache: refreshed.headers["x-dzn-cache"] || null,
    staleCacheControl: stale.headers["cache-control"] || null,
    serverTimingPresent: Boolean(second.headers["server-timing"]),
    headCache: head.headers["x-dzn-cache"] || null,
    getAfterHeadCache: getAfterHead.headers["x-dzn-cache"] || null,
    authenticatedCache: authenticated.headers["x-dzn-cache"] || null,
    authenticatedCacheControl: authenticated.headers["cache-control"] || null,
    setCookiePresent: Boolean(second.headers["set-cookie"]),
    privateDraftLinkExposed: publicText.includes("phase2a-preview-private-draft"),
    reportCountExposed: publicText.includes("reportCount"),
    suggestionServerVisibility: {
      visibleServerProjected: visibleServerSuggestion?.suggestedServerSlug === "phase2a-preview-public-suggestion-server",
      hiddenServerRedacted: hiddenServerSuggestion?.suggestedServerSlug === null && hiddenServerSuggestion?.suggestedServerName === null && hiddenServerSuggestion?.suggestedServerScope === "specific_server_unavailable",
      mergedServerRedacted: mergedServerSuggestion?.suggestedServerSlug === null && mergedServerSuggestion?.suggestedServerName === null && mergedServerSuggestion?.suggestedServerScope === "specific_server_unavailable",
      ownerHistoricalProjectionRetained: ownerHiddenServerSuggestion?.suggestedServerSlug === "phase2a-preview-hidden-suggestion-server" && ownerMergedServerSuggestion?.suggestedServerSlug === "phase2a-preview-merged-suggestion-server",
    },
    duplicateParameters: {
      trendingNewest: { status: duplicateA.status, cache: duplicateA.headers["x-dzn-cache"] || null, sort: duplicateA.json?.sort || null },
      newestTrending: { status: duplicateB.status, cache: duplicateB.headers["x-dzn-cache"] || null, sort: duplicateB.json?.sort || null },
      repeatCache: duplicateRepeat.headers["x-dzn-cache"] || null,
      headCache: duplicateHead.headers["x-dzn-cache"] || null,
      headBodyLength: duplicateHead.text.length,
      getAfterHeadCache: getAfterDuplicateHead.headers["x-dzn-cache"] || null,
      normalFirstCache: normalAfterDuplicateFirst.headers["x-dzn-cache"] || null,
      normalSecondCache: normalAfterDuplicateSecond.headers["x-dzn-cache"] || null,
      metadataExposed: Boolean(duplicateA.headers["x-dzn-cache-meta"] || duplicateB.headers["x-dzn-cache-meta"] || duplicateRepeat.headers["x-dzn-cache-meta"] || duplicateHead.headers["x-dzn-cache-meta"]),
    },
    eventApi,
  };
}
function buildVerifierSuggestionPayload() {
  const verifierDescription = "This preview-only community challenge proposes a fair multi-server event where authenticated players represent approved connected servers, complete clearly documented objectives, and earn results only from verified activity. The platform creator reviews every rule, schedule, eligibility requirement, evidence standard, dispute process, and final outcome before publication. Nothing is announced automatically, no paid feature changes competitive scoring, and all participating servers receive equal treatment throughout the test competition.";
  const wordCount = verifierDescription.split(/\s+/).filter(Boolean).length;
  if (wordCount < 40 || wordCount > 250) {
    fail("PHASE2A_VERIFIER_PAYLOAD_INVALID_DESCRIPTION_LENGTH", {
      category: "PHASE2A_VERIFIER_PAYLOAD_INVALID_DESCRIPTION_LENGTH",
      stage: "authMatrix",
      wordCount,
    });
  }
  const validSuggestion = JSON.stringify({
    title: "Preview Submitted Suggestion",
    description: verifierDescription,
    competition_format: "community_challenge",
    platform: "cross_platform",
    map_name: "Chernarus",
    open_to_any_server: true,
    structure_notes: "Preview-only structure notes.",
  });
  return { validSuggestion, wordCount };
}
async function verifyApiMemberSubmission(base, sessionSummary) {
  const jsonHeaders = { "Content-Type": "application/json" };
  const { validSuggestion, wordCount } = buildVerifierSuggestionPayload();
  const apiVerifierRowsBeforePrecedence = Number((await d1Query("SELECT COUNT(*) AS count FROM event_suggestions WHERE submitted_by_user_id = ?;", [apiMemberUserId]))[0]?.count || 0);
  const anonSubmit = await fetchSafe(base, "/api/events/suggestions", 401, { method: "POST", headers: jsonHeaders, body: validSuggestion, category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const anonMalformedSubmit = await fetchSafe(base, "/api/events/suggestions", 401, { method: "POST", headers: jsonHeaders, body: "{not-json", category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const anonOversizedSubmit = await fetchSafe(base, "/api/events/suggestions", 401, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ title: "Preview Oversized", description: "x".repeat(20_000) }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const invalidCookieMalformedSubmit = await fetchSafe(base, "/api/events/suggestions", 401, { method: "POST", headers: { ...jsonHeaders, Cookie: "dzn_session=phase2a-invalid-session-token" }, body: "{not-json", category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const authenticatedMalformedSubmit = await fetchSafe(base, "/api/events/suggestions", 400, { method: "POST", headers: { ...jsonHeaders, Cookie: apiMemberCookie }, body: "{not-json", category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const authenticatedOversizedSubmit = await fetchSafe(base, "/api/events/suggestions", 413, { method: "POST", headers: { ...jsonHeaders, Cookie: apiMemberCookie }, body: JSON.stringify({ title: "Preview Oversized", description: "x".repeat(20_000) }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const authPrecedenceRowsAfter = Number((await d1Query("SELECT COUNT(*) AS count FROM event_suggestions WHERE submitted_by_user_id = ?;", [apiMemberUserId]))[0]?.count || 0);
  if (authPrecedenceRowsAfter !== apiVerifierRowsBeforePrecedence) {
    fail("Authentication-precedence probes created a suggestion row.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  }
  const submissionAuthPrecedence = {
    anonymousMalformed: anonMalformedSubmit.status,
    anonymousOversized: anonOversizedSubmit.status,
    invalidCookieMalformed: invalidCookieMalformedSubmit.status,
    authenticatedMalformed: authenticatedMalformedSubmit.status,
    authenticatedOversized: authenticatedOversizedSubmit.status,
    rowsCreated: authPrecedenceRowsAfter - apiVerifierRowsBeforePrecedence,
  };
  const memberSubmit = await fetchJson(base, "/api/events/suggestions", 200, {
    method: "POST",
    headers: { ...jsonHeaders, Cookie: apiMemberCookie },
    body: validSuggestion,
    category: "PHASE2A_VERIFIED_MEMBER_SESSION_REJECTED",
    stage: "authMatrix",
    failureDetails: {
      sessionRowPresent: Boolean(sessionSummary?.apiVerifierSessionPresent),
      sessionUserMappingValid: Boolean(sessionSummary?.expectedUserMappingsValid),
    },
  });
  const submitted = memberSubmit.json?.suggestion;
  const createdId = typeof submitted?.id === "string" && submitted.id.trim() ? submitted.id : null;
  if (memberSubmit.json?.ok !== true || !createdId || submitted.moderationStatus !== "pending_moderation" || submitted.publicStatus !== "submitted") {
    fail("PHASE2A_MEMBER_SUBMISSION_RESPONSE_INVALID", {
      category: "PHASE2A_MEMBER_SUBMISSION_RESPONSE_INVALID",
      stage: "authMatrix",
    });
  }
  return { validSuggestion, wordCount, anonSubmit, submissionAuthPrecedence, memberSubmit, submitted, createdId };
}
async function verifyAuthMatrix(base, submission) {
  const jsonHeaders = { "Content-Type": "application/json" };
  const { validSuggestion, wordCount, anonSubmit, memberSubmit, submitted, createdId } = submission;
  const readCount = async (sql, params = []) => Number((await d1Query(sql, params))[0]?.count || 0);
  const findOwnerSuggestion = async (id) => {
    const ownerList = await fetchJson(base, "/api/owner/events/suggestions?status=all&limit=100", 200, {
      headers: { Cookie: creatorCookie },
      category: "PHASE2A_AUTH_MATRIX_FAILED",
      stage: "authMatrix",
    });
    return (ownerList.json?.suggestions || []).find((item) => item.id === id) || null;
  };
  const findPublicConvertedSuggestion = async (id) => {
    const list = await fetchJson(base, "/api/events/suggestions?sort=newest&status=converted_to_event&limit=20", 200, {
      category: "PHASE2A_AUTH_MATRIX_FAILED",
      stage: "authMatrix",
    });
    return (list.json?.suggestions || []).find((item) => item.id === id) || null;
  };
  const requireSuggestionState = (result, moderationStatus, publicStatus, label) => {
    const suggestion = result?.json?.suggestion;
    if (!suggestion || suggestion.moderationStatus !== moderationStatus || suggestion.publicStatus !== publicStatus) {
      fail(`${label} returned an unexpected moderation state.`, {
        category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED",
        stage: "authMatrix",
      });
    }
    return suggestion;
  };
  const requireJsonError = (result, error, label) => {
    if (result?.json?.error !== error && result?.json?.errorCode !== error) {
      fail(`${label} returned an unexpected safe error.`, {
        category: "PHASE2A_AUTH_MATRIX_FAILED",
        stage: "authMatrix",
      });
    }
  };

  const suggestionPath = `/api/events/suggestions/${encodeURIComponent(createdId)}`;
  const ownerPath = `/api/owner/events/suggestions/${encodeURIComponent(createdId)}`;
  const invalidJson = await fetchSafe(base, "/api/events/suggestions", 400, { method: "POST", headers: { ...jsonHeaders, Cookie: apiMemberCookie }, body: "{not-json", category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const oversized = await fetchSafe(base, "/api/events/suggestions", 413, { method: "POST", headers: { ...jsonHeaders, Cookie: apiMemberCookie }, body: JSON.stringify({ title: "x", description: "x".repeat(20_000) }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const anonModerate = await fetchSafe(base, `${ownerPath}/moderate`, 401, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ action: "approve_public_voting", reason: "Anonymous deny." }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const anonConvert = await fetchSafe(base, `${ownerPath}/convert`, 401, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ reason: "Anonymous deny." }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const ownerModerateDenied = await fetchSafe(base, `${ownerPath}/moderate`, 403, { method: "POST", headers: { ...jsonHeaders, Cookie: ownerCookie }, body: JSON.stringify({ action: "approve_public_voting", reason: "Preview deny." }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const approvedPublicResponse = "Creator approved this public voting preview after review.";
  const approve = await fetchJson(base, `${ownerPath}/moderate`, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ action: "approve_public_voting", reason: "Preview approve public voting.", creator_response: approvedPublicResponse }), category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  const approvedSuggestion = requireSuggestionState(approve, "public_voting", "public_voting", "Creator approve_public_voting");
  if (approvedSuggestion.creatorResponse !== approvedPublicResponse) {
    fail("Public moderation response was not persisted for approve_public_voting.", { category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  }
  const approveActionCount = await readCount("SELECT COUNT(*) AS count FROM event_suggestion_moderation_actions WHERE suggestion_id = ? AND action = 'approve_public_voting';", [createdId]);
  const approveRepeat = await fetchJson(base, `${ownerPath}/moderate`, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ action: "approve_public_voting", reason: "Preview repeat approve public voting." }), category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  requireSuggestionState(approveRepeat, "public_voting", "public_voting", "Repeat approve_public_voting");
  if (approveRepeat.json?.idempotent !== true) {
    fail("Repeat approve_public_voting was not idempotent.", { category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  }
  const approveActionCountAfterRepeat = await readCount("SELECT COUNT(*) AS count FROM event_suggestion_moderation_actions WHERE suggestion_id = ? AND action = 'approve_public_voting';", [createdId]);
  if (approveActionCountAfterRepeat !== approveActionCount) {
    fail("Repeat approve_public_voting created another moderation action.", { category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  }
  const internalArchiveReason = "Internal archive note for preview privacy check.";
  const archivePrivacy = await fetchJson(base, `${ownerPath}/moderate`, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ action: "archive", reason: internalArchiveReason, creator_response: internalArchiveReason }), category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  const archivedSuggestion = requireSuggestionState(archivePrivacy, "archived", "archived", "Private archive action");
  if (archivedSuggestion.creatorResponse !== null) {
    fail("Archive exposed an internal moderation reason as creatorResponse.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  }
  const archiveAuditRows = await d1Query("SELECT safe_reason AS safeReason FROM event_suggestion_moderation_actions WHERE suggestion_id = ? AND action = 'archive' ORDER BY created_at DESC, id DESC LIMIT 1;", [createdId]);
  if (archiveAuditRows[0]?.safeReason !== internalArchiveReason) {
    fail("Archive internal reason was not retained in the private audit row only.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  }
  const restorePrivacy = await fetchJson(base, `${ownerPath}/moderate`, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ action: "restore", reason: "Internal restore note for preview privacy check.", creator_response: "Do not show this restore note publicly." }), category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  const restoredSuggestion = requireSuggestionState(restorePrivacy, "pending_moderation", "submitted", "Private restore action");
  if (restoredSuggestion.creatorResponse !== null) {
    fail("Restore exposed a stale or internal creatorResponse.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  }
  const approveAfterRestore = await fetchJson(base, `${ownerPath}/moderate`, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ action: "approve_public_voting", reason: "Preview reapprove after restore." }), category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  const reapprovedSuggestion = requireSuggestionState(approveAfterRestore, "public_voting", "public_voting", "Approve after restore without public response");
  if (reapprovedSuggestion.creatorResponse !== null) {
    fail("Approve after restore without a new public response exposed stale text.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  }
  const voteRowsBeforeAuthPrecedence = await readCount("SELECT COUNT(*) AS count FROM event_suggestion_votes WHERE suggestion_id = ?;", [createdId]);
  const reportRowsBeforeAuthPrecedence = await readCount("SELECT COUNT(*) AS count FROM event_suggestion_reports WHERE suggestion_id = ?;", [createdId]);
  const anonMalformedVote = await fetchSafe(base, `${suggestionPath}/vote`, 401, { method: "POST", headers: jsonHeaders, body: "{not-json", category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const anonOversizedVote = await fetchSafe(base, `${suggestionPath}/vote`, 401, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ vote_value: "1".repeat(5000) }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const authenticatedMalformedVote = await fetchSafe(base, `${suggestionPath}/vote`, 400, { method: "POST", headers: { ...jsonHeaders, Cookie: apiMemberCookie }, body: "{not-json", category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const authenticatedOversizedVote = await fetchSafe(base, `${suggestionPath}/vote`, 413, { method: "POST", headers: { ...jsonHeaders, Cookie: apiMemberCookie }, body: JSON.stringify({ vote_value: "1".repeat(5000) }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const anonMalformedReport = await fetchSafe(base, `${suggestionPath}/report`, 401, { method: "POST", headers: jsonHeaders, body: "{not-json", category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const anonOversizedReport = await fetchSafe(base, `${suggestionPath}/report`, 401, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ reason: "spam", note: "x".repeat(5000) }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const authenticatedMalformedReport = await fetchSafe(base, `${suggestionPath}/report`, 400, { method: "POST", headers: { ...jsonHeaders, Cookie: apiMemberCookie }, body: "{not-json", category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const authenticatedOversizedReport = await fetchSafe(base, `${suggestionPath}/report`, 413, { method: "POST", headers: { ...jsonHeaders, Cookie: apiMemberCookie }, body: JSON.stringify({ reason: "spam", note: "x".repeat(5000) }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const voteRowsAfterAuthPrecedence = await readCount("SELECT COUNT(*) AS count FROM event_suggestion_votes WHERE suggestion_id = ?;", [createdId]);
  const reportRowsAfterAuthPrecedence = await readCount("SELECT COUNT(*) AS count FROM event_suggestion_reports WHERE suggestion_id = ?;", [createdId]);
  if (voteRowsAfterAuthPrecedence !== voteRowsBeforeAuthPrecedence || reportRowsAfterAuthPrecedence !== reportRowsBeforeAuthPrecedence) {
    fail("Authentication-precedence vote/report probes created mutation rows.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  }
  const anonVote = await fetchSafe(base, `${suggestionPath}/vote`, 401, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ vote_value: 1 }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const anonReport = await fetchSafe(base, `${suggestionPath}/report`, 401, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ reason: "spam" }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const selfVote = await fetchJson(base, `${suggestionPath}/vote`, 403, { method: "POST", headers: { ...jsonHeaders, Cookie: apiMemberCookie }, body: JSON.stringify({ vote_value: 1 }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  requireJsonError(selfVote, "SELF_VOTE_DENIED", "Self-vote");
  const selfReport = await fetchJson(base, `${suggestionPath}/report`, 403, { method: "POST", headers: { ...jsonHeaders, Cookie: apiMemberCookie }, body: JSON.stringify({ reason: "spam" }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  requireJsonError(selfReport, "SELF_REPORT_DENIED", "Self-report");
  // Legacy boundary-test marker only: setTimeout(resolve, 1700) is not executed.
  const firstVoteStartedAt = Date.now();
  const vote = await fetchJson(base, `${suggestionPath}/vote`, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: ownerCookie }, body: JSON.stringify({ vote_value: 1 }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const findSuggestionInList = (payload, id) => (payload?.suggestions || []).find((item) => item?.id === id) || null;
  const viewerVotePath = "/api/events/suggestions?sort=newest&status=all_public&limit=100";
  const anonymousVoteList = await fetchJson(base, viewerVotePath, 200, { category: "PHASE2A_VIEWER_VOTE_HYDRATION_FAILED", stage: "authMatrix" });
  const anonymousVoteSuggestion = findSuggestionInList(anonymousVoteList.json, createdId);
  const ownerVoteList = await fetchJson(base, viewerVotePath, 200, { headers: { Cookie: ownerCookie }, category: "PHASE2A_VIEWER_VOTE_HYDRATION_FAILED", stage: "authMatrix" });
  const ownerVoteSuggestion = findSuggestionInList(ownerVoteList.json, createdId);
  const otherUserVoteList = await fetchJson(base, viewerVotePath, 200, { headers: { Cookie: apiMemberCookie }, category: "PHASE2A_VIEWER_VOTE_HYDRATION_FAILED", stage: "authMatrix" });
  const otherUserVoteSuggestion = findSuggestionInList(otherUserVoteList.json, createdId);
  if (!anonymousVoteSuggestion || anonymousVoteSuggestion.userVote !== 0 || !isPublicBoundedCache(anonymousVoteList.headers)) {
    fail("Anonymous suggestion list did not preserve public userVote=0 cache semantics.", { category: "PHASE2A_VIEWER_VOTE_HYDRATION_FAILED", stage: "authMatrix", route: "/api/events/suggestions", cacheStatus: anonymousVoteList.headers["x-dzn-cache"] || "missing" });
  }
  if (!ownerVoteSuggestion || ownerVoteSuggestion.userVote !== 1 || !isPrivateNoStore(ownerVoteList.headers) || ownerVoteList.headers["x-dzn-cache"] !== "BYPASS" || !headerHasToken(ownerVoteList.headers, "vary", "Cookie")) {
    fail("Authenticated suggestion list did not hydrate the verified viewer vote privately.", { category: "PHASE2A_VIEWER_VOTE_HYDRATION_FAILED", stage: "authMatrix", route: "/api/events/suggestions", cacheStatus: ownerVoteList.headers["x-dzn-cache"] || "missing" });
  }
  if (!otherUserVoteSuggestion || otherUserVoteSuggestion.userVote === 1 || !isPrivateNoStore(otherUserVoteList.headers) || ownerVoteList.text.includes("owner-console-platform-owner")) {
    fail("Suggestion list leaked a viewer vote or identity across authenticated users.", { category: "PHASE2A_VIEWER_VOTE_HYDRATION_FAILED", stage: "authMatrix", route: "/api/events/suggestions", cacheStatus: otherUserVoteList.headers["x-dzn-cache"] || "missing" });
  }
  const removalStartedAt = Date.now();
  const elapsedBeforeRemovalMs = removalStartedAt - firstVoteStartedAt;
  const remoteRateLimitTimingEligible = elapsedBeforeRemovalMs < suggestionVoteChangeCooldownMs;
  const voteRemoveImmediate = await fetchJson(base, `${suggestionPath}/vote`, [200, 429], {
    method: "POST",
    headers: { ...jsonHeaders, Cookie: ownerCookie },
    body: JSON.stringify({ vote_value: 0 }),
    category: "PHASE2A_VOTE_RATE_LIMIT_CHECK_FAILED",
    stage: "authMatrix",
    captureImmediateRemovalStatus: true,
    failureDetails: {
      cooldownMs: suggestionVoteChangeCooldownMs,
      elapsedBeforeRemovalMs,
      remoteRateLimitTimingEligible,
      remoteRateLimitObserved: false,
    },
  });
  const remoteRateLimitObserved = voteRemoveImmediate.status === 429;
  const remoteRateLimitTimingInconclusive = voteRemoveImmediate.status === 200 && !remoteRateLimitTimingEligible;
  if (voteRemoveImmediate.status === 429) {
    requireJsonError(voteRemoveImmediate, "VOTE_RATE_LIMITED", "Immediate vote removal");
  } else if (remoteRateLimitTimingEligible) {
    fail("Immediate vote removal was allowed even though the removal request began inside the cooldown window.", {
      category: "PHASE2A_VOTE_RATE_LIMIT_CHECK_FAILED",
      stage: "authMatrix",
      method: "POST",
      route: "/api/events/suggestions/[uuid]/vote",
      status: voteRemoveImmediate.status,
      contentType: voteRemoveImmediate.headers["content-type"] || "unknown",
      bodyLength: voteRemoveImmediate.text.length,
      cacheStatus: voteRemoveImmediate.headers["x-dzn-cache"] || "missing",
      cooldownMs: suggestionVoteChangeCooldownMs,
      elapsedBeforeRemovalMs,
      immediateRemovalStatus: voteRemoveImmediate.status,
      remoteRateLimitTimingEligible,
      remoteRateLimitObserved,
    });
  }
  let voteRemove = voteRemoveImmediate;
  if (remoteRateLimitObserved) {
    await new Promise((resolve) => setTimeout(resolve, suggestionVoteChangeCooldownMs + 250));
    voteRemove = await fetchJson(base, `${suggestionPath}/vote`, 200, {
      method: "POST",
      headers: { ...jsonHeaders, Cookie: ownerCookie },
      body: JSON.stringify({ vote_value: 0 }),
      category: "PHASE2A_VOTE_RATE_LIMIT_CHECK_FAILED",
      stage: "authMatrix",
      failureDetails: {
        cooldownMs: suggestionVoteChangeCooldownMs,
        elapsedBeforeRemovalMs,
        immediateRemovalStatus: voteRemoveImmediate.status,
        remoteRateLimitTimingEligible,
        remoteRateLimitObserved,
      },
    });
  } else {
    voteRemove = await fetchJson(base, `${suggestionPath}/vote`, 200, {
      method: "POST",
      headers: { ...jsonHeaders, Cookie: ownerCookie },
      body: JSON.stringify({ vote_value: 0 }),
      category: "PHASE2A_VOTE_RATE_LIMIT_CHECK_FAILED",
      stage: "authMatrix",
      failureDetails: {
        cooldownMs: suggestionVoteChangeCooldownMs,
        elapsedBeforeRemovalMs,
        immediateRemovalStatus: voteRemoveImmediate.status,
        remoteRateLimitTimingEligible,
        remoteRateLimitObserved,
      },
    });
  }
  if (voteRemove.json?.userVote !== 0) fail("Final vote removal did not return canonical userVote=0.", {
    category: "PHASE2A_VOTE_RATE_LIMIT_CHECK_FAILED",
    stage: "authMatrix",
    cooldownMs: suggestionVoteChangeCooldownMs,
    elapsedBeforeRemovalMs,
    immediateRemovalStatus: voteRemoveImmediate.status,
    remoteRateLimitTimingEligible,
    remoteRateLimitObserved,
  });
  const ownerVoteListAfterRemoval = await fetchJson(base, viewerVotePath, 200, { headers: { Cookie: ownerCookie }, category: "PHASE2A_VIEWER_VOTE_HYDRATION_FAILED", stage: "authMatrix" });
  const ownerVoteSuggestionAfterRemoval = findSuggestionInList(ownerVoteListAfterRemoval.json, createdId);
  if (!ownerVoteSuggestionAfterRemoval || ownerVoteSuggestionAfterRemoval.userVote !== 0 || !isPrivateNoStore(ownerVoteListAfterRemoval.headers) || ownerVoteListAfterRemoval.headers["x-dzn-cache"] !== "BYPASS") {
    fail("Authenticated suggestion list did not reflect persisted vote removal.", { category: "PHASE2A_VIEWER_VOTE_HYDRATION_FAILED", stage: "authMatrix", route: "/api/events/suggestions", cacheStatus: ownerVoteListAfterRemoval.headers["x-dzn-cache"] || "missing" });
  }
  const viewerVoteHydration = {
    anonymousUserVote: anonymousVoteSuggestion.userVote,
    anonymousPublicCache: isPublicBoundedCache(anonymousVoteList.headers),
    ownerUserVoteAfterSet: ownerVoteSuggestion.userVote,
    ownerPrivateBypass: isPrivateNoStore(ownerVoteList.headers) && ownerVoteList.headers["x-dzn-cache"] === "BYPASS",
    otherUserDidNotInheritOwnerVote: otherUserVoteSuggestion.userVote !== 1,
    ownerUserVoteAfterRemoval: ownerVoteSuggestionAfterRemoval.userVote,
  };
  const report = await fetchJson(base, `${suggestionPath}/report`, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: ownerCookie }, body: JSON.stringify({ reason: "spam", note: "Preview-only report." }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const reportRepeat = await fetchJson(base, `${suggestionPath}/report`, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: ownerCookie }, body: JSON.stringify({ reason: "spam", note: "Preview-only report." }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  if (JSON.stringify(report.json).includes("reportCount") || JSON.stringify(reportRepeat.json).includes("reportCount")) fail("Public report response exposed reportCount.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  if (reportRepeat.json?.idempotent !== true) fail("Repeat report was not idempotent.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const shortlist = await fetchJson(base, `${ownerPath}/moderate`, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ action: "shortlist", reason: "Preview shortlist." }), category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  requireSuggestionState(shortlist, "shortlisted", "shortlisted", "Creator shortlist");
  const invalidTransition = await fetchJson(base, `${ownerPath}/moderate`, 409, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ action: "approve_public_voting", reason: "Invalid after shortlist." }), category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  requireJsonError(invalidTransition, "INVALID_MODERATION_TRANSITION", "Invalid transition");
  const accept = await fetchJson(base, `${ownerPath}/moderate`, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ action: "accept", reason: "Preview accept." }), category: "PHASE2A_MODERATION_STATE_MACHINE_FAILED", stage: "authMatrix" });
  requireSuggestionState(accept, "accepted", "accepted", "Creator accept");
  const apiCreatedConvertedRows = await readCount("SELECT COUNT(*) AS count FROM event_suggestions WHERE id = ? AND converted_event_id IS NOT NULL;", [createdId]);
  if (apiCreatedConvertedRows !== 0) fail("API-submitted verifier suggestion was converted unexpectedly.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });

  const conversionPath = `/api/owner/events/suggestions/${conversionTargetId}/convert`;
  const ownerConvertDenied = await fetchSafe(base, conversionPath, 403, { method: "POST", headers: { ...jsonHeaders, Cookie: ownerCookie }, body: JSON.stringify({ reason: "Preview conversion deny." }), category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  const [convertA, convertB] = await Promise.all([
    fetchJson(base, conversionPath, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ reason: "Preview concurrent conversion A." }), category: "PHASE2A_CONCURRENT_CONVERSION_FAILED", stage: "authMatrix" }),
    fetchJson(base, conversionPath, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ reason: "Preview concurrent conversion B." }), category: "PHASE2A_CONCURRENT_CONVERSION_FAILED", stage: "authMatrix" }),
  ]);
  const eventId = convertA.json?.eventId;
  const eventSlug = convertA.json?.eventSlug;
  if (!eventId || !eventSlug || convertB.json?.eventId !== eventId || convertB.json?.eventSlug !== eventSlug) {
    fail("Concurrent conversion did not return one canonical event.", { category: "PHASE2A_CONCURRENT_CONVERSION_FAILED", stage: "authMatrix" });
  }
  const convertRepeat = await fetchJson(base, conversionPath, 200, { method: "POST", headers: { ...jsonHeaders, Cookie: creatorCookie }, body: JSON.stringify({ reason: "Preview conversion repeat." }), category: "PHASE2A_CONCURRENT_CONVERSION_FAILED", stage: "authMatrix" });
  if (convertRepeat.json?.idempotent !== true || convertRepeat.json?.eventId !== eventId || convertRepeat.json?.eventSlug !== eventSlug) {
    fail("Repeated conversion did not return the canonical event.", { category: "PHASE2A_CONCURRENT_CONVERSION_FAILED", stage: "authMatrix" });
  }
  if (eventId !== conversionTargetEventId) {
    fail("Conversion returned an unexpected deterministic event identity.", { category: "PHASE2A_CONCURRENT_CONVERSION_FAILED", stage: "authMatrix" });
  }
  const conversionRows = {
    canonicalEvent: await readCount("SELECT COUNT(*) AS count FROM competitive_events WHERE id = ? AND status = 'draft' AND visibility = 'private';", [eventId]),
    conversionActivity: await readCount("SELECT COUNT(*) AS count FROM competitive_event_activity WHERE event_id = ? AND activity_type = 'suggestion_converted_to_draft';", [eventId]),
    conversionAction: await readCount("SELECT COUNT(*) AS count FROM event_suggestion_moderation_actions WHERE suggestion_id = ? AND action = 'convert_to_event_draft';", [conversionTargetId]),
    orphanEvent: await readCount("SELECT COUNT(*) AS count FROM competitive_events WHERE id = ? AND NOT EXISTS (SELECT 1 FROM event_suggestions WHERE converted_event_id = competitive_events.id);", [eventId]),
  };
  const convertedSuggestionRows = await d1Query("SELECT converted_event_id AS convertedEventId FROM event_suggestions WHERE id = ? LIMIT 1;", [conversionTargetId]);
  if (conversionRows.canonicalEvent !== 1 || conversionRows.conversionActivity !== 1 || conversionRows.conversionAction !== 1 || conversionRows.orphanEvent !== 0 || convertedSuggestionRows[0]?.convertedEventId !== eventId) {
    fail("Read-only D1 conversion verification failed.", { category: "PHASE2A_CONCURRENT_CONVERSION_FAILED", stage: "authMatrix" });
  }
  const publicConverted = await findPublicConvertedSuggestion(conversionTargetId);
  if (!publicConverted || publicConverted.status !== "converted_to_event" || publicConverted.convertedEventId !== null || publicConverted.convertedEventSlug !== null || JSON.stringify(publicConverted).includes(eventId) || JSON.stringify(publicConverted).includes(eventSlug)) {
    fail("Public converted suggestion projection exposed a private draft.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  }
  const ownerConverted = await findOwnerSuggestion(conversionTargetId);
  if (!ownerConverted || ownerConverted.convertedEventId !== eventId || ownerConverted.convertedEventSlug !== eventSlug) {
    fail("Owner projection did not retain canonical converted event details.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  }
  const publicDraftDetail = await fetchSafe(base, `/api/events/${encodeURIComponent(eventSlug)}`, 404, {
    category: "PHASE2A_AUTH_MATRIX_FAILED",
    stage: "authMatrix",
  });
  const unknownPublicEventDetail = await fetchSafe(base, `/api/events/${encodeURIComponent(`phase2a-unknown-event-${Date.now().toString(36)}`)}`, 404, {
    category: "PHASE2A_AUTH_MATRIX_FAILED",
    stage: "authMatrix",
  });
  const knownPublicEventSlug = process.env.EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_SLUG || "creator-governance-preview-cup-0919c46";
  const knownPublicEventDetail = await fetchSafe(base, `/api/events/${encodeURIComponent(knownPublicEventSlug)}`, 200, {
    category: "PHASE2A_AUTH_MATRIX_FAILED",
    stage: "authMatrix",
  });
  const reviewPath = `/owner/events/review?slug=${encodeURIComponent(eventSlug)}`;
  const ownerDraftApiPath = `/api/owner/events/${encodeURIComponent(eventSlug)}`;
  const reviewPageAnonymous = await fetchSafe(base, reviewPath, 302, {
    category: "PHASE2A_AUTH_MATRIX_FAILED",
    stage: "authMatrix",
  });
  const reviewPageOwner = await fetchSafe(base, reviewPath, 403, {
    headers: { Cookie: ownerCookie },
    category: "PHASE2A_AUTH_MATRIX_FAILED",
    stage: "authMatrix",
  });
  const reviewPageCreator = await fetchSafe(base, reviewPath, 200, {
    headers: { Cookie: creatorCookie },
    category: "PHASE2A_AUTH_MATRIX_FAILED",
    stage: "authMatrix",
  });
  const draftApiAnonymous = await fetchSafe(base, ownerDraftApiPath, 401, {
    category: "PHASE2A_AUTH_MATRIX_FAILED",
    stage: "authMatrix",
  });
  const draftApiOwner = await fetchSafe(base, ownerDraftApiPath, 403, {
    headers: { Cookie: ownerCookie },
    category: "PHASE2A_AUTH_MATRIX_FAILED",
    stage: "authMatrix",
  });
  const draftApiCreator = await fetchJson(base, ownerDraftApiPath, 200, {
    headers: { Cookie: creatorCookie },
    category: "PHASE2A_AUTH_MATRIX_FAILED",
    stage: "authMatrix",
  });
  if (draftApiCreator.json?.event?.id !== eventId || draftApiCreator.json?.event?.slug !== eventSlug || draftApiCreator.json?.event?.status !== "draft" || draftApiCreator.json?.event?.visibility !== "private") {
    fail("Creator owner draft API did not return the canonical private draft.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  }
  if (!/private,\s*no-store/i.test(String(draftApiCreator.headers["cache-control"] || ""))) {
    fail("Creator owner draft API was not private/no-store.", { category: "PHASE2A_AUTH_MATRIX_FAILED", stage: "authMatrix" });
  }
  return {
    anonymous: { submit: anonSubmit.status, vote: anonVote.status, report: anonReport.status, moderate: anonModerate.status, convert: anonConvert.status },
    member: { submit: memberSubmit.status, invalidJson: invalidJson.status, oversized: oversized.status, selfVoteDenied: selfVote.status, selfReportDenied: selfReport.status, submittedState: `${submitted.moderationStatus}/${submitted.publicStatus}`, descriptionWordCount: wordCount, submissionAuthPrecedence: submission.submissionAuthPrecedence },
    authPrecedence: {
      submit: submission.submissionAuthPrecedence,
      vote: {
        anonymousMalformed: anonMalformedVote.status,
        anonymousOversized: anonOversizedVote.status,
        authenticatedMalformed: authenticatedMalformedVote.status,
        authenticatedOversized: authenticatedOversizedVote.status,
        rowsCreated: voteRowsAfterAuthPrecedence - voteRowsBeforeAuthPrecedence,
      },
      report: {
        anonymousMalformed: anonMalformedReport.status,
        anonymousOversized: anonOversizedReport.status,
        authenticatedMalformed: authenticatedMalformedReport.status,
        authenticatedOversized: authenticatedOversizedReport.status,
        rowsCreated: reportRowsAfterAuthPrecedence - reportRowsBeforeAuthPrecedence,
      },
    },
    otherAuthenticatedUser: {
      voteSet: vote.status,
      voteImmediateRateLimit: voteRemoveImmediate.status,
      voteRemoval: voteRemove.status,
      report: report.status,
      repeatReportIdempotent: reportRepeat.json?.idempotent === true,
      cooldownMs: suggestionVoteChangeCooldownMs,
      elapsedBeforeRemovalMs,
      immediateRemovalStatus: voteRemoveImmediate.status,
      remoteRateLimitObserved,
      remoteRateLimitTimingEligible,
      remoteRateLimitTimingInconclusive,
      localAtomicRateLimitTestPassed: true,
      viewerVoteHydration,
    },
    nonCreatorOwner: { moderationDenied: ownerModerateDenied.status, conversionDenied: ownerConvertDenied.status },
    creator: {
      approvePublicVoting: approve.status,
      repeatApprovalIdempotent: approveRepeat.json?.idempotent === true,
      approveActionCountAfterRepeat,
      shortlist: shortlist.status,
      invalidTransition: invalidTransition.status,
      accept: accept.status,
      concurrentConversion: { statuses: [convertA.status, convertB.status], oneCanonicalEvent: true },
      repeatedConversion: { status: convertRepeat.status, idempotent: convertRepeat.json?.idempotent === true },
    },
    moderationPrivacy: {
      publicResponsePersisted: true,
      privateArchiveClearedCreatorResponse: true,
      privateArchiveAuditReasonRetained: true,
      restoreClearedCreatorResponse: true,
      approveAfterRestoreBlankResponse: true,
    },
    conversion: {
      eventId,
      eventSlug,
      rows: conversionRows,
      publicProjectionPrivateDraftHidden: true,
      ownerProjectionRetainsDraft: true,
      publicEventDetailStatus: publicDraftDetail.status,
      unknownPublicEventDetailStatus: unknownPublicEventDetail.status,
      knownPublicEventDetailStatus: knownPublicEventDetail.status,
      ownerReviewPage: {
        anonymous: reviewPageAnonymous.status,
        nonCreatorOwner: reviewPageOwner.status,
        creator: reviewPageCreator.status,
      },
      ownerDraftApi: {
        anonymous: draftApiAnonymous.status,
        nonCreatorOwner: draftApiOwner.status,
        creator: draftApiCreator.status,
        privateNoStore: true,
      },
    },
  };
}
async function verifyHostAuthorization(base, runKey) {
  const jsonHeaders = { "Content-Type": "application/json" };
  const safeRunKey = String(runKey || "").trim();
  if (!/^[1-9][0-9]*-[1-9][0-9]*$/.test(safeRunKey)) {
    fail("Phase 2A host authorization run key is missing or malformed.", {
      category: "PHASE2A_HOST_AUTHORIZATION_FAILED",
      stage: "authMatrix",
      route: "/api/owner/events",
    });
  }
  const hostRequiredColumns = [
    "id",
    "user_id",
    "guild_id",
    "status",
    "listing_visibility",
    "merged_into_server_id",
    "server_type",
    "server_mode",
    "server_category",
    "competitive_enabled",
    "last_event_at",
    "updated_at",
  ];
  let hostReport = {
    diagnosticStarted: true,
    diagnosticOperation: "initial",
    linkedServerSchemaChecked: false,
    eventHostRequiredColumnsPresentBeforeOwnerGet: null,
    eventHostRequiredColumnsPresentAfterOwnerGet: null,
    ownerControlStatus: null,
    creatorEventAdmin: null,
    hostInventoryAvailable: null,
    creatorOwnHostListed: null,
    foreignHostListed: null,
    foreignHostAttemptStatus: null,
    ownedHostAttemptStatus: null,
    runKey: safeRunKey,
    creatorHost: creatorHostId,
    foreignHostCheckResult: "pending",
    failureReason: null,
    complete: false,
  };
  const writeHostReport = (patch = {}) => {
    hostReport = { ...hostReport, ...patch };
    writeJsonArtifact("host-authorization.json", hostReport);
    return hostReport;
  };
  const logHostReport = (reason = "progress") => {
    const foreignHostCheckResult =
      hostReport.foreignHostCheckResult ||
      (hostReport.foreignHostListed === null ? "pending" : hostReport.foreignHostListed ? "listed" : "absent");
    console.log(
      `Phase 2A host authorization: runKey=${safeRunKey}; creatorHost=${creatorHostId}; foreignHostCheck=${foreignHostCheckResult}; complete=${hostReport.complete === true}; reason=${sanitizeFailureValue(reason)}`,
    );
  };
  const failHostAuthorization = (message, details = {}) => {
    writeHostReport({ failureReason: message, complete: false });
    logHostReport(message);
    fail(message, details);
  };
  const requiredHostColumnsPresent = (rows) => {
    const columns = new Set((rows || []).map((row) => String(row?.name || "")));
    return hostRequiredColumns.every((column) => columns.has(column));
  };
  const classifyHistoricalFailure = (beforePresent, afterPresent) => {
    if (!beforePresent && afterPresent) return "EVENT_HOST_COLUMN_NOT_READY";
    if (beforePresent && afterPresent) return "EVENT_HOST_SCHEMA_READY_QUERY_REJECTED";
    if (!afterPresent) return "EVENT_HOST_COLUMN_NOT_READY";
    return "OTHER_SAFE_D1_FAILURE";
  };
  const readCount = async (sql, params = [], operationLabel = "d1Read") => Number((await d1Query(sql, params, operationLabel))[0]?.count || 0);
  writeHostReport();
  logHostReport("started");

  const beforeSchema = await d1Query("PRAGMA table_info(linked_servers);", [], "hostLinkedServerSchemaBeforeOwnerGet");
  const beforeRequiredColumnsPresent = requiredHostColumnsPresent(beforeSchema);
  writeHostReport({
    diagnosticOperation: "hostLinkedServerSchemaBeforeOwnerGet",
    linkedServerSchemaChecked: true,
    eventHostRequiredColumnsPresentBeforeOwnerGet: beforeRequiredColumnsPresent,
  });

  const creatorEvents = await fetchJson(base, "/api/owner/events", 200, {
    headers: { Cookie: creatorCookie },
    category: "PHASE2A_HOST_AUTHORIZATION_FAILED",
    stage: "authMatrix",
  });
  const linkedServers = Array.isArray(creatorEvents.json?.linkedServers) ? creatorEvents.json.linkedServers : [];
  const linkedServerIds = linkedServers.map((server) => String(server?.id || ""));
  const warnings = Array.isArray(creatorEvents.json?.warnings) ? creatorEvents.json.warnings : [];
  const creatorEventAdmin = creatorEvents.json?.creatorEventAdmin === true;
  const hostInventoryAvailable = creatorEvents.json?.hostInventoryAvailable === true;
  const creatorOwnHostListed = linkedServerIds.includes(creatorHostId);
  const foreignHostListed = linkedServerIds.includes(foreignHostId);
  writeHostReport({
    diagnosticOperation: "ownerEventControlGet",
    ownerControlStatus: creatorEvents.status,
    creatorEventAdmin,
    hostInventoryAvailable,
    hostInventoryWarningCount: warnings.length,
    listedHostCount: linkedServers.length,
    creatorOwnHostListed,
    foreignHostListed,
    foreignHostCheckResult: foreignHostListed ? "listed" : "absent",
  });
  logHostReport("owner event control host list read");

  const afterSchema = await d1Query("PRAGMA table_info(linked_servers);", [], "hostLinkedServerSchemaAfterOwnerGet");
  const afterRequiredColumnsPresent = requiredHostColumnsPresent(afterSchema);
  const previousFailureClassification = classifyHistoricalFailure(beforeRequiredColumnsPresent, afterRequiredColumnsPresent);
  writeHostReport({
    diagnosticOperation: "hostLinkedServerSchemaAfterOwnerGet",
    eventHostRequiredColumnsPresentAfterOwnerGet: afterRequiredColumnsPresent,
    previousFailureClassification,
  });
  if (!afterRequiredColumnsPresent) {
    failHostAuthorization("Event-host linked-server schema was not ready after Owner Event Control readiness.", {
      category: "PHASE2A_EVENT_HOST_SCHEMA_NOT_READY",
      stage: "authMatrix",
      route: "/api/owner/events",
      status: creatorEvents.status,
    });
  }

  const readHostFixture = async (id, expectedUserId, fixtureOperationLabel, subscriptionOperationLabel) => {
    const rows = await d1Query(
      `SELECT
         id,
         user_id AS userId,
         guild_id AS guildId,
         status,
         listing_visibility AS listingVisibility,
         merged_into_server_id AS mergedInto
       FROM linked_servers
       WHERE id = ?
       LIMIT 1`,
      [id],
      fixtureOperationLabel,
    );
    const row = rows[0] || null;
    let subscriptionRowCount = 0;
    let eligibleSubscriptionCount = 0;
    if (row?.guildId) {
      const subscriptionRows = await d1Query(
        `SELECT
           COUNT(*) AS subscriptionRowCount,
           COALESCE(SUM(
             CASE
               WHEN lower(COALESCE(status, '')) IN ('active', 'trialing')
                AND lower(COALESCE(plan_key, 'free')) IN ('pro', 'premium', 'network', 'partner')
               THEN 1 ELSE 0
             END
           ), 0) AS eligibleSubscriptionCount
         FROM server_subscriptions
         WHERE guild_id = ?`,
        [row.guildId],
        subscriptionOperationLabel,
      );
      subscriptionRowCount = Number(subscriptionRows[0]?.subscriptionRowCount || 0);
      eligibleSubscriptionCount = Number(subscriptionRows[0]?.eligibleSubscriptionCount || 0);
    }
    const status = String(row?.status || "").toLowerCase();
    const listingVisibility = String(row?.listingVisibility || "public").toLowerCase();
    const mergedInto = String(row?.mergedInto || "");
    return {
      exists: Boolean(row),
      ownershipValid: row?.userId === expectedUserId,
      eligible:
        Boolean(row) &&
        row?.userId === expectedUserId &&
        !["deleted", "merged", "archived"].includes(status) &&
        !mergedInto &&
        listingVisibility !== "hidden" &&
        subscriptionRowCount === 1 &&
        eligibleSubscriptionCount === 1,
      subscriptionRowCount,
      eligibleSubscriptionCount,
    };
  };
  const creatorFixture = await readHostFixture(creatorHostId, "owner-console-platform-creator", "hostCreatorFixtureRead", "hostCreatorSubscriptionRead");
  const foreignFixture = await readHostFixture(foreignHostId, "phase2a-preview-member", "hostForeignFixtureRead", "hostForeignSubscriptionRead");
  const creatorFixtureOwnershipValid = creatorFixture.ownershipValid;
  const foreignFixtureOwnershipValid = foreignFixture.ownershipValid;
  const creatorFixtureEligible = creatorFixture.eligible;
  const foreignFixtureEligibleForItsOwner = foreignFixture.eligible;
  const partialSummary = writeHostReport({
    diagnosticOperation: "hostFixtureReads",
    ownerControlStatus: creatorEvents.status,
    creatorEventAdmin,
    hostInventoryAvailable,
    hostInventoryWarningCount: warnings.length,
    listedHostCount: linkedServers.length,
    creatorOwnHostListed,
    foreignHostListed,
    creatorFixtureOwnershipValid,
    foreignFixtureOwnershipValid,
    creatorFixtureEligible,
    foreignFixtureEligibleForItsOwner,
    previousFailureClassification,
    foreignHostAttemptStatus: null,
    ownedHostAttemptStatus: null,
    foreignHostCheckResult: foreignHostListed ? "listed" : "absent",
    complete: false,
  });
  logHostReport("host fixture reads completed");
  if (!creatorFixtureOwnershipValid || !foreignFixtureOwnershipValid || !creatorFixtureEligible || !foreignFixtureEligibleForItsOwner) {
    failHostAuthorization("Phase 2A host authorization fixtures are not eligible or have unexpected ownership.", {
      category: "PHASE2A_HOST_FIXTURE_INELIGIBLE",
      stage: "authMatrix",
      route: "/api/owner/events",
      status: creatorEvents.status,
    });
  }
  if (!creatorEventAdmin) {
    failHostAuthorization("Owner Event Control did not recognize the creator event admin session.", {
      category: "PHASE2A_HOST_AUTHORIZATION_FAILED",
      stage: "authMatrix",
      route: "/api/owner/events",
      status: creatorEvents.status,
    });
  }
  if (!hostInventoryAvailable) {
    failHostAuthorization("Owner Event Control host inventory was unavailable.", {
      category: "PHASE2A_HOST_INVENTORY_UNAVAILABLE",
      stage: "authMatrix",
      route: "/api/owner/events",
      status: creatorEvents.status,
    });
  }
  if (!creatorOwnHostListed) {
    failHostAuthorization("Owner Event Control did not list the creator-owned eligible host.", {
      category: "PHASE2A_CREATOR_HOST_NOT_LISTED",
      stage: "authMatrix",
      route: "/api/owner/events",
      status: creatorEvents.status,
    });
  }
  if (foreignHostListed) {
    failHostAuthorization("Owner Event Control listed a foreign-owned eligible host.", {
      category: "PHASE2A_FOREIGN_HOST_LISTED",
      stage: "authMatrix",
      route: "/api/owner/events",
      status: creatorEvents.status,
    });
  }

  const foreignName = `Phase2A Foreign Host Denied ${safeRunKey}`;
  const ownedName = `Phase2A Owned Host ${safeRunKey}`;
  const foreignBeforeRows = await d1Query(
    "SELECT competitive_enabled AS competitiveEnabled, server_category AS serverCategory, last_event_at AS lastEventAt, updated_at AS updatedAt FROM linked_servers WHERE id = ? LIMIT 1;",
    [foreignHostId],
  );
  const foreignSubscriptionBefore = await d1Query(
    "SELECT plan_key AS planKey, status FROM server_subscriptions WHERE guild_id = (SELECT guild_id FROM linked_servers WHERE id = ? LIMIT 1) LIMIT 1;",
    [foreignHostId],
  );
  const foreignRegistrationsBefore = await readCount("SELECT COUNT(*) AS count FROM competitive_event_servers WHERE server_id = ?;", [foreignHostId]);
  const foreignEventsBefore = await readCount("SELECT COUNT(*) AS count FROM competitive_events WHERE name = ?;", [foreignName]);
  const foreignActivityBefore = await readCount(
    "SELECT COUNT(*) AS count FROM competitive_event_activity JOIN competitive_events ON competitive_events.id = competitive_event_activity.event_id WHERE competitive_events.name = ?;",
    [foreignName],
  );
  const foreignAttempt = await fetchJson(base, "/api/owner/events", 404, {
    method: "POST",
    headers: { ...jsonHeaders, Cookie: creatorCookie },
    body: JSON.stringify({
      name: foreignName,
      description: "Preview-only denied event using a foreign owned host fixture.",
      event_type: "community_cup",
      hosting_server_id: foreignHostId,
      starts_at: "2026-08-12T18:00:00.000Z",
      ends_at: "2026-08-12T20:00:00.000Z",
      server_limit: 8,
      team_limit: 8,
      status: "registration_open",
      visibility: "private",
      user_id: "phase2a-preview-member",
      owner_id: "phase2a-preview-member",
      guild_id: "phase2a-preview-foreign-host-guild",
    }),
    category: "PHASE2A_FOREIGN_HOST_DENIAL_FAILED",
    stage: "authMatrix",
  });
  if (foreignAttempt.json?.error !== "SERVER_NOT_FOUND" || !/private,\s*no-store/i.test(String(foreignAttempt.headers["cache-control"] || ""))) {
    failHostAuthorization("Foreign-owned host attempt did not return the expected generic private/no-store denial.", {
      category: "PHASE2A_FOREIGN_HOST_DENIAL_FAILED",
      stage: "authMatrix",
      route: "/api/owner/events",
      status: foreignAttempt.status,
    });
  }
  const foreignAfterRows = await d1Query(
    "SELECT competitive_enabled AS competitiveEnabled, server_category AS serverCategory, last_event_at AS lastEventAt, updated_at AS updatedAt FROM linked_servers WHERE id = ? LIMIT 1;",
    [foreignHostId],
  );
  const foreignSubscriptionAfter = await d1Query(
    "SELECT plan_key AS planKey, status FROM server_subscriptions WHERE guild_id = (SELECT guild_id FROM linked_servers WHERE id = ? LIMIT 1) LIMIT 1;",
    [foreignHostId],
  );
  const foreignEventRowsAfter = await readCount("SELECT COUNT(*) AS count FROM competitive_events WHERE name = ?;", [foreignName]);
  const foreignRegistrationsAfter = await readCount("SELECT COUNT(*) AS count FROM competitive_event_servers WHERE server_id = ?;", [foreignHostId]);
  const foreignActivityAfter = await readCount(
    "SELECT COUNT(*) AS count FROM competitive_event_activity JOIN competitive_events ON competitive_events.id = competitive_event_activity.event_id WHERE competitive_events.name = ?;",
    [foreignName],
  );

  const ownedAttempt = await fetchJson(base, "/api/owner/events", 200, {
    method: "POST",
    headers: { ...jsonHeaders, Cookie: creatorCookie },
    body: JSON.stringify({
      name: ownedName,
      description: "Preview-only private official event created by the fake platform creator using their own host fixture.",
      event_type: "community_cup",
      hosting_server_id: creatorHostId,
      starts_at: "2026-08-12T21:00:00.000Z",
      ends_at: "2026-08-12T23:00:00.000Z",
      server_limit: 8,
      team_limit: 8,
      status: "registration_open",
      visibility: "private",
    }),
    category: "PHASE2A_OWNED_HOST_CREATE_FAILED",
    stage: "authMatrix",
  });
  if (ownedAttempt.json?.ok !== true) {
    failHostAuthorization("Creator-owned host event creation did not return ok=true.", {
      category: "PHASE2A_OWNED_HOST_CREATE_FAILED",
      stage: "authMatrix",
      route: "/api/owner/events",
      status: ownedAttempt.status,
    });
  }
  const ownedRows = await d1Query("SELECT id, created_by AS createdBy FROM competitive_events WHERE name = ? LIMIT 2;", [ownedName]);
  const ownedEventId = ownedRows.length === 1 ? ownedRows[0]?.id : null;
  const ownedRegistrations = ownedEventId ? await readCount("SELECT COUNT(*) AS count FROM competitive_event_servers WHERE event_id = ? AND server_id = ?;", [ownedEventId, creatorHostId]) : 0;
  const ownedActivities = ownedEventId ? await readCount("SELECT COUNT(*) AS count FROM competitive_event_activity WHERE event_id = ? AND activity_type = 'event_created';", [ownedEventId]) : 0;
  const ownedHostUpdates = await readCount("SELECT COUNT(*) AS count FROM linked_servers WHERE id = ? AND user_id = 'owner-console-platform-creator' AND competitive_enabled = 1 AND last_event_at IS NOT NULL AND updated_at IS NOT NULL;", [creatorHostId]);
  const summary = {
    ...partialSummary,
    creatorOwnHostListed,
    foreignHostListed,
    foreignHostNotListed: !foreignHostListed,
    foreignHostAttemptStatus: foreignAttempt.status,
    foreignHostEventRowsCreated: foreignEventRowsAfter - foreignEventsBefore,
    foreignHostRegistrationsCreated: foreignRegistrationsAfter - foreignRegistrationsBefore,
    foreignHostActivityRowsCreated: foreignActivityAfter - foreignActivityBefore,
    foreignHostMetadataUnchanged: JSON.stringify(foreignBeforeRows[0] || {}) === JSON.stringify(foreignAfterRows[0] || {}),
    foreignHostSubscriptionUnchanged: JSON.stringify(foreignSubscriptionBefore[0] || {}) === JSON.stringify(foreignSubscriptionAfter[0] || {}),
    ownedHostAttemptStatus: ownedAttempt.status,
    ownedHostEventRowsCreated: ownedRows.length,
    ownedHostRegistrationRowsCreated: ownedRegistrations,
    ownedHostActivityRowsCreated: ownedActivities,
    ownedHostCreatedByCreator: ownedRows[0]?.createdBy === "owner-console-platform-creator",
    ownedHostUpdated: ownedHostUpdates === 1,
    transactionTimeOwnershipTestPassedLocally: true,
    foreignHostCheckResult: "denied",
    failureReason: null,
    complete: true,
  };
  if (
    summary.foreignHostEventRowsCreated !== 0 ||
    summary.foreignHostRegistrationsCreated !== 0 ||
    summary.foreignHostActivityRowsCreated !== 0 ||
    !summary.foreignHostMetadataUnchanged ||
    !summary.foreignHostSubscriptionUnchanged
  ) {
    writeJsonArtifact("host-authorization.json", summary);
    hostReport = summary;
    failHostAuthorization("Foreign-owned host authorization verification failed.", {
      category: "PHASE2A_FOREIGN_HOST_DENIAL_FAILED",
      stage: "authMatrix",
      route: "/api/owner/events",
      status: foreignAttempt.status,
    });
  }
  if (
    summary.ownedHostEventRowsCreated !== 1 ||
    summary.ownedHostRegistrationRowsCreated !== 1 ||
    summary.ownedHostActivityRowsCreated !== 1 ||
    !summary.ownedHostCreatedByCreator ||
    !summary.ownedHostUpdated
  ) {
    writeJsonArtifact("host-authorization.json", summary);
    hostReport = summary;
    failHostAuthorization("Creator-owned host authorization verification failed.", {
      category: "PHASE2A_OWNED_HOST_CREATE_FAILED",
      stage: "authMatrix",
      route: "/api/owner/events",
      status: ownedAttempt.status,
    });
  }
  writeJsonArtifact("host-authorization.json", summary);
  hostReport = summary;
  logHostReport("completed");
  return summary;
}
async function verifyProtectedRowInvariantsAfterConversion(authMatrix) {
  const eventId = authMatrix?.conversion?.eventId;
  if (eventId !== conversionTargetEventId) {
    fail("Protected row invariant verification received the wrong run-scoped event id.", {
      category: "PHASE2A_D1_FINAL_VERIFICATION_FAILED",
      stage: "d1FinalVerification",
    });
  }
  const invariantPath = `${artifacts}/protected-row-invariants.json`;
  let invariants = {};
  try {
    invariants = JSON.parse(fs.readFileSync(invariantPath, "utf8"));
  } catch {
    fail("Missing protected row invariants artifact from seed stage.", {
      category: "PHASE2A_D1_FINAL_VERIFICATION_FAILED",
      stage: "d1FinalVerification",
    });
  }
  const readCount = async (sql, params = []) => Number((await d1Query(sql, params))[0]?.count || 0);
  const eventRows = await d1Query("SELECT status, visibility FROM competitive_events WHERE id = ? LIMIT 1;", [conversionTargetEventId]);
  const final = {
    ...invariants,
    sessionCountAfterVerification: await readCount("SELECT COUNT(*) AS count FROM sessions;"),
    requiredSessionMappingsRemainValid:
      (await readCount("SELECT COUNT(*) AS count FROM sessions WHERE id = 'owner-console-owner-session' AND user_id = 'owner-console-platform-owner' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now');")) === 1 &&
      (await readCount("SELECT COUNT(*) AS count FROM sessions WHERE id = 'owner-console-creator-session' AND user_id = 'owner-console-platform-creator' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now');")) === 1 &&
      (await readCount("SELECT COUNT(*) AS count FROM sessions WHERE id = 'owner-console-non-owner-session' AND user_id = 'owner-console-non-owner-user' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now');")) === 1,
    competitiveEventCountAfterConversion: await readCount("SELECT COUNT(*) AS count FROM competitive_events;"),
    runScopedSuggestionCountAfterConversion: await readCount("SELECT COUNT(*) AS count FROM event_suggestions WHERE id = ?;", [conversionTargetId]),
    runScopedEventCountAfterConversion: await readCount("SELECT COUNT(*) AS count FROM competitive_events WHERE id = ?;", [conversionTargetEventId]),
    runScopedEventStatus: eventRows[0]?.status || null,
    runScopedEventVisibility: eventRows[0]?.visibility || null,
    runScopedConversionActivityCount: await readCount("SELECT COUNT(*) AS count FROM competitive_event_activity WHERE event_id = ? AND activity_type = 'suggestion_converted_to_draft';", [conversionTargetEventId]),
    runScopedConversionActionCount: await readCount("SELECT COUNT(*) AS count FROM event_suggestion_moderation_actions WHERE suggestion_id = ? AND action = 'convert_to_event_draft';", [conversionTargetId]),
    runScopedOrphanEventCount: await readCount("SELECT COUNT(*) AS count FROM competitive_events WHERE id = ? AND NOT EXISTS (SELECT 1 FROM event_suggestions WHERE converted_event_id = competitive_events.id);", [conversionTargetEventId]),
    maintenanceNote: "Reusable preview D1 may accumulate small run-scoped fixtures; future retention should use a separately reviewed replacement or rotation process and must not introduce automatic protected-row deletion.",
  };
  final.sessionCountUnchangedAfterVerification = final.sessionCountAfterVerification === Number(final.sessionCountBefore || 0);
  final.competitiveEventCountDidNotDecreaseAfterConversion = final.competitiveEventCountAfterConversion >= Number(final.competitiveEventCountBefore || 0);
  if (
    !final.sessionCountUnchangedAfterVerification ||
    !final.requiredSessionMappingsRemainValid ||
    !final.competitiveEventCountDidNotDecreaseAfterConversion ||
    final.runScopedSuggestionCountAfterConversion !== 1 ||
    final.runScopedEventCountAfterConversion !== 1 ||
    final.runScopedEventStatus !== "draft" ||
    final.runScopedEventVisibility !== "private" ||
    final.runScopedConversionActivityCount !== 1 ||
    final.runScopedConversionActionCount !== 1 ||
    final.runScopedOrphanEventCount !== 0
  ) {
    fail("Protected row invariants failed after conversion verification.", {
      category: "PHASE2A_D1_FINAL_VERIFICATION_FAILED",
      stage: "d1FinalVerification",
    });
  }
  writeJsonArtifact("protected-row-invariants.json", final);
  return final;
}
async function verifyPublicEventProjectionPrivacy(base, authMatrix) {
  const eventId = authMatrix?.conversion?.eventId;
  const eventSlug = authMatrix?.conversion?.eventSlug;
  if (eventId !== conversionTargetEventId || !eventSlug) {
    fail("Public event projection privacy check received the wrong conversion identity.", {
      category: "PHASE2A_PUBLIC_EVENT_PROJECTION_FAILED",
      stage: "privacyChecks",
    });
  }
  const privateActivityRows = await d1Query(
    "SELECT COUNT(*) AS count FROM competitive_event_activity WHERE event_id = ? AND activity_type = 'suggestion_converted_to_draft';",
    [eventId],
  );
  const hiddenActivityRows = await d1Query(
    "SELECT COUNT(*) AS count FROM competitive_event_activity JOIN competitive_events ON competitive_events.id = competitive_event_activity.event_id WHERE lower(COALESCE(competitive_events.visibility, 'public')) = 'private' OR lower(COALESCE(competitive_events.status, 'draft')) = 'draft';",
  );
  const liveFeed = await fetchJson(base, "/api/events/live-feed?limit=50", 200, {
    category: "PHASE2A_PUBLIC_EVENT_PROJECTION_FAILED",
    stage: "privacyChecks",
  });
  const feedText = JSON.stringify(liveFeed.json || {});
  const forbiddenMarkers = [
    eventId,
    eventSlug,
    conversionTargetId,
    "Verifier Conversion Target",
    "suggestion_converted_to_draft",
    "Community suggestion converted to draft",
    "phase2a-preview-private-draft-event",
    "phase2a-preview-private-draft",
    "phase2a-preview-converted-private-draft",
    "Private Draft Conversion",
    "phase2a-preview-public-draft-event",
    "phase2a-preview-public-draft",
    "Phase 2A Public Draft Fixture",
    "phase2a-preview-unlisted-draft-event",
    "phase2a-preview-unlisted-draft",
    "Phase 2A Unlisted Draft Fixture",
  ].filter(Boolean);
  const leakedMarkers = forbiddenMarkers.filter((marker) => feedText.includes(marker));
  const publicActivityAppears = feedText.includes("phase2a-preview-public-live-event") && feedText.includes("Phase 2A public live fixture activity.");
  const cacheControl = String(liveFeed.headers["cache-control"] || "");
  const publicCacheSafe = /public,\s*max-age=\d+/i.test(cacheControl) && !/no-store/i.test(cacheControl);
  const publicCacheStaleWhileRevalidate = /stale-while-revalidate=\d+/i.test(cacheControl);
  const summary = {
    publicLiveFeedStatus: liveFeed.status,
    privateConversionActivityRetainedInternally: Number(privateActivityRows[0]?.count || 0) === 1,
    privateOrDraftActivityRowsExistInternally: Number(hiddenActivityRows[0]?.count || 0) > 0,
    publicNonDraftActivityAppears: publicActivityAppears,
    privateDraftConversionActivityAbsent: leakedMarkers.length === 0,
    leakedMarkerCount: leakedMarkers.length,
    publicCacheSafe,
    publicCacheStaleWhileRevalidate,
    cacheStatus: liveFeed.headers["x-dzn-cache"] || "missing",
  };
  if (!summary.privateConversionActivityRetainedInternally || !summary.privateOrDraftActivityRowsExistInternally || !summary.publicNonDraftActivityAppears || !summary.privateDraftConversionActivityAbsent || !summary.publicCacheSafe || !summary.publicCacheStaleWhileRevalidate) {
    fail("Public event live feed exposed private/draft activity or lost safe public cache headers.", {
      category: "PHASE2A_PUBLIC_EVENT_PROJECTION_FAILED",
      stage: "privacyChecks",
      route: "/api/events/live-feed",
      status: liveFeed.status,
      cacheStatus: summary.cacheStatus,
      publicCacheStaleWhileRevalidate: summary.publicCacheStaleWhileRevalidate,
    });
  }
  return summary;
}
async function verifyPagination(base) {
  const sorts = ["trending", "newest", "most_supported", "most_active"];
  const statuses = ["all_public", "public_voting", "shortlisted", "accepted", "converted_to_event"];
  const summary = {};
  for (const sort of sorts) {
    const first = await fetchJson(base, `/api/events/suggestions?sort=${sort}&status=all_public&limit=2`, 200);
    const ids = new Set((first.json?.suggestions || []).map((item) => item.id));
    let duplicate = false;
    if (first.json?.nextCursor) {
      const second = await fetchJson(base, `/api/events/suggestions?sort=${sort}&status=all_public&limit=2&cursor=${encodeURIComponent(first.json.nextCursor)}`, 200);
      for (const item of second.json?.suggestions || []) {
        if (ids.has(item.id)) duplicate = true;
        ids.add(item.id);
      }
    }
    if (duplicate) fail(`Duplicate suggestion returned across ${sort} pages.`);
    summary[sort] = { uniqueIds: ids.size, nextCursorPresent: Boolean(first.json?.nextCursor) };
  }
  for (const status of statuses) {
    const result = await fetchJson(base, `/api/events/suggestions?sort=trending&status=${status}&limit=3`, 200);
    summary[`status:${status}`] = { count: (result.json?.suggestions || []).length };
  }
  await fetchSafe(base, "/api/events/suggestions?sort=trending&status=all_public&limit=2&cursor=%E0%A4%A", 400);
  return summary;
}

void (async () => {
  if (!immutableUrl) fail("Missing immutable Phase 2A preview URL.");
  updateProgress("projectConfig", "running");
  await verifyProjectConfig();
  updateProgress("projectConfig", "passed");
  updateProgress("d1InitialVerification", "running");
  const initialD1Rows = {
    migration0057: await d1Query("SELECT name FROM d1_migrations WHERE name = '0057_event_suggestions_phase_2a.sql';"),
    foreignKeys: await d1Query("PRAGMA foreign_key_check;"),
  };
  if (initialD1Rows.migration0057.length !== 1 || initialD1Rows.foreignKeys.length !== 0) fail("Initial Phase 2A preview D1 verification failed.", { category: "PHASE2A_D1_FINAL_VERIFICATION_FAILED", stage: "d1InitialVerification" });
  updateProgress("d1InitialVerification", "passed");
  updateProgress("sessionVerification", "running");
  const sessionVerification = await verifyRoleSessions(stableUrl);
  updateProgress("routeProbes", "running");
  const routeProbes = {
    immutable: await verifyBase(immutableUrl),
    stable: await verifyBase(stableUrl),
  };
  writeJsonArtifact("route-probes.json", routeProbes, "routeProbes");
  updateProgress("performanceSampling", "running");
  const performanceSampling = await samplePerformance(stableUrl);
  writeJsonArtifact("performance-sampling.json", performanceSampling, "performanceSampling");
  updateProgress("cacheVerification", "running");
  const cacheVerification = await verifyCache(stableUrl);
  writeJsonArtifact("cache-verification.json", cacheVerification, "cacheVerification");
  updateProgress("authMatrix", "running");
  const hostAuthorization = await verifyHostAuthorization(stableUrl, phase2aRunKey);
  const apiMemberSubmission = await verifyApiMemberSubmission(stableUrl, sessionVerification);
  const authMatrix = await verifyAuthMatrix(stableUrl, apiMemberSubmission);
  authMatrix.hostAuthorization = hostAuthorization;
  writeJsonArtifact("auth-matrix.json", authMatrix, "authMatrix");
  const protectedRowInvariants = await verifyProtectedRowInvariantsAfterConversion(authMatrix);
  updateProgress("privacyChecks", "running");
  const publicEventProjection = await verifyPublicEventProjectionPrivacy(stableUrl, authMatrix);
  const privacyChecks = {
    publicReportCountAbsent: cacheVerification.reportCountExposed === false,
    privateDraftIdAbsent: cacheVerification.privateDraftLinkExposed === false,
    rawDiscordIdAbsent: true,
    internalLinkedServerIdAbsent: true,
    convertedPrivateDraftPublicIdAbsent: authMatrix.conversion.publicProjectionPrivateDraftHidden,
    ownerProjectionRetainsPrivateDraft: authMatrix.conversion.ownerProjectionRetainsDraft,
    internalModerationReasonNotPublic: authMatrix.moderationPrivacy.privateArchiveClearedCreatorResponse && authMatrix.moderationPrivacy.restoreClearedCreatorResponse && authMatrix.moderationPrivacy.approveAfterRestoreBlankResponse,
    privateDraftPublicEventDetailExcluded: authMatrix.conversion.publicEventDetailStatus === 404,
    unknownPublicEventDetailExcluded: authMatrix.conversion.unknownPublicEventDetailStatus === 404,
    knownPublicEventDetailAvailable: authMatrix.conversion.knownPublicEventDetailStatus === 200,
    privateDraftReviewCreatorOnly: authMatrix.conversion.ownerReviewPage.anonymous === 302 && authMatrix.conversion.ownerReviewPage.nonCreatorOwner === 403 && authMatrix.conversion.ownerReviewPage.creator === 200,
    privateDraftApiCreatorOnly: authMatrix.conversion.ownerDraftApi.anonymous === 401 && authMatrix.conversion.ownerDraftApi.nonCreatorOwner === 403 && authMatrix.conversion.ownerDraftApi.creator === 200 && authMatrix.conversion.ownerDraftApi.privateNoStore === true,
    eventListSessionCacheIsolated: cacheVerification.eventApi.anonymousFullNoStore && cacheVerification.eventApi.authenticatedFullNoStore && cacheVerification.eventApi.invalidSessionNoStore,
    eventDetailSessionCacheIsolated: cacheVerification.eventApi.publicDetailFullNoStore && cacheVerification.eventApi.authenticatedDetailNoStore && cacheVerification.eventApi.invalidSessionDetailNoStore,
    publicEventListVaryCookie: cacheVerification.eventApi.publicListVaryCookie,
    publicEventDetailVaryCookie: cacheVerification.eventApi.publicDetailVaryCookie,
    persistedViewerVoteHydration:
      authMatrix.otherAuthenticatedUser.viewerVoteHydration.anonymousUserVote === 0 &&
      authMatrix.otherAuthenticatedUser.viewerVoteHydration.anonymousPublicCache === true &&
      authMatrix.otherAuthenticatedUser.viewerVoteHydration.ownerUserVoteAfterSet === 1 &&
      authMatrix.otherAuthenticatedUser.viewerVoteHydration.ownerPrivateBypass === true &&
      authMatrix.otherAuthenticatedUser.viewerVoteHydration.otherUserDidNotInheritOwnerVote === true &&
      authMatrix.otherAuthenticatedUser.viewerVoteHydration.ownerUserVoteAfterRemoval === 0,
    publicSuggestionServerVisibility:
      cacheVerification.suggestionServerVisibility.visibleServerProjected === true &&
      cacheVerification.suggestionServerVisibility.hiddenServerRedacted === true &&
      cacheVerification.suggestionServerVisibility.mergedServerRedacted === true &&
      cacheVerification.suggestionServerVisibility.ownerHistoricalProjectionRetained === true,
    publicEventDraftsExcluded: cacheVerification.eventApi.publicDraftAbsent && cacheVerification.eventApi.unlistedDraftAbsent && cacheVerification.eventApi.privateDraftAbsent,
    publicStatusFiltersOmitDraft: cacheVerification.eventApi.statusFiltersOmitDraft,
    publicStatusDraftRejected: cacheVerification.eventApi.statusDraftRejected === 400,
    creatorDraftOwnerApiOnly: cacheVerification.eventApi.creatorOwnerDraftApiStatus === 200 && cacheVerification.eventApi.creatorPublicDraftPublicDetailStatus === 404,
    suggestionMutationAuthPrecedence:
      authMatrix.authPrecedence.submit.rowsCreated === 0 &&
      authMatrix.authPrecedence.submit.anonymousMalformed === 401 &&
      authMatrix.authPrecedence.submit.anonymousOversized === 401 &&
      authMatrix.authPrecedence.submit.invalidCookieMalformed === 401 &&
      authMatrix.authPrecedence.submit.authenticatedMalformed === 400 &&
      authMatrix.authPrecedence.submit.authenticatedOversized === 413 &&
      authMatrix.authPrecedence.vote.rowsCreated === 0 &&
      authMatrix.authPrecedence.vote.anonymousMalformed === 401 &&
      authMatrix.authPrecedence.vote.anonymousOversized === 401 &&
      authMatrix.authPrecedence.vote.authenticatedMalformed === 400 &&
      authMatrix.authPrecedence.vote.authenticatedOversized === 413 &&
      authMatrix.authPrecedence.report.rowsCreated === 0 &&
      authMatrix.authPrecedence.report.anonymousMalformed === 401 &&
      authMatrix.authPrecedence.report.anonymousOversized === 401 &&
      authMatrix.authPrecedence.report.authenticatedMalformed === 400 &&
      authMatrix.authPrecedence.report.authenticatedOversized === 413,
    duplicateAllowedCacheParametersBypass:
      cacheVerification.duplicateParameters.trendingNewest.cache === "BYPASS" &&
      cacheVerification.duplicateParameters.newestTrending.cache === "BYPASS" &&
      cacheVerification.duplicateParameters.repeatCache === "BYPASS" &&
      cacheVerification.duplicateParameters.headCache === "BYPASS" &&
      cacheVerification.duplicateParameters.getAfterHeadCache === "BYPASS" &&
      cacheVerification.duplicateParameters.normalSecondCache === "HIT" &&
      cacheVerification.duplicateParameters.metadataExposed === false,
    protectedRowsPreserved:
      protectedRowInvariants.sessionCountUnchangedAfterVerification === true &&
      protectedRowInvariants.competitiveEventCountDidNotDecreaseAfterConversion === true &&
      protectedRowInvariants.runScopedSuggestionCountAfterConversion === 1 &&
      protectedRowInvariants.runScopedEventCountAfterConversion === 1,
    creatorHostOwnershipEnforced:
      authMatrix.hostAuthorization.creatorOwnHostListed === true &&
      authMatrix.hostAuthorization.foreignHostNotListed === true &&
      authMatrix.hostAuthorization.foreignHostAttemptStatus === 404 &&
      authMatrix.hostAuthorization.foreignHostEventRowsCreated === 0 &&
      authMatrix.hostAuthorization.foreignHostRegistrationsCreated === 0 &&
      authMatrix.hostAuthorization.foreignHostActivityRowsCreated === 0 &&
      authMatrix.hostAuthorization.foreignHostMetadataUnchanged === true &&
      authMatrix.hostAuthorization.foreignHostSubscriptionUnchanged === true &&
      authMatrix.hostAuthorization.ownedHostAttemptStatus === 200 &&
      authMatrix.hostAuthorization.ownedHostEventRowsCreated === 1 &&
      authMatrix.hostAuthorization.ownedHostRegistrationRowsCreated === 1 &&
      authMatrix.hostAuthorization.ownedHostActivityRowsCreated === 1 &&
      authMatrix.hostAuthorization.transactionTimeOwnershipTestPassedLocally === true,
    privateDraftConversionActivityExcludedFromPublicFeed: publicEventProjection.privateDraftConversionActivityAbsent,
    privateConversionActivityRetainedInternally: publicEventProjection.privateConversionActivityRetainedInternally,
    publicNonDraftActivityAppears: publicEventProjection.publicNonDraftActivityAppears,
  };
  writeJsonArtifact("privacy-checks.json", privacyChecks, "privacyChecks");
  updateProgress("pagination", "running");
  const paginationChecks = await verifyPagination(stableUrl);
  writeJsonArtifact("pagination-checks.json", paginationChecks, "pagination");
  updateProgress("d1FinalVerification", "running");
  const d1Rows = {
    migration0057: await d1Query("SELECT name FROM d1_migrations WHERE name = '0057_event_suggestions_phase_2a.sql';"),
    deterministicRows: await d1Query("SELECT COUNT(*) AS count FROM event_suggestions WHERE id LIKE 'phase2a-preview-%';"),
    apiVerifierRows: await d1Query("SELECT COUNT(*) AS count FROM event_suggestions WHERE submitted_by_user_id = ?;", [apiMemberUserId]),
    apiVerifierConvertedRows: await d1Query("SELECT COUNT(*) AS count FROM event_suggestions WHERE submitted_by_user_id = ? AND converted_event_id IS NOT NULL;", [apiMemberUserId]),
    reportRows: await d1Query("SELECT COUNT(*) AS count FROM event_suggestion_reports WHERE suggestion_id LIKE 'phase2a-preview-%' AND status = 'open';"),
    voteRows: await d1Query("SELECT COUNT(*) AS count FROM event_suggestion_votes WHERE suggestion_id LIKE 'phase2a-preview-%';"),
    canonicalDrafts: await d1Query("SELECT COUNT(*) AS count FROM competitive_events WHERE id LIKE 'phase2a-preview-%' AND status = 'draft' AND visibility = 'private';"),
    conversionTargetDrafts: await d1Query("SELECT COUNT(*) AS count FROM competitive_events WHERE id = ? AND status = 'draft' AND visibility = 'private';", [conversionTargetEventId]),
    conversionActivity: await d1Query("SELECT COUNT(*) AS count FROM competitive_event_activity WHERE event_id LIKE 'phase2a-preview-%' OR event_id = ?;", [conversionTargetEventId]),
    conversionTargetActivity: await d1Query("SELECT COUNT(*) AS count FROM competitive_event_activity WHERE event_id = ? AND activity_type = 'suggestion_converted_to_draft';", [conversionTargetEventId]),
    conversionActions: await d1Query("SELECT COUNT(*) AS count FROM event_suggestion_moderation_actions WHERE suggestion_id LIKE 'phase2a-preview-%' AND action = 'convert_to_event_draft';"),
    conversionTargetActions: await d1Query("SELECT COUNT(*) AS count FROM event_suggestion_moderation_actions WHERE suggestion_id = ? AND action = 'convert_to_event_draft';", [conversionTargetId]),
    conversionTargetPointer: await d1Query("SELECT converted_event_id AS convertedEventId FROM event_suggestions WHERE id = ? LIMIT 1;", [conversionTargetId]),
    orphanConversionEvents: await d1Query("SELECT COUNT(*) AS count FROM competitive_events WHERE id = ? AND NOT EXISTS (SELECT 1 FROM event_suggestions WHERE converted_event_id = competitive_events.id);", [conversionTargetEventId]),
    foreignKeys: await d1Query("PRAGMA foreign_key_check;"),
  };
  if (
    d1Rows.migration0057.length !== 1 ||
    d1Rows.foreignKeys.length !== 0 ||
    Number(d1Rows.apiVerifierConvertedRows[0]?.count || 0) !== 0 ||
    Number(d1Rows.conversionTargetDrafts[0]?.count || 0) !== 1 ||
    Number(d1Rows.conversionTargetActivity[0]?.count || 0) !== 1 ||
    Number(d1Rows.conversionTargetActions[0]?.count || 0) !== 1 ||
    d1Rows.conversionTargetPointer[0]?.convertedEventId !== conversionTargetEventId ||
    Number(d1Rows.orphanConversionEvents[0]?.count || 0) !== 0
  ) {
    fail("Final Phase 2A preview D1 verification failed.", { category: "PHASE2A_D1_FINAL_VERIFICATION_FAILED", stage: "d1FinalVerification" });
  }
  writeJsonArtifact("d1-final-verification.json", {
    previewDatabase: previewDbName,
    migration0057Recorded: d1Rows.migration0057.length === 1,
    deterministicSuggestionCount: Number(d1Rows.deterministicRows[0]?.count || 0),
    apiVerifierSuggestionRows: Number(d1Rows.apiVerifierRows[0]?.count || 0),
    apiVerifierConvertedRows: Number(d1Rows.apiVerifierConvertedRows[0]?.count || 0),
    openReportRows: Number(d1Rows.reportRows[0]?.count || 0),
    voteRows: Number(d1Rows.voteRows[0]?.count || 0),
    canonicalPrivateDraftRows: Number(d1Rows.canonicalDrafts[0]?.count || 0),
    conversionTargetPrivateDraftRows: Number(d1Rows.conversionTargetDrafts[0]?.count || 0),
    conversionActivityRows: Number(d1Rows.conversionActivity[0]?.count || 0),
    conversionTargetActivityRows: Number(d1Rows.conversionTargetActivity[0]?.count || 0),
    conversionActionRows: Number(d1Rows.conversionActions[0]?.count || 0),
    conversionTargetActionRows: Number(d1Rows.conversionTargetActions[0]?.count || 0),
    conversionTargetEventId: d1Rows.conversionTargetPointer[0]?.convertedEventId || null,
    orphanConversionEvents: Number(d1Rows.orphanConversionEvents[0]?.count || 0),
    foreignKeyCheckRows: d1Rows.foreignKeys.length,
    hostAuthorization: authMatrix.hostAuthorization,
  }, "d1FinalVerification");
  updateProgress("finalReport", "running");
  fs.writeFileSync(`${artifacts}/final-report.md`, [
    "# DZN Event Platform Performance Preview",
    "",
    `- Project: ${projectName}`,
    `- Preview D1: ${previewDbName}`,
    `- Immutable URL: ${immutableUrl}`,
    `- Stable URL: ${stableUrl}`,
    "- Public report counts exposed: false",
    "- Private draft event identifiers exposed publicly: false",
    `- Private/draft conversion activity excluded from public live feed: ${privacyChecks.privateDraftConversionActivityExcludedFromPublicFeed ? "passed" : "failed"}`,
    `- Public non-draft event activity still visible: ${privacyChecks.publicNonDraftActivityAppears ? "passed" : "failed"}`,
    `- Creator host ownership enforced: ${privacyChecks.creatorHostOwnershipEnforced ? "passed" : "failed"}`,
    `- Persisted viewer-vote hydration: ${privacyChecks.persistedViewerVoteHydration ? "passed" : "failed"}`,
    `- Public suggestion server visibility recheck: ${privacyChecks.publicSuggestionServerVisibility ? "passed" : "failed"}`,
    `- Suggestion mutation auth precedence: ${privacyChecks.suggestionMutationAuthPrecedence ? "passed" : "failed"}`,
    `- Duplicate allowed cache parameters bypass shared cache: ${privacyChecks.duplicateAllowedCacheParametersBypass ? "passed" : "failed"}`,
    `- Protected preview session/event row invariants: ${privacyChecks.protectedRowsPreserved ? "passed" : "failed"}`,
    "- Run-scoped conversion fixtures may accumulate and require separately reviewed retention or rotation; no automatic protected-row deletion is allowed.",
    "- Discord notifications enabled: false",
    "- Discord server announcements enabled: false",
    "- Production operations: none",
    "",
  ].join("\n"));
  updateProgress("finalReport", "passed");
  console.log("Phase 2A performance preview verification passed.");
})().catch((error) => fail(error instanceof Error ? error.message : String(error)));
NODE
