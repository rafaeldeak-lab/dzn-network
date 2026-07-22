import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  canonicalPublicCacheKey,
  hasPrivateRequestSignal,
  privateNoStoreHeaders,
  publicCacheHeaders,
  withPublicGetEdgeCache,
} from "../functions/_lib/performance";
import { readBoundedJson } from "../functions/_lib/http";
import {
  computeSuggestionHotScore,
  encodePublicSuggestionCursor,
  moderateSuggestionContent,
  normalizeSuggestionText,
  normalizeSuggestionTextCompact,
  paginateSuggestionRowsForTest,
  parsePublicSuggestionCursor,
  validateModerationTransition,
  validateSuggestionInput,
  type SuggestionSortRow,
} from "../functions/_lib/event-suggestions";
import { shouldStartNavigationProgress } from "../components/site/navigation-progress";
import type { Env } from "../functions/_lib/types";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function assertIncludes(file: string, snippet: string, label = snippet) {
  assert.equal(file.includes(snippet), true, `Expected ${label}`);
}

function assertNotIncludes(file: string, snippet: string, label = snippet) {
  assert.equal(file.includes(snippet), false, `Unexpected ${label}`);
}

function assertOrder(file: string, before: string, after: string, label: string) {
  assert.equal(file.indexOf(before) >= 0, true, `${label}: missing ${before}`);
  assert.equal(file.indexOf(after) >= 0, true, `${label}: missing ${after}`);
  assert.equal(file.indexOf(before) < file.indexOf(after), true, label);
}

async function main() {
  assertBranchSafeArtifacts();
  await assertSuggestionValidation();
  assertCursorPagination();
  await assertServerSlugResolution();
  await assertCacheHelpers();
  await assertBoundedJson();
  assertModerationTransitions();
  assertSuggestionSchemaAndIndexes();
  assertSuggestionApis();
  assertLoadingUx();
  assertPublicApiSafety();
  assertDocsAndRoadmap();
  assertRoutePatchNormalization();
  assertWorkflowBoundaries();
  console.log("Performance foundation tests passed.");
}

async function assertServerSlugResolution() {
  const description = [
    "Create a fair weekend competition with creator reviewed rules, safe moderation, public voting, and a clear schedule that does not publish automatically.",
    "The event should support verified teams, allow creator oversight, include evidence requirements, and avoid any direct Discord announcement or automated scoring during the suggestion phase.",
  ].join(" ");
  const validEnv = {
    DB: new SuggestionServerLookupDb({
      id: "linked-server-1",
      public_slug: "nuketown-public",
      server_name: "Nuketown Public",
    }) as unknown as D1Database,
  } as Env;
  const valid = await validateSuggestionInput({
    title: "Nuketown Public Cup",
    description,
    competition_format: "server_vs_server",
    platform: "playstation",
    suggested_server_slug: "nuketown-public",
    open_to_any_server: false,
  }, validEnv);
  assert.equal(valid.ok, true, "public server slug should resolve to an internal server id server-side");
  if (valid.ok) {
    assert.equal(valid.value.suggestedServerId, "linked-server-1");
    assert.equal(valid.value.suggestedServerSlug, "nuketown-public");
  }

  const hiddenEnv = { DB: new SuggestionServerLookupDb(null) as unknown as D1Database } as Env;
  const hidden = await validateSuggestionInput({
    title: "Hidden Server Cup",
    description,
    competition_format: "server_vs_server",
    platform: "playstation",
    suggested_server_slug: "hidden-server",
    open_to_any_server: false,
  }, hiddenEnv);
  assert.equal(hidden.ok, false, "hidden or invalid public server slug should be rejected");
  if (!hidden.ok) assert.equal(hidden.error, "INVALID_SUGGESTED_SERVER");
}

function assertBranchSafeArtifacts() {
  for (const path of [
    "docs/performance-architecture.md",
    "docs/event-tournament-roadmap.md",
    "migrations/0057_event_suggestions_phase_2a.sql",
    "functions/_lib/performance.ts",
    "functions/_lib/event-suggestions.ts",
    "components/site/navigation-progress.tsx",
    "components/ui/loading-skeletons.tsx",
    "components/events/event-suggestions-page.tsx",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist`);
  }
}

async function assertSuggestionValidation() {
  const goodDescription = [
    "Create a fair weekend server competition where verified teams can meet in a creator-reviewed format with clear rules, public voting, moderation, server eligibility checks, evidence requirements, and a safe schedule that does not publish automatically.",
    "The idea should let players compare skill without relying on Discord display names, and it should leave final rule approval with the DZN platform creator.",
  ].join(" ");
  const valid = await validateSuggestionInput({
    title: "Weekend Creator Cup",
    description: goodDescription,
    competition_format: "server_vs_server",
    platform: "playstation",
    map_name: "Chernarus",
    open_to_any_server: true,
    suggested_date_start: "2026-09-01",
    suggested_date_end: "2026-09-03",
    structure_notes: "Round robin followed by creator-reviewed finals.",
    additional_notes: "Manual dispute review preferred.",
  });
  assert.equal(valid.ok, true, "valid suggestion input should pass");
  assert.equal(normalizeSuggestionText("K!ll   your\u200bself"), "kill yourself", "normalization should collapse leetspeak and zero-width separators");
  assert.equal(normalizeSuggestionTextCompact("k i.l-l   yourself"), "killyourself", "compact normalization should remove separators");
  assert.equal(moderateSuggestionContent("please k ! l l yourself").ok, false, "visually separated threat phrase should be blocked");
  assert.equal(moderateSuggestionContent("please k\u200bi\u200bl\u200bl yourself").ok, false, "zero-width separated phrase should be blocked");
  assert.equal(moderateSuggestionContent("<script>alert(1)</script>").ok, false, "HTML/script content should be blocked before sanitization");
  assert.equal(moderateSuggestionContent("join d i s c o r d . gg/example").ok, false, "spaced Discord invites should be blocked");
  assert.equal(moderateSuggestionContent("@everyone vote for this").ok, false, "mass mentions should be blocked");
  assert.equal(moderateSuggestionContent("contact test@example.com").ok, false, "email-like personal information should be blocked");
  assert.equal(moderateSuggestionContent("call +44 7700 900123").ok, false, "phone-like personal information should be blocked");
  assert.equal(moderateSuggestionContent("Chernarus winter server cup with Livonia qualifiers").ok, true, "normal map/server punctuation should remain usable");
  const hotWithReports = computeSuggestionHotScore({ upvotes: 10, downvotes: 2, reports: 6, createdAt: new Date().toISOString() });
  const hotWithoutReports = computeSuggestionHotScore({ upvotes: 10, downvotes: 2, reports: 0, createdAt: new Date().toISOString() });
  assert.equal(hotWithoutReports > hotWithReports, true, "report penalty should reduce trending score");
  const invalidDate = await validateSuggestionInput({
    title: "Weekend Creator Cup",
    description: goodDescription,
    competition_format: "server_vs_server",
    platform: "playstation",
    open_to_any_server: true,
    suggested_date_start: "not-a-date",
  });
  assert.equal(invalidDate.ok, false, "invalid dates should be rejected rather than converted to null");
}

function assertCursorPagination() {
  const rows: SuggestionSortRow[] = [
    { id: "s5", public_status: "public_voting", hot_score: 10, upvote_count: 5, downvote_count: 1, created_at: "2026-07-05T00:00:00.000Z" },
    { id: "s4", public_status: "public_voting", hot_score: 10, upvote_count: 5, downvote_count: 1, created_at: "2026-07-05T00:00:00.000Z" },
    { id: "s3", public_status: "shortlisted", hot_score: 8, upvote_count: 10, downvote_count: 0, created_at: "2026-07-04T00:00:00.000Z" },
    { id: "s2", public_status: "accepted", hot_score: 6, upvote_count: 7, downvote_count: 2, created_at: "2026-07-03T00:00:00.000Z" },
    { id: "s1", public_status: "converted_to_event", hot_score: 3, upvote_count: 2, downvote_count: 0, created_at: "2026-07-01T00:00:00.000Z" },
  ];
  for (const sort of ["trending", "newest", "most_supported", "most_active"] as const) {
    const first = paginateSuggestionRowsForTest(rows, { sort, statusFilter: "all_public", limit: 2 });
    assert.equal(first.ok, true, `${sort} first page should parse`);
    assert.equal(new Set(first.rows.map((row) => row.id)).size, first.rows.length, `${sort} first page must not duplicate IDs`);
    assert.equal(Boolean(first.nextCursor), true, `${sort} should return a next cursor`);
    const second = paginateSuggestionRowsForTest(rows, { sort, statusFilter: "all_public", limit: 3, cursor: first.nextCursor });
    assert.equal(second.ok, true, `${sort} second page should parse`);
    const allIds = [...first.rows, ...second.rows].map((row) => row.id);
    assert.equal(new Set(allIds).size, allIds.length, `${sort} pages must not overlap`);
    assert.equal(allIds.length, rows.length, `${sort} pagination must not skip equal-score rows`);
  }
  const cursor = encodePublicSuggestionCursor({
    version: 1,
    sort: "trending",
    statusFilter: "all_public",
    primarySortValue: 10,
    createdAt: "2026-07-05T00:00:00.000Z",
    id: "s4",
  });
  assert.equal(parsePublicSuggestionCursor(cursor, { sort: "trending", statusFilter: "all_public" }).ok, true, "valid cursor should parse");
  assert.equal(parsePublicSuggestionCursor(cursor, { sort: "newest", statusFilter: "all_public" }).ok, false, "cursor sort mismatch should fail safely");
  assert.equal(parsePublicSuggestionCursor("%E0%A4%A", { sort: "trending", statusFilter: "all_public" }).ok, false, "malformed cursor should fail safely");
}

async function assertCacheHelpers() {
  const publicHeaders = publicCacheHeaders({ maxAge: 15, staleWhileRevalidate: 45 }, "MISS");
  assertIncludes(publicHeaders.get("cache-control") ?? "", "public, max-age=15");
  assertNotIncludes(publicHeaders.get("cache-control") ?? "", "s-maxage", "public cache headers must not claim s-maxage SWR");
  assert.equal(publicHeaders.get("x-dzn-cache"), "MISS");
  const privateHeaders = privateNoStoreHeaders();
  assertIncludes(privateHeaders.get("cache-control") ?? "", "private, no-store");
  assert.equal(privateHeaders.get("x-dzn-cache"), "BYPASS");
  assert.equal(hasPrivateRequestSignal(new Request("https://example.test/api", { headers: { authorization: "Bearer secret" } })), true);
  assert.equal(hasPrivateRequestSignal(new Request("https://example.test/api", { headers: { cookie: "dzn_session=abc" } })), true);
  const cacheKey = canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?token=secret&sort=newest&limit=20"), ["sort", "limit"]);
  assertIncludes(cacheKey ?? "", "sort=newest");
  assertIncludes(cacheKey ?? "", "limit=20");
  assertNotIncludes(cacheKey ?? "", "token=secret", "cache key must ignore non-allowlisted parameters");
  assert.equal(canonicalPublicCacheKey(new Request(`https://example.test/api/events/suggestions?sort=${"x".repeat(300)}`), ["sort"]), null, "oversized cache params should bypass shared cache");

  const fakeCache = new FakeCache();
  const cacheGlobal = globalThis as typeof globalThis & { caches?: unknown };
  const originalCaches = cacheGlobal.caches;
  (cacheGlobal as { caches: unknown }).caches = { default: fakeCache };
  const waits: Promise<unknown>[] = [];
  let builds = 0;
  const buildResponse = async () => {
    builds += 1;
    return new Response(JSON.stringify({ ok: true, build: builds }), {
      headers: { "content-type": "application/json" },
    });
  };
  const request = new Request("https://example.test/api/events/suggestions?sort=trending");
  try {
    const miss = await withPublicGetEdgeCache({ request, waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "test-v1",
      buildResponse,
    });
    assert.equal(miss.headers.get("x-dzn-cache"), "MISS", "first GET should miss");
    await Promise.all(waits.splice(0));
    const hit = await withPublicGetEdgeCache({ request, waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "test-v1",
      buildResponse,
    });
    assert.equal(hit.headers.get("x-dzn-cache"), "HIT", "second GET should hit");

    const originalNow = Date.now;
    Date.now = () => originalNow() + 2_000;
    const stale = await withPublicGetEdgeCache({ request, waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "test-v1",
      buildResponse,
    });
    assert.equal(stale.headers.get("x-dzn-cache"), "STALE", "stale window should return stale response");
    await Promise.all(waits.splice(0));
    Date.now = originalNow;

    const head = await withPublicGetEdgeCache({ request: new Request(request.url, { method: "HEAD" }), waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "head-v1",
      buildResponse,
    });
    assert.equal(head.headers.get("x-dzn-cache"), "BYPASS", "HEAD without cached entry should bypass");
    assert.equal(fakeCache.putsForVersion("head-v1"), 0, "HEAD must not populate a GET cache entry");

    const privateRequest = new Request(request.url, { headers: { authorization: "Bearer token" } });
    const bypass = await withPublicGetEdgeCache({ request: privateRequest }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "private-v1",
      buildResponse,
    });
    assert.equal(bypass.headers.get("x-dzn-cache"), "BYPASS", "authenticated request should bypass");
    assertIncludes(bypass.headers.get("cache-control") ?? "", "no-store", "authenticated bypass must be no-store");

    const cookieBypass = await withPublicGetEdgeCache({ request }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "cookie-v1",
      buildResponse: async () => new Response("{}", { headers: { "set-cookie": "x=y" } }),
    });
    assert.equal(cookieBypass.headers.get("x-dzn-cache"), "BYPASS", "Set-Cookie responses must not cache");
  } finally {
    (cacheGlobal as { caches: unknown }).caches = originalCaches;
  }
}

async function assertBoundedJson() {
  const invalid = await readBoundedJson(new Request("https://example.test", { method: "POST", body: "{" }), 1024);
  assert.equal(invalid.ok, false, "invalid JSON should return safe 400");
  if (!invalid.ok) assert.equal(invalid.status, 400);
  const oversized = await readBoundedJson(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ value: "x".repeat(2000) }),
    headers: { "content-type": "application/json" },
  }), 128);
  assert.equal(oversized.ok, false, "oversized JSON should return safe 413");
  if (!oversized.ok) assert.equal(oversized.status, 413);
}

function assertModerationTransitions() {
  assert.equal(validateModerationTransition("pending_moderation", "submitted", "approve_public_voting").ok, true);
  assert.equal(validateModerationTransition("public_voting", "public_voting", "shortlist").ok, true);
  assert.equal(validateModerationTransition("shortlisted", "shortlisted", "accept").ok, true);
  assert.equal(validateModerationTransition("accepted", "accepted", "archive").ok, true);
  assert.equal(validateModerationTransition("revision_requested", "revision_requested", "restore").ok, true);
  assert.equal(validateModerationTransition("rejected", "rejected", "restore").ok, true);
  assert.equal(validateModerationTransition("archived", "archived", "restore").ok, true);
  const invalid = validateModerationTransition("submitted", "submitted", "accept");
  assert.equal(invalid.ok, false, "invalid moderation transition should return 409");
  if (!invalid.ok) assert.equal(invalid.status, 409);
  const idempotent = validateModerationTransition("accepted", "accepted", "accept");
  assert.equal(idempotent.ok, true, "same resulting state should be idempotent");
  if (idempotent.ok) assert.equal(idempotent.idempotent, true);
  const terminal = validateModerationTransition("converted_to_event", "converted_to_event", "archive");
  assert.equal(terminal.ok, false, "converted suggestions must be terminal");
}

function assertSuggestionSchemaAndIndexes() {
  const migration = source("migrations/0057_event_suggestions_phase_2a.sql");
  for (const table of [
    "event_suggestions",
    "event_suggestion_votes",
    "event_suggestion_reports",
    "event_suggestion_moderation_actions",
    "event_suggestion_servers",
  ]) {
    assertIncludes(migration, `CREATE TABLE IF NOT EXISTS ${table}`);
  }
  for (const indexName of [
    "idx_event_suggestions_moderation_created",
    "idx_event_suggestions_public_hot",
    "idx_event_suggestions_public_created",
    "idx_event_suggestions_public_supported_score",
    "idx_event_suggestions_public_active_total",
    "idx_event_suggestions_submitted_user_created",
    "idx_event_suggestions_fingerprint",
    "idx_event_suggestions_converted_event",
    "idx_event_suggestion_votes_suggestion",
    "idx_event_suggestion_votes_user",
    "idx_event_suggestion_reports_suggestion_status",
    "idx_event_suggestion_reports_user_open",
    "idx_event_suggestion_moderation_suggestion_time",
  ]) {
    assertIncludes(migration, indexName);
  }
  assertIncludes(migration, "CREATE UNIQUE INDEX IF NOT EXISTS idx_event_suggestions_fingerprint");
  assertIncludes(migration, "PRIMARY KEY (suggestion_id, user_id)", "one active vote row per user and suggestion");
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|CREATE TABLE IF NOT EXISTS player_stats/i, "migration must be additive and must not create player_stats");
}

function assertSuggestionApis() {
  const helper = source("functions/_lib/event-suggestions.ts");
  assertIncludes(helper, "validateEventSuggestionSchema");
  assertIncludes(helper, "schemaReadiness");
  assertIncludes(helper, "PRAGMA table_info");
  assertIncludes(helper, "EVENT_SUGGESTIONS_SCHEMA_NOT_READY");
  assertIncludes(helper, "pending_moderation");
  assertIncludes(helper, "public_voting");
  assertIncludes(helper, "converted_to_event");
  assertIncludes(helper, "nearDuplicateScore");
  assertIncludes(helper, "VOTE_RATE_LIMITED");
  assertIncludes(helper, "SELF_VOTE_DENIED");
  assertIncludes(helper, "SELF_REPORT_DENIED");
  assertIncludes(helper, "INSERT OR IGNORE INTO competitive_events");
  assertIncludes(helper, "deterministicSuggestionEventId");
  assertIncludes(helper, "refreshSuggestionCountersStatement");
  assertIncludes(helper, "INSERT OR IGNORE INTO event_suggestion_reports");
  assertNotIncludes(helper, "SELECT * FROM event_suggestions WHERE id = ? LIMIT 1", "public/list paths should avoid broad suggestion reads");
  assert.doesNotMatch(helper, /DISCORD_BOT_TOKEN|discord\.com\/api|allowed_mentions|fetch\s*\(|runScheduled|dispatchDiscord|nitrado\.net/i, "suggestion helper must not send Discord or call automation/upstream systems");
  const publicProjection = helper.slice(helper.indexOf("function toPublicSuggestion"), helper.indexOf("function toOwnerSuggestion"));
  assertNotIncludes(publicProjection, "reportCount", "public suggestion projection must not expose report count");

  const publicRoute = source("functions/api/events/suggestions/index.ts");
  assertIncludes(publicRoute, "withPublicGetEdgeCache");
  assertIncludes(publicRoute, "allowedParams: [\"sort\", \"status\", \"limit\", \"cursor\"]");
  assertIncludes(publicRoute, "readBoundedJson<EventSuggestionInput>(request, 12 * 1024)");
  assertIncludes(publicRoute, "privateNoStoreHeaders()");
  assert.doesNotMatch(publicRoute, /DISCORD_BOT_TOKEN|NITRADO|scheduler|cron/i);

  const voteRoute = source("functions/api/events/suggestions/[suggestionId]/vote.ts");
  assertIncludes(voteRoute, "readBoundedJson<VoteBody>(request, 1024)");
  assertIncludes(voteRoute, "privateNoStoreHeaders()");

  const reportRoute = source("functions/api/events/suggestions/[suggestionId]/report.ts");
  assertIncludes(reportRoute, "readBoundedJson<ReportBody>(request, 2 * 1024)");
  assertIncludes(reportRoute, "privateNoStoreHeaders()");
  assertNotIncludes(reportRoute, "reportCount", "public report route must not return report count");

  const ownerList = source("functions/api/owner/events/suggestions.ts");
  assertIncludes(ownerList, "requirePlatformOwner");
  assertIncludes(ownerList, "privateNoStoreHeaders()");

  for (const path of [
    "functions/api/owner/events/suggestions/[suggestionId]/moderate.ts",
    "functions/api/owner/events/suggestions/[suggestionId]/convert.ts",
  ]) {
    const route = source(path);
    const handler = route.slice(route.indexOf("export const onRequestPost"));
    assertOrder(handler, "requirePlatformCreatorEventAdmin", "readBoundedJson", `${path} must authorize creator before reading request body`);
    assertIncludes(route, "readBoundedJson");
    assertIncludes(route, "privateNoStoreHeaders()");
  }

  const publicPage = source("components/events/event-suggestions-page.tsx");
  assertIncludes(publicPage, "/api/events/suggestions");
  assertIncludes(publicPage, "/vote");
  assertIncludes(publicPage, "/report");
  assertIncludes(publicPage, "Load more");
  assertIncludes(publicPage, "Most Active");
  assertIncludes(publicPage, "suggested_server_slug");
  assertIncludes(publicPage, "Submit report");
  assertIncludes(publicPage, "pendingVotes");
  assertNotIncludes(publicPage, "reportCount", "public board must not expose report counts");
  assertNotIncludes(publicPage, "Most Discussed");
  assertNotIncludes(publicPage, "linked server ID");
  assertNotIncludes(publicPage, "DZN_PLATFORM_CREATOR_DISCORD_ID", "creator env key must stay server-only");

  const ownerPage = source("components/owner/owner-events-page.tsx");
  assertIncludes(ownerPage, "Suggestions overview");
  assertIncludes(ownerPage, "/api/owner/events/suggestions");
  assertIncludes(ownerPage, "Convert to draft");
  assertIncludes(ownerPage, "creatorEventAdmin");
  assertIncludes(ownerPage, "Reports {suggestion.reportCount}", "owner moderation may see report counts");
  assertNotIncludes(ownerPage, "DZN_PLATFORM_CREATOR_DISCORD_ID", "owner UI must not expose creator ID config");
}

function assertLoadingUx() {
  const layout = source("app/layout.tsx");
  assertIncludes(layout, "NavigationProgress");
  assertIncludes(layout, "Suspense");
  const progress = source("components/site/navigation-progress.tsx");
  assertIncludes(progress, "START_DELAY_MS = 120");
  assertIncludes(progress, "RECOVERY_TIMEOUT_MS");
  assertIncludes(progress, "shouldStartNavigationProgress");
  assertIncludes(progress, "popstate");
  assertIncludes(progress, "target.hasAttribute(\"download\")");
  assertIncludes(progress, "event.defaultPrevented");
  assertNotIncludes(progress, "capture: true", "progress bar must not start in capture phase before preventDefault");
  assertIncludes(progress, "unhandledrejection");
  assert.equal(shouldStartNavigationProgress({ href: "/events", button: 0 }, "https://dzn.test/"), true);
  assert.equal(shouldStartNavigationProgress({ href: "https://other.test/events", button: 0 }, "https://dzn.test/"), false);
  assert.equal(shouldStartNavigationProgress({ href: "/events#rules", button: 0 }, "https://dzn.test/events"), false);
  assert.equal(shouldStartNavigationProgress({ href: "/events", button: 0, ctrlKey: true }, "https://dzn.test/"), false);
  assert.equal(shouldStartNavigationProgress({ href: "/download", button: 0, download: true }, "https://dzn.test/"), false);

  const css = source("app/globals.css");
  assertIncludes(css, ".dzn-navigation-progress");
  assertIncludes(css, ".dzn-skeleton");
  assertIncludes(css, "@media (prefers-reduced-motion: reduce)");

  for (const path of [
    "app/events/loading.tsx",
    "app/events/suggest/loading.tsx",
    "app/events/[slug]/loading.tsx",
    "app/servers/loading.tsx",
    "app/leaderboards/loading.tsx",
    "app/dzn-pulse/loading.tsx",
    "app/owner/loading.tsx",
    "app/owner/events/loading.tsx",
    "app/owner/events/create/loading.tsx",
  ]) {
    assert.equal(existsSync(path), true, `${path} should provide a route skeleton`);
    assert.doesNotMatch(source(path), /spinner|Loading\.\.\./i, `${path} should not be a generic spinner-only state`);
  }
}

function assertPublicApiSafety() {
  const eventsApi = source("functions/api/events.ts");
  assertIncludes(eventsApi, "hasPrivateRequestSignal");
  assertIncludes(eventsApi, "privateNoStoreHeaders()");
  assertIncludes(eventsApi, "noStoreForErrorHeaders()");
  assertIncludes(eventsApi, "publicCacheHeaders({ maxAge: 15, staleWhileRevalidate: 45 })");

  const eventHelper = source("functions/_lib/events.ts");
  const listBlock = eventHelper.slice(eventHelper.indexOf("export async function getEventsListPayload"), eventHelper.indexOf("export async function getEventDetailPayload"));
  const detailBlock = eventHelper.slice(eventHelper.indexOf("export async function getEventDetailPayload"), eventHelper.indexOf("export async function createCompetitiveEvent"));
  assertIncludes(listBlock, "validateCompetitiveEventsReadSchema");
  assertIncludes(detailBlock, "validateCompetitiveEventsReadSchema");
  assertNotIncludes(listBlock, "ensureCompetitiveEventsSchema", "public event list must not run DDL schema repair");
  assertNotIncludes(detailBlock, "ensureCompetitiveEventsSchema", "public event detail must not run DDL schema repair");
  assertNotIncludes(listBlock, "competitive_events.*", "hot public event list should use explicit columns");
  assertNotIncludes(detailBlock, "competitive_events.*", "hot public event detail should use explicit columns");

  const pulseConfig = source("functions/api/dzn-pulse/config.ts");
  assertIncludes(pulseConfig, "hasPrivateRequestSignal");
  assertIncludes(pulseConfig, "discordNotificationsEnabled");
  assertIncludes(pulseConfig, "publicCacheHeaders");

  const serverRail = source("functions/api/public/server-rail.ts");
  assertIncludes(serverRail, "publicCacheHeaders({ maxAge: 60, staleWhileRevalidate: 300 })");

  const leaderboards = source("functions/api/public/leaderboards.ts");
  assertIncludes(leaderboards, "boundedNumberParam");
  assertIncludes(leaderboards, "Math.min(max");

  for (const path of [
    "functions/api/events/suggestions/index.ts",
    "functions/api/events/suggestions/[suggestionId]/vote.ts",
    "functions/api/events/suggestions/[suggestionId]/report.ts",
    "functions/api/owner/events/suggestions.ts",
    "functions/api/owner/events/suggestions/[suggestionId]/moderate.ts",
    "functions/api/owner/events/suggestions/[suggestionId]/convert.ts",
  ]) {
    const route = source(path);
    assert.doesNotMatch(route, /fetch\s*\(|NITRADO|\bADM\b|DISCORD_BOT_TOKEN|scheduler|cron|award/i, `${path} must not trigger upstream automation or Discord`);
  }
}

function assertDocsAndRoadmap() {
  const performanceDoc = source("docs/performance-architecture.md");
  for (const phrase of [
    "Core Web Vitals targets",
    "No public request may call Nitrado",
    "Private no-store matrix",
    "manual cache metadata",
    "Public suggestion responses never include report counts",
    "most active",
    "Remaining Risks",
    "Future Recommendations",
  ]) {
    assertIncludes(performanceDoc, phrase);
  }
  const roadmap = source("docs/event-tournament-roadmap.md");
  for (const phrase of [
    "server-vs-server competitions",
    "Stage 1: Server Enrolment Announcement",
    "represented_server_id",
    "host_server_id",
    "locked rule versions",
    "allowed_mentions: { parse: [] }",
    "report volume",
  ]) {
    assertIncludes(roadmap, phrase);
  }
}

function assertWorkflowBoundaries() {
  const autoUpdateWorkflow = source(".github/workflows/dzn-auto-update-schedulers.yml");
  assertIncludes(autoUpdateWorkflow, "workflow_dispatch");
  assert.doesNotMatch(autoUpdateWorkflow, /^\s*(push|pull_request|schedule|workflow_run|repository_dispatch):/m, "DZN Auto Update Schedulers must remain manual-only");

  if (existsSync(".github/workflows/dzn-performance-ci.yml")) {
    const ci = source(".github/workflows/dzn-performance-ci.yml");
    assertIncludes(ci, "pull_request");
    assertIncludes(ci, "workflow_dispatch");
    assertIncludes(ci, "node-version: \"24\"");
    assertIncludes(ci, "npm run test:creator-event-governance");
    assertIncludes(ci, "npm run lint");
    assert.doesNotMatch(ci, /wrangler\s+(deploy|d1|pages deploy)|CLOUDFLARE|DISCORD_BOT_TOKEN|DZN_DISCORD_NOTIFICATIONS_ENABLED=true/i, "performance CI must not deploy, migrate, or use production/Discord secrets");
  }
}

function assertRoutePatchNormalization() {
  const patcher = source("scripts/patch-pages-routes.mjs");
  assertIncludes(patcher, '"/api/*"');
  assertIncludes(patcher, '"/owner"');
  assertIncludes(patcher, '"/owner/*"');
  assertIncludes(patcher, "function normalizeRoutes");
  assertIncludes(patcher, "route.startsWith(splatPrefix(splat))");
  assertIncludes(patcher, "normalizeRoutes([...(Array.isArray(routes.include) ? routes.include : []), ...requiredIncludes])");
}

class FakeCache {
  private entries = new Map<string, Response>();
  putCalls: string[] = [];

  async match(request: Request) {
    return this.entries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response) {
    this.putCalls.push(request.url);
    this.entries.set(request.url, response.clone());
  }

  async delete(request: Request) {
    return this.entries.delete(request.url);
  }

  putsForVersion(version: string) {
    return this.putCalls.filter((url) => url.includes(`__dzn_cache_v=${encodeURIComponent(version)}`)).length;
  }
}

class SuggestionServerLookupDb {
  constructor(private readonly row: { id: string; public_slug: string; server_name: string } | null) {}

  prepare() {
    return {
      bind: () => ({
        first: async () => this.row,
      }),
    };
  }
}

void main();
