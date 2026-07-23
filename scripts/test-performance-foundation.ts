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
  moderateEventSuggestion,
  normalizeSuggestionText,
  normalizeSuggestionTextCompact,
  paginateSuggestionRowsForTest,
  parsePublicSuggestionCursor,
  projectSuggestionForOwnerTest,
  projectSuggestionForPublicTest,
  validateModerationTransition,
  validateSuggestionInput,
  type SuggestionSortRow,
} from "../functions/_lib/event-suggestions";
import {
  onRequestGet as onSuggestionsRequestGet,
  onRequestHead as onSuggestionsRequestHead,
  onRequestPost as onSuggestionsRequestPost,
} from "../functions/api/events/suggestions/index";
import { shouldStartNavigationProgress } from "../components/site/navigation-progress";
import type { Env, PagesContext } from "../functions/_lib/types";

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
  await assertSuggestionHeadRoute();
  await assertBoundedJson();
  assertModerationTransitions();
  await assertModerationResponsePrivacy();
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
  assertNotIncludes(publicHeaders.get("cache-control") ?? "", "stale-while-revalidate", "browser cache policy must not expose internal stale retention");
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
    assert.equal(hit.headers.has("x-dzn-cache-meta"), false, "internal cache metadata must not be exposed publicly");
    assert.match(hit.headers.get("cache-control") ?? "", /^public, max-age=\d+$/, "HIT should expose only remaining fresh browser lifetime");
    const hitMaxAge = Number((hit.headers.get("cache-control") ?? "").match(/max-age=(\d+)/)?.[1] ?? 99);
    assert.equal(hitMaxAge <= 1, true, "HIT browser max-age must not exceed configured fresh TTL");

    const originalNow = Date.now;
    Date.now = () => originalNow() + 2_000;
    const stale = await withPublicGetEdgeCache({ request, waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "test-v1",
      buildResponse,
    });
    assert.equal(stale.headers.get("x-dzn-cache"), "STALE", "stale window should return stale response");
    assert.equal(stale.headers.get("cache-control"), "no-cache, max-age=0, must-revalidate", "STALE response should force browser revalidation");
    assert.equal(stale.headers.has("x-dzn-cache-meta"), false, "STALE must not expose internal cache metadata");
    await Promise.all(waits.splice(0));
    const refreshed = await withPublicGetEdgeCache({ request, waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "test-v1",
      buildResponse,
    });
    assert.equal(refreshed.headers.get("x-dzn-cache"), "HIT", "background refresh should update stale cache back to HIT");

    Date.now = () => originalNow() + 4_000;
    builds = 0;
    const staleA = withPublicGetEdgeCache({ request, waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "test-v1",
      buildResponse,
    });
    const staleB = withPublicGetEdgeCache({ request, waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "test-v1",
      buildResponse,
    });
    await Promise.all([staleA, staleB]);
    await Promise.all(waits.splice(0));
    assert.equal(builds, 1, "concurrent stale requests should not start repeated refreshes in one isolate");
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
    assertIncludes(cookieBypass.headers.get("cache-control") ?? "", "no-store", "Set-Cookie cache bypass must be no-store");
    const errorBypass = await withPublicGetEdgeCache({ request }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "error-v1",
      buildResponse: async () => new Response("nope", { status: 503 }),
    });
    assert.equal(errorBypass.headers.get("x-dzn-cache"), "BYPASS", "non-2xx responses must not cache");
    assertIncludes(errorBypass.headers.get("cache-control") ?? "", "no-store", "non-2xx cache bypass must be no-store");
  } finally {
    (cacheGlobal as { caches: unknown }).caches = originalCaches;
  }
}

async function assertSuggestionHeadRoute() {
  assert.equal(typeof onSuggestionsRequestHead, "function", "suggestions route must export onRequestHead");
  const fakeCache = new FakeCache();
  const cacheGlobal = globalThis as typeof globalThis & { caches?: unknown };
  const originalCaches = cacheGlobal.caches;
  (cacheGlobal as { caches: unknown }).caches = { default: fakeCache };
  const waits: Promise<unknown>[] = [];
  const env = { DB: new SuggestionRouteDb() as unknown as D1Database } as Env;
  const waitUntil = (promise: Promise<unknown>) => waits.push(promise);
  const route = "https://example.test/api/events/suggestions?sort=newest&status=all_public&limit=3";
  try {
    const coldHead = await onSuggestionsRequestHead(makeSuggestionRouteContext(new Request(route, { method: "HEAD" }), env, waitUntil));
    assert.equal(coldHead.status, 200, "cold HEAD should return 200");
    assert.equal(await coldHead.text(), "", "cold HEAD response body should be empty");
    assert.equal(coldHead.headers.get("x-dzn-cache"), "BYPASS", "cold HEAD should bypass instead of populating cache");
    assertIncludes(coldHead.headers.get("cache-control") ?? "", "no-store", "cold HEAD bypass should be no-store");
    assert.equal(fakeCache.putsForVersion("event-suggestions-v2"), 0, "cold HEAD must not call Cache.put");

    const getAfterColdHead = await onSuggestionsRequestGet(makeSuggestionRouteContext(new Request(route), env, waitUntil));
    assert.equal(getAfterColdHead.status, 200, "GET after cold HEAD should return 200");
    assert.equal(getAfterColdHead.headers.get("x-dzn-cache"), "MISS", "GET after cold HEAD should miss and populate cache");
    const getAfterColdHeadJson = JSON.parse(await getAfterColdHead.text());
    assert.equal(getAfterColdHeadJson.ok, true, "GET after cold HEAD should return full JSON");
    assert.equal((getAfterColdHeadJson.suggestions ?? []).length, 1, "GET after cold HEAD should return suggestion rows");
    await Promise.all(waits.splice(0));
    assert.equal(fakeCache.putsForVersion("event-suggestions-v2"), 1, "first GET should store a valid body");

    const cachedGet = await onSuggestionsRequestGet(makeSuggestionRouteContext(new Request(route), env, waitUntil));
    assert.equal(cachedGet.headers.get("x-dzn-cache"), "HIT", "second GET should hit cached body");
    assert.equal(JSON.parse(await cachedGet.text()).suggestions.length, 1, "cached GET should return full JSON body");

    const cachedHead = await onSuggestionsRequestHead(makeSuggestionRouteContext(new Request(route, { method: "HEAD" }), env, waitUntil));
    assert.equal(cachedHead.status, 200, "HEAD after cached GET should return 200");
    assert.equal(cachedHead.headers.get("x-dzn-cache"), "HIT", "HEAD after cached GET should report HIT");
    assert.equal(await cachedHead.text(), "", "HEAD after cached GET should return no body");
    assert.equal(fakeCache.putsForVersion("event-suggestions-v2"), 1, "cached HEAD must not replace the cached body");

    const getAfterCachedHead = await onSuggestionsRequestGet(makeSuggestionRouteContext(new Request(route), env, waitUntil));
    assert.equal(getAfterCachedHead.status, 200, "GET after cached HEAD should still return 200");
    assert.equal(getAfterCachedHead.headers.get("x-dzn-cache"), "HIT", "GET after cached HEAD should keep using the cached body");
    assert.equal(JSON.parse(await getAfterCachedHead.text()).suggestions.length, 1, "GET after cached HEAD should not receive a bodyless poisoned cache entry");

    const authHead = await onSuggestionsRequestHead(makeSuggestionRouteContext(new Request(route, { method: "HEAD", headers: { cookie: "dzn_session=test" } }), env, waitUntil));
    assert.equal(authHead.status, 200, "authenticated HEAD should still resolve the public route safely");
    assert.equal(authHead.headers.get("x-dzn-cache"), "BYPASS", "authenticated HEAD should bypass shared cache");
    assertIncludes(authHead.headers.get("cache-control") ?? "", "private, no-store", "authenticated HEAD should be private no-store");
    assert.equal(await authHead.text(), "", "authenticated HEAD should have no body");

    const malformedHead = await onSuggestionsRequestHead(makeSuggestionRouteContext(new Request(`${route}&cursor=${"x".repeat(2100)}`, { method: "HEAD" }), env, waitUntil));
    assert.equal(malformedHead.headers.get("x-dzn-cache"), "BYPASS", "malformed HEAD should bypass cache");
    assert.equal(fakeCache.putsForVersion("event-suggestions-v2"), 1, "malformed HEAD must not populate cache");

    const post = await onSuggestionsRequestPost(makeSuggestionRouteContext(new Request("https://example.test/api/events/suggestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Preview", description: "Too short" }),
    }), env, waitUntil));
    assert.equal(post.status, 401, "anonymous POST should remain protected");
    assertIncludes(post.headers.get("cache-control") ?? "", "private, no-store", "mutation responses must remain private no-store");
    assert.equal(post.headers.get("x-dzn-cache"), "BYPASS", "mutation responses must bypass public cache");
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

async function assertModerationResponsePrivacy() {
  const creator = { id: "creator-user", discord_id: "111111111111111111", username: "Creator", avatar: null };
  const envFor = (row: Partial<ReturnType<typeof moderationRow>> = {}) => ({
    DZN_PLATFORM_CREATOR_DISCORD_ID: "111111111111111111",
    DB: new ModerationPrivacyDb({ ...moderationRow(), ...row }) as unknown as D1Database,
  }) as Env & { DB: ModerationPrivacyDb };

  {
    const env = envFor({ creator_response: "Old public response" });
    const result = await moderateEventSuggestion(env, creator, "suggestion-review", {
      action: "reject",
      reason: "Internal rejection note",
      creator_response: "This internal rejection should never be public",
    });
    assert.equal(result.status, 200, "reject with internal reason should succeed");
    assert.equal(env.DB.row.creator_response, null, "reject must clear public creatorResponse");
    assert.equal(env.DB.actions[0]?.safe_reason, "Internal rejection note", "reject reason should remain in private audit row");
  }

  {
    const env = envFor({ moderation_status: "accepted", public_status: "accepted", creator_response: "Accepted public response" });
    await moderateEventSuggestion(env, creator, "suggestion-review", { action: "archive", reason: "Internal archive note" });
    assert.equal(env.DB.row.creator_response, null, "archive must clear public creatorResponse");
    assert.equal(env.DB.actions[0]?.safe_reason, "Internal archive note", "archive reason should be audit-only");
  }

  {
    const env = envFor({ moderation_status: "archived", public_status: "archived", creator_response: "Stale public response" });
    await moderateEventSuggestion(env, creator, "suggestion-review", { action: "restore", reason: "Internal restore note" });
    assert.equal(env.DB.row.creator_response, null, "restore must clear stale public creatorResponse");
    const approve = await moderateEventSuggestion(env, creator, "suggestion-review", { action: "approve_public_voting", reason: "", creator_response: "" });
    assert.equal(approve.status, 200, "approve after restore should succeed");
    assert.equal(env.DB.row.creator_response, null, "approve after restore without new public response must expose nothing");
  }

  {
    const env = envFor();
    const result = await moderateEventSuggestion(env, creator, "suggestion-review", {
      action: "request_revision",
      reason: "Creator wants a clearer plan",
      creator_response: "Please add a clearer schedule and eligibility outline before this returns to public voting.",
    });
    assert.equal(result.status, 200, "request revision with a safe public response should succeed");
    assert.equal(env.DB.row.creator_response, "Please add a clearer schedule and eligibility outline before this returns to public voting.");
    assert.equal(env.DB.actions[0]?.safe_reason, "Creator wants a clearer plan", "internal reason remains in private audit row");
  }

  {
    const env = envFor();
    const result = await moderateEventSuggestion(env, creator, "suggestion-review", {
      action: "request_revision",
      reason: "Creator wants safer wording",
      creator_response: "join discord.gg/example now",
    });
    assert.equal(result.status, 422, "unsafe public creator response should be rejected");
    assert.equal(env.DB.actions.length, 0, "unsafe public response must not create an audit row");
  }
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
  assertIncludes(helper, "creator_response = CASE", "moderation update must branch public/private creator responses");
  assertIncludes(helper, "ELSE NULL", "private moderation actions must clear creator_response");
  assertNotIncludes(helper, "SELECT * FROM event_suggestions WHERE id = ? LIMIT 1", "public/list paths should avoid broad suggestion reads");
  assert.doesNotMatch(helper, /DISCORD_BOT_TOKEN|discord\.com\/api|allowed_mentions|fetch\s*\(|runScheduled|dispatchDiscord|nitrado\.net/i, "suggestion helper must not send Discord or call automation/upstream systems");
  const publicProjection = helper.slice(helper.indexOf("function toPublicSuggestion"), helper.indexOf("function toOwnerSuggestion"));
  assertNotIncludes(publicProjection, "reportCount", "public suggestion projection must not expose report count");
  assertIncludes(helper, "PUBLIC_SUGGESTION_SELECT_COLUMNS", "public suggestion list should use a public-safe converted-event projection");
  assertIncludes(helper, "competitive_events.visibility = 'public' AND competitive_events.status != 'draft'", "private draft event links must be hidden from public projection");
  const privateDraftPublic = projectSuggestionForPublicTest({
    converted_event_id: "event-private-draft",
    converted_event_slug: "private-draft-slug",
    converted_event_status: "draft",
    converted_event_visibility: "private",
  });
  assert.equal(privateDraftPublic.convertedEventId, null, "converted private draft must not expose public event id");
  assert.equal(privateDraftPublic.convertedEventSlug, null, "converted private draft must not expose public event slug");
  const privateDraftOwner = projectSuggestionForOwnerTest({
    converted_event_id: "event-private-draft",
    converted_event_slug: "private-draft-slug",
    converted_event_status: "draft",
    converted_event_visibility: "private",
  });
  assert.equal(privateDraftOwner.convertedEventId, "event-private-draft", "owner projection should retain canonical private draft id");
  assert.equal(privateDraftOwner.convertedEventSlug, "private-draft-slug", "owner projection should retain canonical private draft slug");
  const publishedPublic = projectSuggestionForPublicTest({
    converted_event_id: "event-public",
    converted_event_slug: "public-event-slug",
    converted_event_status: "registration_open",
    converted_event_visibility: "public",
  });
  assert.equal(publishedPublic.convertedEventId, "event-public", "published public event id may be exposed");
  assert.equal(publishedPublic.convertedEventSlug, "public-event-slug", "published public event link may be exposed");

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
  assertIncludes(publicPage, "Draft under creator review");
  assertNotIncludes(publicPage, "reportCount", "public board must not expose report counts");
  assertNotIncludes(publicPage, "Most Discussed");
  assertNotIncludes(publicPage, "linked server ID");
  assertNotIncludes(publicPage, "DZN_PLATFORM_CREATOR_DISCORD_ID", "creator env key must stay server-only");

  const ownerPage = source("components/owner/owner-events-page.tsx");
  assertIncludes(ownerPage, "Suggestions overview");
  assertIncludes(ownerPage, "/api/owner/events/suggestions");
  assertIncludes(ownerPage, "Convert to draft");
  assertIncludes(ownerPage, "/owner/events/review?slug=");
  assertIncludes(ownerPage, "Review converted draft");
  assertNotIncludes(ownerPage, "`/events/${suggestion.convertedEventSlug}`", "converted draft links must not point to the public event route");
  assertIncludes(ownerPage, "Internal reason");
  assertIncludes(ownerPage, "Public response");
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

function makeSuggestionRouteContext(request: Request, env: Env, waitUntil: (promise: Promise<unknown>) => void): PagesContext {
  return {
    request,
    env,
    waitUntil,
    params: {},
    data: {},
    next: async () => new Response(null, { status: 404 }),
  };
}

class SuggestionRouteDb {
  prepare(sql: string) {
    return new SuggestionRouteStatement(sql);
  }
}

class SuggestionRouteStatement {
  private bindings: unknown[] = [];

  constructor(private readonly sql: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async all() {
    if (/PRAGMA\s+table_info\(([^)]+)\)/i.test(this.sql)) {
      const table = this.sql.match(/PRAGMA\s+table_info\(([^)]+)\)/i)?.[1] ?? "";
      return { results: (SUGGESTION_ROUTE_COLUMNS[table] ?? []).map((name, cid) => ({ cid, name, type: "TEXT", notnull: 0, dflt_value: null, pk: 0 })) };
    }
    if (this.sql.includes("FROM event_suggestions")) {
      const limit = Number(this.bindings[this.bindings.length - 1] ?? 20);
      return { results: [suggestionRouteRow()].slice(0, limit) };
    }
    return { results: [] };
  }

  async first() {
    const rows = await this.all();
    return rows.results[0] ?? null;
  }
}

const SUGGESTION_ROUTE_COLUMNS: Record<string, string[]> = {
  event_suggestions: [
    "id",
    "submitted_by_user_id",
    "title",
    "description",
    "normalized_title",
    "content_fingerprint",
    "competition_format",
    "platform",
    "moderation_status",
    "public_status",
    "converted_event_id",
    "upvote_count",
    "downvote_count",
    "report_count",
    "hot_score",
    "created_at",
    "updated_at",
  ],
  event_suggestion_votes: ["suggestion_id", "user_id", "vote_value", "created_at", "updated_at"],
  event_suggestion_reports: ["id", "suggestion_id", "reporter_user_id", "reason", "status", "created_at"],
  event_suggestion_moderation_actions: ["id", "suggestion_id", "actor_user_id", "action", "created_at"],
  event_suggestion_servers: ["suggestion_id", "linked_server_id", "relationship_type", "created_at"],
  linked_servers: ["id", "public_slug", "status"],
};

function suggestionRouteRow() {
  return {
    id: "phase2a-route-head-test",
    title: "Route HEAD Test Suggestion",
    description: "A route level suggestion row used to prove HEAD requests do not poison cached GET responses while preserving public projection privacy.",
    competition_format: "community_challenge",
    platform: "cross_platform",
    map_name: "Chernarus",
    open_to_any_server: 1,
    suggested_server_id: null,
    suggested_server_slug: null,
    suggested_server_name: null,
    suggested_date_start: null,
    suggested_date_end: null,
    structure_notes: "Route test only.",
    moderation_status: "public_voting",
    public_status: "public_voting",
    creator_decision: "approved_for_voting",
    creator_response: null,
    converted_event_id: null,
    converted_event_slug: null,
    converted_event_status: null,
    converted_event_visibility: null,
    upvote_count: 2,
    downvote_count: 0,
    report_count: 0,
    hot_score: 12,
    created_at: "2026-07-23T10:00:00.000Z",
    updated_at: "2026-07-23T10:00:00.000Z",
  };
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

function moderationRow() {
  return {
    id: "suggestion-review",
    submitted_by_user_id: "member-user",
    title: "Moderation privacy suggestion",
    description: "A moderation test suggestion with a public-safe body.",
    normalized_title: "moderation privacy suggestion",
    content_fingerprint: "moderation-privacy-fingerprint",
    competition_format: "server_vs_server",
    platform: "playstation",
    map_name: null,
    suggested_server_id: null,
    suggested_server_slug: null,
    suggested_server_name: null,
    open_to_any_server: 1,
    suggested_date_start: null,
    suggested_date_end: null,
    structure_notes: null,
    moderation_status: "pending_moderation",
    public_status: "submitted",
    creator_decision: null as string | null,
    converted_event_id: null,
    creator_response: null as string | null,
    upvote_count: 0,
    downvote_count: 0,
    report_count: 0,
    hot_score: 0,
    created_at: "2026-07-23T10:00:00.000Z",
    updated_at: "2026-07-23T10:00:00.000Z",
    published_at: null as string | null,
    moderated_at: null as string | null,
    converted_event_slug: null,
    converted_event_status: null,
    converted_event_visibility: null,
  };
}

class ModerationPrivacyDb {
  actions: Array<Record<string, unknown>> = [];

  constructor(public row: ReturnType<typeof moderationRow>) {}

  prepare(sql: string) {
    return new ModerationPrivacyStatement(this, sql);
  }

  async batch(statements: ModerationPrivacyStatement[]) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ success: true }));
  }
}

class ModerationPrivacyStatement {
  private bindings: unknown[] = [];

  constructor(private readonly db: ModerationPrivacyDb, private readonly sql: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async all() {
    if (/PRAGMA\s+table_info\(([^)]+)\)/i.test(this.sql)) {
      const table = this.sql.match(/PRAGMA\s+table_info\(([^)]+)\)/i)?.[1] ?? "";
      return { results: (SUGGESTION_ROUTE_COLUMNS[table] ?? []).map((name, cid) => ({ cid, name, type: "TEXT", notnull: 0, dflt_value: null, pk: 0 })) };
    }
    return { results: [] };
  }

  async first() {
    if (this.sql.includes("FROM event_suggestions") && this.bindings[0] === this.db.row.id) {
      return this.db.row;
    }
    return null;
  }

  async run() {
    if (this.sql.includes("UPDATE event_suggestions SET creator_response = NULL")) {
      this.db.row.creator_response = null;
      this.db.row.updated_at = "2026-07-23T10:01:00.000Z";
      return { success: true };
    }
    if (this.sql.includes("UPDATE event_suggestions") && this.sql.includes("moderation_status = ?")) {
      const publicResponseFlag = Number(this.bindings[3] ?? 0);
      const publicResponse = String(this.bindings[4] ?? "");
      this.db.row = {
        ...this.db.row,
        moderation_status: String(this.bindings[0] ?? ""),
        public_status: String(this.bindings[1] ?? ""),
        creator_decision: String(this.bindings[2] ?? ""),
        creator_response: publicResponseFlag === 1 ? (publicResponse ? publicResponse : this.db.row.creator_response) : null,
        updated_at: "2026-07-23T10:01:00.000Z",
        moderated_at: "2026-07-23T10:01:00.000Z",
      };
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO event_suggestion_moderation_actions")) {
      this.db.actions.push({
        id: this.bindings[0],
        suggestion_id: this.bindings[1],
        actor_user_id: this.bindings[2],
        action: this.bindings[3],
        previous_status: this.bindings[4],
        new_status: this.bindings[5],
        safe_reason: this.bindings[6],
      });
      return { success: true };
    }
    throw new Error(`Unexpected moderation privacy query: ${this.sql.slice(0, 120)}`);
  }
}

void main();
