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
  resetEventSuggestionSchemaReadinessForTests,
  validateModerationTransition,
  validateEventSuggestionSchema,
  validateSuggestionInput,
  type SuggestionSortRow,
} from "../functions/_lib/event-suggestions";
import {
  getLiveEventFeedPayload,
  getServerEventsProfilePayload,
  resetCompetitiveEventsReadSchemaReadinessForTests,
  validateCompetitiveEventsReadSchema,
} from "../functions/_lib/events";
import {
  onRequestGet as onSuggestionsRequestGet,
  onRequestHead as onSuggestionsRequestHead,
  onRequestPost as onSuggestionsRequestPost,
} from "../functions/api/events/suggestions/index";
import { onRequestPost as onSuggestionReportPost } from "../functions/api/events/suggestions/[suggestionId]/report";
import { onRequestPost as onSuggestionVotePost } from "../functions/api/events/suggestions/[suggestionId]/vote";
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
  await assertSuggestionMutationAuthPrecedence();
  await assertBoundedJson();
  assertModerationTransitions();
  await assertModerationResponsePrivacy();
  await assertPublicEventProjectionPrivacy();
  await assertSchemaReadinessRecovery();
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
  const orderedParams = canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?sort=trending&status=all_public"), ["sort", "status"]);
  const reversedParams = canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?status=all_public&sort=trending"), ["sort", "status"]);
  assert.equal(orderedParams, reversedParams, "different allowed parameter-name order should produce the same cache key");
  assert.equal(canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?sort=trending&sort=newest"), ["sort"]), null, "reversed repeated sort values should bypass shared cache");
  assert.equal(canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?sort=newest&sort=trending"), ["sort"]), null, "repeated sort values in the other order should bypass shared cache");
  assert.equal(canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?sort=trending&sort=trending"), ["sort"]), null, "repeated identical sort values should bypass shared cache");
  assert.equal(canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?status=all_public&status=accepted"), ["status"]), null, "repeated status values should bypass shared cache");
  assert.equal(canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?limit=3&limit=20"), ["limit"]), null, "repeated limit values should bypass shared cache");
  assert.equal(canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?cursor=a&cursor=b"), ["cursor"]), null, "repeated cursor values should bypass shared cache");
  assert.equal(canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?sort=&sort="), ["sort"]), null, "empty repeated allowed values should bypass shared cache");
  const keyWithoutUnknown = canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?sort=trending"), ["sort"]);
  const keyWithRepeatedUnknown = canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?sort=trending&ignored=a&ignored=b"), ["sort"]);
  assert.equal(keyWithRepeatedUnknown, keyWithoutUnknown, "repeated ignored parameters should not alter the public cache key");

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

    const runDuplicateSort = async (url: string, method = "GET") => withPublicGetEdgeCache({ request: new Request(url, { method }), waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort", "status", "limit", "cursor"],
      cacheVersion: "duplicate-v1",
      buildResponse: async () => new Response(JSON.stringify({ ok: true, sort: new URL(url).searchParams.get("sort") }), {
        headers: { "content-type": "application/json" },
      }),
    });
    const matchCallsBeforeDuplicate = fakeCache.matchCalls.length;
    const putCallsBeforeDuplicate = fakeCache.putCalls.length;
    const duplicateA = await runDuplicateSort("https://example.test/api/events/suggestions?sort=trending&sort=newest&status=all_public");
    const duplicateB = await runDuplicateSort("https://example.test/api/events/suggestions?sort=newest&sort=trending&status=all_public");
    assert.equal(duplicateA.headers.get("x-dzn-cache"), "BYPASS", "duplicate allowed parameters should bypass shared cache");
    assert.equal(duplicateB.headers.get("x-dzn-cache"), "BYPASS", "reversed duplicate allowed parameters should bypass shared cache");
    assertIncludes(duplicateA.headers.get("cache-control") ?? "", "no-store", "duplicate allowed parameter bypass must be no-store");
    assertIncludes(duplicateB.headers.get("cache-control") ?? "", "no-store", "reversed duplicate allowed parameter bypass must be no-store");
    assert.equal(duplicateA.headers.has("x-dzn-cache-meta"), false, "duplicate bypass must not expose internal cache metadata");
    assert.equal(duplicateB.headers.has("x-dzn-cache-meta"), false, "reversed duplicate bypass must not expose internal cache metadata");
    assert.equal(JSON.parse(await duplicateA.text()).sort, "trending", "duplicate request should keep first-value route semantics");
    assert.equal(JSON.parse(await duplicateB.text()).sort, "newest", "reversed duplicate request should keep its own first-value route semantics");
    assert.equal(fakeCache.matchCalls.length, matchCallsBeforeDuplicate, "duplicate allowed parameters must not call Cache.match");
    assert.equal(fakeCache.putCalls.length, putCallsBeforeDuplicate, "duplicate allowed parameters must not call Cache.put");
    const duplicateHead = await runDuplicateSort("https://example.test/api/events/suggestions?sort=trending&sort=newest&status=all_public", "HEAD");
    assert.equal(duplicateHead.headers.get("x-dzn-cache"), "BYPASS", "HEAD with duplicate allowed parameters should bypass shared cache");
    assert.equal(await duplicateHead.text(), "", "HEAD with duplicate allowed parameters should return no body");
    assert.equal(fakeCache.matchCalls.length, matchCallsBeforeDuplicate, "duplicate HEAD must not call Cache.match");
    assert.equal(fakeCache.putCalls.length, putCallsBeforeDuplicate, "duplicate HEAD must not call Cache.put");

    const normalAfterDuplicateRequest = new Request("https://example.test/api/events/suggestions?sort=trending&status=all_public");
    const normalAfterDuplicateMiss = await withPublicGetEdgeCache({ request: normalAfterDuplicateRequest, waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort", "status", "limit", "cursor"],
      cacheVersion: "duplicate-v1",
      buildResponse: async () => new Response(JSON.stringify({ ok: true, sort: "trending" }), {
        headers: { "content-type": "application/json" },
      }),
    });
    assert.equal(normalAfterDuplicateMiss.headers.get("x-dzn-cache"), "MISS", "normal single-sort request after duplicate bypass remains cacheable");
    await Promise.all(waits.splice(0));
    const normalAfterDuplicateHit = await withPublicGetEdgeCache({ request: normalAfterDuplicateRequest, waitUntil: (promise) => waits.push(promise) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort", "status", "limit", "cursor"],
      cacheVersion: "duplicate-v1",
      buildResponse: async () => new Response(JSON.stringify({ ok: true, sort: "trending" }), {
        headers: { "content-type": "application/json" },
      }),
    });
    assert.equal(normalAfterDuplicateHit.headers.get("x-dzn-cache"), "HIT", "normal single-sort request should hit after duplicate bypasses");
    const authenticatedDuplicate = await withPublicGetEdgeCache({ request: new Request("https://example.test/api/events/suggestions?sort=trending&sort=newest", { headers: { cookie: "dzn_session=test" } }) }, {
      ttl: { maxAge: 1, staleWhileRevalidate: 5 },
      allowedParams: ["sort"],
      cacheVersion: "duplicate-private-v1",
      buildResponse,
    });
    assert.equal(authenticatedDuplicate.headers.get("x-dzn-cache"), "BYPASS", "authenticated duplicate-parameter requests remain private bypass");
    assertIncludes(authenticatedDuplicate.headers.get("cache-control") ?? "", "private, no-store", "authenticated duplicate-parameter requests must be private no-store");
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

async function assertSuggestionMutationAuthPrecedence() {
  const submitUrl = "https://example.test/api/events/suggestions";
  const voteUrl = "https://example.test/api/events/suggestions/auth-target/vote";
  const reportUrl = "https://example.test/api/events/suggestions/auth-target/report";
  const validSuggestion = validSuggestionMutationBody();
  const waits: Promise<unknown>[] = [];
  const waitUntil = (promise: Promise<unknown>) => waits.push(promise);

  const assertUnauthorizedResponse = async (response: Response, label: string) => {
    assert.equal(response.status, 401, `${label} should return 401 before body parsing`);
    assertIncludes(response.headers.get("cache-control") ?? "", "private, no-store", `${label} 401 must be private no-store`);
    assert.equal(response.headers.get("x-dzn-cache"), "BYPASS", `${label} 401 must bypass public cache`);
    assertIncludes(response.headers.get("vary") ?? "", "Cookie", `${label} 401 must vary on Cookie`);
    const text = await response.text();
    assertNotIncludes(text, "session", `${label} 401 body must not expose session details`);
  };

  const anonymousSubmitDb = new SuggestionMutationAuthDb(false);
  const anonymousSubmit = new Request(submitUrl, { method: "POST", headers: { "content-type": "application/json" }, body: validSuggestion });
  await assertUnauthorizedResponse(await onSuggestionsRequestPost(makeSuggestionRouteContext(anonymousSubmit, mutationAuthEnv(anonymousSubmitDb), waitUntil)), "anonymous valid submit");
  assert.equal(anonymousSubmit.bodyUsed, false, "anonymous valid submit must not consume the request body");
  assert.equal(anonymousSubmitDb.schemaQueries, 0, "anonymous submit must not query suggestion mutation schema");
  assert.equal(anonymousSubmitDb.suggestionRowsCreated, 0, "anonymous submit must not create suggestion rows");

  const anonymousMalformedSubmit = new Request(submitUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{not-json" });
  await assertUnauthorizedResponse(await onSuggestionsRequestPost(makeSuggestionRouteContext(anonymousMalformedSubmit, mutationAuthEnv(new SuggestionMutationAuthDb(false)), waitUntil)), "anonymous malformed submit");
  assert.equal(anonymousMalformedSubmit.bodyUsed, false, "anonymous malformed submit must not consume the request body");

  const anonymousOversizedSubmit = new Request(submitUrl, { method: "POST", headers: { "content-type": "application/json" }, body: oversizedJsonBody(13 * 1024) });
  await assertUnauthorizedResponse(await onSuggestionsRequestPost(makeSuggestionRouteContext(anonymousOversizedSubmit, mutationAuthEnv(new SuggestionMutationAuthDb(false)), waitUntil)), "anonymous oversized submit");
  assert.equal(anonymousOversizedSubmit.bodyUsed, false, "anonymous oversized submit must not consume the request body");

  const invalidCookieSubmitDb = new SuggestionMutationAuthDb(false);
  const invalidCookieSubmit = new Request(submitUrl, { method: "POST", headers: { "content-type": "application/json", cookie: "dzn_session=expired" }, body: "{not-json" });
  await assertUnauthorizedResponse(await onSuggestionsRequestPost(makeSuggestionRouteContext(invalidCookieSubmit, mutationAuthEnv(invalidCookieSubmitDb), waitUntil)), "invalid-cookie malformed submit");
  assert.equal(invalidCookieSubmit.bodyUsed, false, "invalid-cookie malformed submit must not consume the request body");
  assert.equal(invalidCookieSubmitDb.sessionQueries, 1, "invalid-cookie submit should only query the session");
  assert.equal(invalidCookieSubmitDb.schemaQueries, 0, "invalid-cookie submit must not query suggestion mutation schema");

  const trapSubmit = unreadableJsonRequest(submitUrl);
  await assertUnauthorizedResponse(await onSuggestionsRequestPost(makeSuggestionRouteContext(trapSubmit, mutationAuthEnv(new SuggestionMutationAuthDb(false)), waitUntil)), "anonymous unreadable submit");
  assert.equal(trapSubmit.bodyUsed, false, "anonymous unreadable submit must not consume the throwing body stream");

  const authenticatedMalformedSubmit = await onSuggestionsRequestPost(makeSuggestionRouteContext(new Request(submitUrl, {
    method: "POST",
    headers: authenticatedJsonHeaders(),
    body: "{not-json",
  }), mutationAuthEnv(new SuggestionMutationAuthDb(true)), waitUntil));
  assert.equal(authenticatedMalformedSubmit.status, 400, "authenticated malformed submit should retain 400");
  const authenticatedOversizedSubmit = await onSuggestionsRequestPost(makeSuggestionRouteContext(new Request(submitUrl, {
    method: "POST",
    headers: authenticatedJsonHeaders(),
    body: oversizedJsonBody(13 * 1024),
  }), mutationAuthEnv(new SuggestionMutationAuthDb(true)), waitUntil));
  assert.equal(authenticatedOversizedSubmit.status, 413, "authenticated oversized submit should retain 413");
  const authenticatedValidSubmitDb = new SuggestionMutationAuthDb(true);
  const authenticatedValidSubmit = await onSuggestionsRequestPost(makeSuggestionRouteContext(new Request(submitUrl, {
    method: "POST",
    headers: authenticatedJsonHeaders(),
    body: validSuggestion,
  }), mutationAuthEnv(authenticatedValidSubmitDb), waitUntil));
  assert.equal(authenticatedValidSubmit.status, 200, "authenticated valid submit should retain the normal creation result");
  assert.equal(authenticatedValidSubmitDb.suggestionRowsCreated, 1, "authenticated valid submit should create exactly one suggestion row");

  await assertSuggestionMutationRouteAuthPrecedence({
    label: "vote",
    url: voteUrl,
    handler: onSuggestionVotePost,
    params: { suggestionId: "auth-target" },
    validBody: JSON.stringify({ vote_value: 1 }),
    oversizedBody: oversizedJsonBody(2 * 1024),
    createdRows: (db) => db.voteRowsCreated,
  });
  await assertSuggestionMutationRouteAuthPrecedence({
    label: "report",
    url: reportUrl,
    handler: onSuggestionReportPost,
    params: { suggestionId: "auth-target" },
    validBody: JSON.stringify({ reason: "spam", note: "Preview-only report." }),
    oversizedBody: oversizedJsonBody(3 * 1024),
    createdRows: (db) => db.reportRowsCreated,
  });
  await Promise.all(waits.splice(0));
}

async function assertSuggestionMutationRouteAuthPrecedence(options: {
  label: "vote" | "report";
  url: string;
  handler: (context: PagesContext) => Response | Promise<Response>;
  params: Record<string, string>;
  validBody: string;
  oversizedBody: string;
  createdRows: (db: SuggestionMutationAuthDb) => number;
}) {
  const waits: Promise<unknown>[] = [];
  const waitUntil = (promise: Promise<unknown>) => waits.push(promise);
  const assertUnauthorized = async (request: Request, db: SuggestionMutationAuthDb, label: string) => {
    const response = await options.handler(makeSuggestionRouteContext(request, mutationAuthEnv(db), waitUntil, options.params));
    assert.equal(response.status, 401, `${label} should return 401 before body parsing`);
    assertIncludes(response.headers.get("cache-control") ?? "", "private, no-store", `${label} 401 must be private no-store`);
    assert.equal(response.headers.get("x-dzn-cache"), "BYPASS", `${label} 401 must bypass public cache`);
    assertIncludes(response.headers.get("vary") ?? "", "Cookie", `${label} 401 must vary on Cookie`);
    assertNotIncludes(await response.text(), "session", `${label} 401 body must not expose session details`);
    assert.equal(request.bodyUsed, false, `${label} must not consume the request body`);
    assert.equal(db.schemaQueries, 0, `${label} must not query suggestion mutation schema before auth`);
    assert.equal(options.createdRows(db), 0, `${label} must not write mutation rows before auth`);
  };

  await assertUnauthorized(new Request(options.url, { method: "POST", headers: { "content-type": "application/json" }, body: options.validBody }), new SuggestionMutationAuthDb(false), `anonymous valid ${options.label}`);
  await assertUnauthorized(new Request(options.url, { method: "POST", headers: { "content-type": "application/json" }, body: "{not-json" }), new SuggestionMutationAuthDb(false), `anonymous malformed ${options.label}`);
  await assertUnauthorized(new Request(options.url, { method: "POST", headers: { "content-type": "application/json" }, body: options.oversizedBody }), new SuggestionMutationAuthDb(false), `anonymous oversized ${options.label}`);
  await assertUnauthorized(new Request(options.url, { method: "POST", headers: { "content-type": "application/json", cookie: "dzn_session=expired" }, body: "{not-json" }), new SuggestionMutationAuthDb(false), `invalid-cookie malformed ${options.label}`);
  await assertUnauthorized(unreadableJsonRequest(options.url), new SuggestionMutationAuthDb(false), `anonymous unreadable ${options.label}`);

  const malformed = await options.handler(makeSuggestionRouteContext(new Request(options.url, {
    method: "POST",
    headers: authenticatedJsonHeaders(),
    body: "{not-json",
  }), mutationAuthEnv(new SuggestionMutationAuthDb(true)), waitUntil, options.params));
  assert.equal(malformed.status, 400, `authenticated malformed ${options.label} should retain 400`);
  const oversized = await options.handler(makeSuggestionRouteContext(new Request(options.url, {
    method: "POST",
    headers: authenticatedJsonHeaders(),
    body: options.oversizedBody,
  }), mutationAuthEnv(new SuggestionMutationAuthDb(true)), waitUntil, options.params));
  assert.equal(oversized.status, 413, `authenticated oversized ${options.label} should retain 413`);
  const validDb = new SuggestionMutationAuthDb(true);
  const valid = await options.handler(makeSuggestionRouteContext(new Request(options.url, {
    method: "POST",
    headers: authenticatedJsonHeaders(),
    body: options.validBody,
  }), mutationAuthEnv(validDb), waitUntil, options.params));
  assert.equal(valid.status, 200, `authenticated valid ${options.label} should retain normal behaviour`);
  assert.equal(options.createdRows(validDb), 1, `authenticated valid ${options.label} should write exactly one mutation row`);
  await Promise.all(waits.splice(0));
}

function validSuggestionMutationBody() {
  return JSON.stringify({
    title: "Auth Precedence Preview Cup",
    description: [
      "This preview-only community challenge proposes a fair multi-server event where authenticated players represent approved connected servers, complete clearly documented objectives, and earn results only from verified activity.",
      "The platform creator reviews every rule, schedule, eligibility requirement, evidence standard, dispute process, and final outcome before publication.",
      "Nothing is announced automatically, no paid feature changes competitive scoring, and all participating servers receive equal treatment throughout the test competition.",
    ].join(" "),
    competition_format: "community_challenge",
    platform: "cross_platform",
    map_name: "Chernarus",
    open_to_any_server: true,
    structure_notes: "Preview-only structure notes.",
  });
}

function oversizedJsonBody(size: number) {
  return JSON.stringify({ value: "x".repeat(size) });
}

function authenticatedJsonHeaders() {
  return { "content-type": "application/json", cookie: "dzn_session=valid" };
}

function mutationAuthEnv(db: SuggestionMutationAuthDb): Env {
  return { DB: db as unknown as D1Database, SESSION_SECRET: "test-session-secret" } as Env;
}

function unreadableJsonRequest(url: string) {
  const body = new ReadableStream<Uint8Array>({
    pull() {
      throw new Error("request body was read before authentication");
    },
  });
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
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

async function assertPublicEventProjectionPrivacy() {
  const db = new PublicEventProjectionDb();
  const env = { DB: db as unknown as D1Database } as Env;
  resetCompetitiveEventsReadSchemaReadinessForTests(env);

  const feed = await getLiveEventFeedPayload(env, 20) as { ok: boolean; activity: Array<Record<string, unknown>> };
  assert.equal(feed.ok, true, "public live feed should return a safe response");
  const feedText = JSON.stringify(feed);
  assert.equal(feedText.includes("Public Live Cup"), true, "public live activity should appear");
  assert.equal(feedText.includes("Public Upcoming Cup"), true, "public upcoming activity should appear");
  assert.equal(feedText.includes("Unlisted Cup"), true, "unlisted non-draft activity should follow the existing public visibility contract");
  for (const privateValue of [
    "Private Live Cup",
    "public-draft-event",
    "Public Draft Cup",
    "unlisted-draft-event",
    "Unlisted Draft Cup",
    "private-conversion-event",
    "private-conversion-slug",
    "Private Conversion Target",
    "Community suggestion converted to draft",
    "private-suggestion-id",
    "orphan-activity",
  ]) {
    assert.equal(feedText.includes(privateValue), false, `public live feed must not expose ${privateValue}`);
  }
  assert.equal(db.activityRows.some((row) => row.id === "private-conversion-activity"), true, "private conversion activity must remain present internally");
  assert.equal(db.events.some((event) => event.id === "private-conversion-event" && event.status === "draft" && event.visibility === "private"), true, "private draft event must remain present internally");

  const profile = await getServerEventsProfilePayload(env, "public-server", null) as Record<string, unknown>;
  assert.equal(profile.ok, true, "public server event profile should return a safe response");
  const profileText = JSON.stringify(profile);
  assert.equal(profileText.includes("public-live-event"), true, "public non-draft server registration should appear");
  assert.equal(profileText.includes("public-match"), true, "public non-draft server match should appear");
  for (const privateValue of [
    "private-live-event",
    "Private Live Cup",
    "public-draft-event",
    "Public Draft Cup",
    "private-match",
    "draft-match",
  ]) {
    assert.equal(profileText.includes(privateValue), false, `public server profile must not expose ${privateValue}`);
  }
}

async function assertSchemaReadinessRecovery() {
  {
    const db = new RecoverableSchemaDb({ availableTables: new Set() });
    const env = { DB: db as unknown as D1Database } as Env;
    resetEventSuggestionSchemaReadinessForTests(env);
    const first = await validateEventSuggestionSchema(env, { conversion: false });
    assert.equal(first.ok, false, "missing suggestion schema should fail safely");
    assert.equal(db.probeCount("event_suggestions"), 1, "first suggestion readiness should probe once");
    db.availableTables = new Set(Object.keys(SUGGESTION_ROUTE_COLUMNS));
    const second = await validateEventSuggestionSchema(env, { conversion: false });
    assert.equal(second.ok, true, "same warm Env should retry after failed suggestion readiness");
    assert.equal(db.probeCount("event_suggestions"), 2, "failed suggestion readiness must not remain cached");
    const third = await validateEventSuggestionSchema(env, { conversion: false });
    assert.equal(third.ok, true, "successful suggestion readiness should stay cached");
    assert.equal(db.probeCount("event_suggestions"), 2, "successful suggestion readiness should not re-query PRAGMA");
  }

  {
    const db = new RecoverableSchemaDb({ availableTables: new Set(), delayMs: 10 });
    const env = { DB: db as unknown as D1Database } as Env;
    resetEventSuggestionSchemaReadinessForTests(env);
    const [first, second] = await Promise.all([
      validateEventSuggestionSchema(env, { conversion: false }),
      validateEventSuggestionSchema(env, { conversion: false }),
    ]);
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(db.probeCount("event_suggestions"), 1, "concurrent failed suggestion readiness calls should share one in-flight probe");
    db.availableTables = new Set(Object.keys(SUGGESTION_ROUTE_COLUMNS));
    const retry = await validateEventSuggestionSchema(env, { conversion: false });
    assert.equal(retry.ok, true, "next suggestion readiness call should retry after failed shared probe settles");
    assert.equal(db.probeCount("event_suggestions"), 2);
  }

  {
    const db = new RecoverableSchemaDb({ availableTables: new Set(Object.keys(SUGGESTION_ROUTE_COLUMNS)), throwOnPragma: true });
    const env = { DB: db as unknown as D1Database } as Env;
    resetEventSuggestionSchemaReadinessForTests(env);
    const thrown = await validateEventSuggestionSchema(env, { conversion: false });
    assert.equal(thrown.ok, false, "thrown suggestion readiness errors should become safe failures");
    db.throwOnPragma = false;
    const retry = await validateEventSuggestionSchema(env, { conversion: false });
    assert.equal(retry.ok, true, "thrown suggestion readiness errors must not stay pinned");
  }

  {
    const suggestionTables = new Set(Object.keys(SUGGESTION_ROUTE_COLUMNS).filter((table) => !["competitive_events", "competitive_event_activity"].includes(table)));
    const db = new RecoverableSchemaDb({ availableTables: suggestionTables });
    const env = { DB: db as unknown as D1Database } as Env;
    resetEventSuggestionSchemaReadinessForTests(env);
    const suggestionsOnly = await validateEventSuggestionSchema(env, { conversion: false });
    assert.equal(suggestionsOnly.ok, true, "suggestions readiness key should succeed independently");
    const fullMissing = await validateEventSuggestionSchema(env);
    assert.equal(fullMissing.ok, false, "full readiness key should fail while conversion tables are missing");
    const suggestionProbeCount = db.probeCount("event_suggestions");
    db.availableTables = new Set([...suggestionTables, "competitive_events", "competitive_event_activity"]);
    const fullReady = await validateEventSuggestionSchema(env);
    assert.equal(fullReady.ok, true, "full readiness key should retry without erasing suggestions key");
    const suggestionsStillCached = await validateEventSuggestionSchema(env, { conversion: false });
    assert.equal(suggestionsStillCached.ok, true);
    assert.equal(db.probeCount("event_suggestions"), suggestionProbeCount + 1, "successful suggestions key should remain cached while failed full key retries");
  }

  {
    const db = new RecoverableSchemaDb({ availableTables: new Set() });
    const env = { DB: db as unknown as D1Database } as Env;
    resetCompetitiveEventsReadSchemaReadinessForTests(env);
    const first = await validateCompetitiveEventsReadSchema(env);
    assert.equal(first.ok, false, "missing public event schema should fail safely");
    assert.equal(db.probeCount("competitive_events"), 1);
    db.availableTables = new Set(Object.keys(EVENT_READ_TEST_COLUMNS));
    const second = await validateCompetitiveEventsReadSchema(env);
    assert.equal(second.ok, true, "same warm Env should retry public event readiness after schema appears");
    assert.equal(db.probeCount("competitive_events"), 2);
    const third = await validateCompetitiveEventsReadSchema(env);
    assert.equal(third.ok, true, "successful public event readiness should stay cached");
    assert.equal(db.probeCount("competitive_events"), 2);
  }

  {
    const db = new RecoverableSchemaDb({ availableTables: new Set(), delayMs: 10 });
    const env = { DB: db as unknown as D1Database } as Env;
    resetCompetitiveEventsReadSchemaReadinessForTests(env);
    const [first, second] = await Promise.all([
      validateCompetitiveEventsReadSchema(env),
      validateCompetitiveEventsReadSchema(env),
    ]);
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(db.probeCount("competitive_events"), 1, "concurrent public event readiness calls should share one in-flight probe");
    db.availableTables = new Set(Object.keys(EVENT_READ_TEST_COLUMNS));
    const retry = await validateCompetitiveEventsReadSchema(env);
    assert.equal(retry.ok, true, "public event readiness should retry after failed shared probe settles");
    assert.equal(db.probeCount("competitive_events"), 2);
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
  assertIncludes(publicRoute, "unauthorizedSuggestionMutationPayload(\"submit\")");
  assertIncludes(publicRoute, "readBoundedJson<EventSuggestionInput>(request, 12 * 1024)");
  assertIncludes(publicRoute, "privateNoStoreHeaders()");
  assertOrder(publicRoute.slice(publicRoute.indexOf("export const onRequestPost")), "if (!user)", "readBoundedJson<EventSuggestionInput>", "suggestion submission route must authenticate before reading the body");
  assert.doesNotMatch(publicRoute, /DISCORD_BOT_TOKEN|NITRADO|scheduler|cron/i);

  const voteRoute = source("functions/api/events/suggestions/[suggestionId]/vote.ts");
  assertIncludes(voteRoute, "unauthorizedSuggestionMutationPayload(\"vote\")");
  assertIncludes(voteRoute, "readBoundedJson<VoteBody>(request, 1024)");
  assertIncludes(voteRoute, "privateNoStoreHeaders()");
  assertOrder(voteRoute.slice(voteRoute.indexOf("export const onRequestPost")), "if (!user)", "readBoundedJson<VoteBody>", "suggestion vote route must authenticate before reading the body");

  const reportRoute = source("functions/api/events/suggestions/[suggestionId]/report.ts");
  assertIncludes(reportRoute, "unauthorizedSuggestionMutationPayload(\"report\")");
  assertIncludes(reportRoute, "readBoundedJson<ReportBody>(request, 2 * 1024)");
  assertIncludes(reportRoute, "privateNoStoreHeaders()");
  assertOrder(reportRoute.slice(reportRoute.indexOf("export const onRequestPost")), "if (!user)", "readBoundedJson<ReportBody>", "suggestion report route must authenticate before reading the body");
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
  assertIncludes(eventsApi, "fullRequested");
  assertIncludes(eventsApi, "withVaryToken(undefined, \"Cookie\")");
  assertIncludes(eventsApi, "privateNoStoreHeaders()");
  assertIncludes(eventsApi, "noStoreForErrorHeaders()");
  assertIncludes(eventsApi, "viewer || privateRequest || fullRequested");
  assertIncludes(eventsApi, "publicCacheHeaders({ maxAge: 15, staleWhileRevalidate: 45 }, \"MISS\", publicHeaders)");

  const eventDetailApi = source("functions/api/events/[slug].ts");
  assertIncludes(eventDetailApi, "hasPrivateRequestSignal");
  assertIncludes(eventDetailApi, "fullRequested");
  assertIncludes(eventDetailApi, "withVaryToken(undefined, \"Cookie\")");
  assertIncludes(eventDetailApi, "viewer || privateRequest || fullRequested");
  assertIncludes(eventDetailApi, "publicCacheHeaders({ maxAge: 15, staleWhileRevalidate: 45 }, \"MISS\", publicHeaders)");

  const eventHelper = source("functions/_lib/events.ts");
  const listBlock = eventHelper.slice(eventHelper.indexOf("export async function getEventsListPayload"), eventHelper.indexOf("export async function getEventDetailPayload"));
  const detailBlock = eventHelper.slice(eventHelper.indexOf("export async function getEventDetailPayload"), eventHelper.indexOf("export async function createCompetitiveEvent"));
  assertIncludes(listBlock, "validateCompetitiveEventsReadSchema");
  assertIncludes(listBlock, "resolvePublicEventStatusFilter");
  assertIncludes(listBlock, "lower(COALESCE(visibility, 'public')) != 'private'");
  assertIncludes(listBlock, "lower(COALESCE(status, 'draft')) != 'draft'");
  assertIncludes(eventHelper, "INVALID_PUBLIC_EVENT_STATUS");
  assertIncludes(eventHelper, "PUBLIC_EVENT_STATUSES.map");
  assertNotIncludes(eventHelper, "statusFilters: EVENT_STATUSES.map", "public status filters must not advertise draft");
  assertIncludes(detailBlock, "validateCompetitiveEventsReadSchema");
  assertNotIncludes(listBlock, "ensureCompetitiveEventsSchema", "public event list must not run DDL schema repair");
  assertNotIncludes(detailBlock, "ensureCompetitiveEventsSchema", "public event detail must not run DDL schema repair");
  assertNotIncludes(listBlock, "competitive_events.*", "hot public event list should use explicit columns");
  assertNotIncludes(detailBlock, "competitive_events.*", "hot public event detail should use explicit columns");
  const liveFeedBlock = eventHelper.slice(eventHelper.indexOf("export async function getLiveEventFeedPayload"), eventHelper.indexOf("export async function getServerEventsProfilePayload"));
  assertIncludes(liveFeedBlock, "fetchPublicEventActivity", "public live feed must use a public-safe activity helper");
  assertNotIncludes(liveFeedBlock, "fetchEventActivity(env, null", "public live feed must not read internal activity without event visibility filtering");
  assertIncludes(eventHelper, "JOIN competitive_events ON competitive_events.id = competitive_event_activity.event_id", "public activity must inner join events before projection");
  assertIncludes(eventHelper, "lower(COALESCE(competitive_events.visibility, 'public')) != 'private'");
  assertIncludes(eventHelper, "lower(COALESCE(competitive_events.status, 'draft')) != 'draft'");
  assertIncludes(eventHelper, "publicEventSchemaReadiness.get(key) === promise", "failed public-event readiness must use identity-safe eviction");
  assertNotIncludes(eventHelper.slice(eventHelper.indexOf("async function fetchServerRegisteredEvents"), eventHelper.indexOf("async function fetchCompatibleEvents")), "competitive_events.*", "public server registered events should use explicit event columns");
  assertNotIncludes(eventHelper.slice(eventHelper.indexOf("async function fetchCompatibleEvents"), eventHelper.indexOf("async function fetchServerMatches")), "competitive_events.*", "public compatible events should use explicit event columns");

  const suggestionHelper = source("functions/_lib/event-suggestions.ts");
  assertIncludes(suggestionHelper, "current?.get(key) === promise", "failed suggestion readiness must use identity-safe eviction");
  assertIncludes(suggestionHelper, "if (current.size === 0) schemaReadiness.delete(dbObject)", "empty suggestion readiness maps should be removed after failure eviction");

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
  matchCalls: string[] = [];
  putCalls: string[] = [];

  async match(request: Request) {
    this.matchCalls.push(request.url);
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

function makeSuggestionRouteContext(
  request: Request,
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
  params: Record<string, string> = {},
): PagesContext {
  return {
    request,
    env,
    waitUntil,
    params,
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

class SuggestionMutationAuthDb {
  sessionQueries = 0;
  schemaQueries = 0;
  suggestionRowsCreated = 0;
  voteRowsCreated = 0;
  reportRowsCreated = 0;

  constructor(private readonly authenticated: boolean) {}

  prepare(sql: string) {
    return new SuggestionMutationAuthStatement(this, sql);
  }

  async batch(statements: SuggestionMutationAuthStatement[]) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ success: true }));
  }

  sessionUser() {
    this.sessionQueries += 1;
    return this.authenticated
      ? { id: "auth-user", discord_id: "990000000000009999", username: "Auth Test User", avatar: null }
      : null;
  }
}

class SuggestionMutationAuthStatement {
  private bindings: unknown[] = [];

  constructor(private readonly db: SuggestionMutationAuthDb, private readonly sql: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async all() {
    if (/PRAGMA\s+table_info\(([^)]+)\)/i.test(this.sql)) {
      this.db.schemaQueries += 1;
      const table = this.sql.match(/PRAGMA\s+table_info\(([^)]+)\)/i)?.[1] ?? "";
      return { results: (SUGGESTION_ROUTE_COLUMNS[table] ?? []).map((name, cid) => ({ cid, name, type: "TEXT", notnull: 0, dflt_value: null, pk: 0 })) };
    }
    if (/SELECT\s+normalized_title\s+FROM\s+event_suggestions/i.test(this.sql)) {
      return { results: [] };
    }
    return { results: [] };
  }

  async first() {
    if (this.sql.includes("FROM sessions") && this.sql.includes("JOIN users")) {
      return this.db.sessionUser();
    }
    if (/SELECT\s+id\s+FROM\s+event_suggestions\s+WHERE\s+content_fingerprint/i.test(this.sql)) {
      return null;
    }
    if (/SELECT\s+created_at\s+FROM\s+event_suggestions\s+WHERE\s+submitted_by_user_id/i.test(this.sql)) {
      return null;
    }
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+count\s+FROM\s+event_suggestions\s+WHERE\s+submitted_by_user_id/i.test(this.sql)) {
      return { count: 0 };
    }
    if (/SELECT\s+id,\s+submitted_by_user_id,\s+public_status/i.test(this.sql)) {
      return {
        id: "auth-target",
        submitted_by_user_id: "submitter-user",
        public_status: "public_voting",
        created_at: "2026-07-23T10:00:00.000Z",
      };
    }
    if (/SELECT\s+vote_value,\s+updated_at\s+FROM\s+event_suggestion_votes/i.test(this.sql)) {
      return null;
    }
    if (/SELECT\s+id\s+FROM\s+event_suggestion_reports/i.test(this.sql)) {
      return null;
    }
    if (/SELECT\s+upvote_count,\s+downvote_count,\s+report_count,\s+hot_score\s+FROM\s+event_suggestions/i.test(this.sql)) {
      return { upvote_count: this.db.voteRowsCreated, downvote_count: 0, report_count: this.db.reportRowsCreated, hot_score: this.db.voteRowsCreated - this.db.reportRowsCreated };
    }
    return null;
  }

  async run() {
    if (/INSERT\s+INTO\s+event_suggestions/i.test(this.sql)) {
      this.db.suggestionRowsCreated += 1;
      return { success: true };
    }
    if (/INSERT\s+INTO\s+event_suggestion_votes/i.test(this.sql)) {
      this.db.voteRowsCreated += 1;
      return { success: true };
    }
    if (/INSERT\s+OR\s+IGNORE\s+INTO\s+event_suggestion_reports/i.test(this.sql)) {
      this.db.reportRowsCreated += 1;
      return { success: true };
    }
    if (/UPDATE\s+event_suggestions/i.test(this.sql)) {
      return { success: true };
    }
    if (/DELETE\s+FROM\s+event_suggestion_votes/i.test(this.sql)) {
      return { success: true };
    }
    throw new Error(`Unexpected suggestion mutation auth query: ${this.sql.slice(0, 120)}`);
  }
}

class PublicEventProjectionDb {
  readonly server = {
    id: "public-server",
    user_id: "member-user",
    guild_id: "guild-public",
    public_slug: "public-server",
    display_name: "Public Server",
    hostname: null,
    server_name: "Public Server",
    nitrado_service_name: null,
    server_type: "modded",
    server_mode: "pvp",
    server_category: "modded",
    competitive_enabled: 1,
    verified_server: 1,
    event_mmr: 1200,
    season_points: 30,
    event_wins: 2,
    event_losses: 1,
    event_draws: 0,
    last_event_at: "2026-07-23T10:00:00.000Z",
    current_players: 12,
    max_players: 60,
    plan_key: "pro",
    subscription_status: "active",
    status: "live",
    listing_visibility: "public",
    updated_at: "2026-07-23T10:00:00.000Z",
  };
  readonly events = [
    publicProjectionEvent("public-live-event", "Public Live Cup", "public-live-cup", "live", "public"),
    publicProjectionEvent("public-upcoming-event", "Public Upcoming Cup", "public-upcoming-cup", "upcoming", "public"),
    publicProjectionEvent("unlisted-event", "Unlisted Cup", "unlisted-cup", "upcoming", "unlisted"),
    publicProjectionEvent("private-live-event", "Private Live Cup", "private-live-cup", "live", "private"),
    publicProjectionEvent("public-draft-event", "Public Draft Cup", "public-draft-cup", "draft", "public"),
    publicProjectionEvent("unlisted-draft-event", "Unlisted Draft Cup", "unlisted-draft-cup", "draft", "unlisted"),
    publicProjectionEvent("private-conversion-event", "Private Conversion Target", "private-conversion-slug", "draft", "private"),
  ];
  readonly activityRows = [
    projectionActivity("public-live-activity", "public-live-event", "Public live activity message.", "event_created", { public: true }),
    projectionActivity("public-upcoming-activity", "public-upcoming-event", "Public upcoming activity message.", "event_created", { public: true }),
    projectionActivity("unlisted-activity", "unlisted-event", "Unlisted activity message.", "event_created", { public: true }),
    projectionActivity("private-live-activity", "private-live-event", "Private Live Cup hidden activity.", "event_created", { hidden: true }),
    projectionActivity("public-draft-activity", "public-draft-event", "Public Draft Cup hidden activity.", "event_created", { hidden: true }),
    projectionActivity("unlisted-draft-activity", "unlisted-draft-event", "Unlisted Draft Cup hidden activity.", "event_created", { hidden: true }),
    projectionActivity("private-conversion-activity", "private-conversion-event", "Community suggestion converted to draft: Private Conversion Target.", "suggestion_converted_to_draft", { suggestion_id: "private-suggestion-id" }),
    projectionActivity("orphan-activity", "missing-event", "Orphan hidden activity.", "event_created", { hidden: true }),
  ];
  readonly registrations = [
    { id: "reg-public-live", event_id: "public-live-event", server_id: "public-server", category: "modded", approved: 1, score: 20, wins: 2, losses: 0, draws: 0, seed: 1, registered_at: "2026-07-23T10:00:00.000Z" },
    { id: "reg-private-live", event_id: "private-live-event", server_id: "public-server", category: "modded", approved: 1, score: 8, wins: 1, losses: 0, draws: 0, seed: 2, registered_at: "2026-07-23T10:00:00.000Z" },
    { id: "reg-public-draft", event_id: "public-draft-event", server_id: "public-server", category: "modded", approved: 1, score: 4, wins: 0, losses: 0, draws: 0, seed: 3, registered_at: "2026-07-23T10:00:00.000Z" },
  ];
  readonly matches = [
    projectionMatch("public-match", "public-live-event", "public-server", "opponent-server"),
    projectionMatch("private-match", "private-live-event", "public-server", "opponent-server"),
    projectionMatch("draft-match", "public-draft-event", "public-server", "opponent-server"),
  ];

  prepare(sql: string) {
    return new PublicEventProjectionStatement(this, sql);
  }

  eventById(eventId: string | null) {
    return this.events.find((event) => event.id === eventId) ?? null;
  }

  isPublicEvent(event: { visibility: string | null; status: string | null } | null) {
    return Boolean(event)
      && String(event!.visibility ?? "public").toLowerCase() !== "private"
      && String(event!.status ?? "draft").toLowerCase() !== "draft";
  }

  withCounts(event: ReturnType<typeof publicProjectionEvent>) {
    return {
      ...event,
      registered_servers: this.registrations.filter((registration) => registration.event_id === event.id).length,
      total_score: this.registrations.filter((registration) => registration.event_id === event.id).reduce((total, registration) => total + Number(registration.score ?? 0), 0),
      match_count: this.matches.filter((match) => match.event_id === event.id).length,
    };
  }
}

class PublicEventProjectionStatement {
  private bindings: unknown[] = [];

  constructor(private readonly db: PublicEventProjectionDb, private readonly sql: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async all() {
    if (/PRAGMA\s+table_info\(([^)]+)\)/i.test(this.sql)) {
      const table = this.sql.match(/PRAGMA\s+table_info\(([^)]+)\)/i)?.[1] ?? "";
      return { results: (EVENT_READ_TEST_COLUMNS[table] ?? []).map((name, cid) => ({ cid, name, type: "TEXT", notnull: 0, dflt_value: null, pk: 0 })) };
    }
    if (/FROM\s+competitive_event_activity/i.test(this.sql) && /JOIN\s+competitive_events/i.test(this.sql)) {
      const limit = Number(this.bindings[0] ?? 25);
      const rows = this.db.activityRows
        .map((activity) => ({ activity, event: this.db.eventById(activity.event_id) }))
        .filter(({ event }) => this.db.isPublicEvent(event))
        .slice(0, limit)
        .map(({ activity, event }) => ({
          ...activity,
          event_name: event?.name ?? null,
          event_slug: event?.slug ?? null,
          server_name: this.db.server.display_name,
          public_slug: this.db.server.public_slug,
        }));
      return { results: rows };
    }
    if (/FROM\s+competitive_event_servers/i.test(this.sql) && /JOIN\s+competitive_events/i.test(this.sql)) {
      const serverId = String(this.bindings[0] ?? "");
      const statuses = new Set(this.bindings.slice(1).map(String));
      const rows = this.db.registrations
        .filter((registration) => registration.server_id === serverId)
        .map((registration) => ({ registration, event: this.db.eventById(registration.event_id) }))
        .filter(({ event }) => this.db.isPublicEvent(event) && statuses.has(String(event?.status ?? "")))
        .map(({ registration, event }) => ({ ...this.db.withCounts(event!), total_score: registration.score }));
      return { results: rows };
    }
    if (/FROM\s+competitive_events/i.test(this.sql) && /WHERE\s+category\s*=\s*\?/i.test(this.sql)) {
      const category = String(this.bindings[0] ?? "");
      const rows = this.db.events
        .filter((event) => event.category === category && this.db.isPublicEvent(event) && ["registration_open", "upcoming", "standby"].includes(event.status))
        .map((event) => this.db.withCounts(event));
      return { results: rows };
    }
    if (/FROM\s+competitive_event_matches/i.test(this.sql) && /JOIN\s+competitive_events/i.test(this.sql)) {
      const serverId = String(this.bindings[0] ?? "");
      const rows = this.db.matches
        .filter((match) => match.left_server_id === serverId || match.right_server_id === serverId)
        .filter((match) => this.db.isPublicEvent(this.db.eventById(match.event_id)))
        .map((match) => ({
          ...match,
          left_server_name: match.left_server_id === "public-server" ? "Public Server" : "Opponent Server",
          left_slug: match.left_server_id,
          right_server_name: match.right_server_id === "public-server" ? "Public Server" : "Opponent Server",
          right_slug: match.right_server_id,
          winner_name: null,
        }));
      return { results: rows };
    }
    return { results: [] };
  }

  async first() {
    if (/FROM\s+linked_servers/i.test(this.sql) && /WHERE\s+linked_servers\.id\s*=\s*\?/i.test(this.sql)) {
      const value = String(this.bindings[0] ?? "");
      return value === this.db.server.id || value === this.db.server.public_slug ? this.db.server : null;
    }
    const rows = await this.all();
    return rows.results[0] ?? null;
  }
}

class RecoverableSchemaDb {
  availableTables: Set<string>;
  throwOnPragma: boolean;
  private readonly counts = new Map<string, number>();
  private readonly delayMs: number;

  constructor(options: { availableTables: Set<string>; throwOnPragma?: boolean; delayMs?: number }) {
    this.availableTables = options.availableTables;
    this.throwOnPragma = options.throwOnPragma ?? false;
    this.delayMs = options.delayMs ?? 0;
  }

  prepare(sql: string) {
    return new RecoverableSchemaStatement(this, sql);
  }

  async tableInfo(table: string) {
    this.counts.set(table, this.probeCount(table) + 1);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.throwOnPragma) throw new Error("injected pragma failure");
    const columns = this.availableTables.has(table)
      ? Array.from(new Set([...(SUGGESTION_ROUTE_COLUMNS[table] ?? []), ...(EVENT_READ_TEST_COLUMNS[table] ?? [])]))
      : [];
    return columns.map((name, cid) => ({ cid, name, type: "TEXT", notnull: 0, dflt_value: null, pk: 0 }));
  }

  probeCount(table: string) {
    return this.counts.get(table) ?? 0;
  }
}

class RecoverableSchemaStatement {
  constructor(private readonly db: RecoverableSchemaDb, private readonly sql: string) {}

  bind() {
    return this;
  }

  async all() {
    const table = this.sql.match(/PRAGMA\s+table_info\(([^)]+)\)/i)?.[1];
    if (table) return { results: await this.db.tableInfo(table) };
    return { results: [] };
  }

  async first() {
    const rows = await this.all();
    return rows.results[0] ?? null;
  }
}

function publicProjectionEvent(id: string, name: string, slug: string, status: string, visibility: string) {
  return {
    id,
    name,
    slug,
    description: `${name} description`,
    category: "modded",
    event_type: "community_cup",
    status,
    visibility,
    premium_tier: "free",
    server_limit: 16,
    team_limit: 16,
    starts_at: "2026-08-01T10:00:00.000Z",
    ends_at: "2026-08-02T10:00:00.000Z",
    created_by: "creator-user",
    banner_url: null,
    rules: `${name} public rules`,
    rewards: `${name} public rewards`,
    created_at: "2026-07-23T10:00:00.000Z",
    updated_at: "2026-07-23T10:00:00.000Z",
    registered_servers: 0,
    total_score: 0,
    match_count: 0,
  };
}

function projectionActivity(id: string, eventId: string, message: string, activityType: string, metadata: Record<string, unknown>) {
  return {
    id,
    event_id: eventId,
    server_id: "public-server",
    activity_type: activityType,
    message,
    metadata: JSON.stringify(metadata),
    created_at: "2026-07-23T10:00:00.000Z",
    event_name: null,
    event_slug: null,
    server_name: null,
    public_slug: null,
  };
}

function projectionMatch(id: string, eventId: string, leftServerId: string, rightServerId: string) {
  return {
    id,
    event_id: eventId,
    left_server_id: leftServerId,
    right_server_id: rightServerId,
    category: "modded",
    match_status: "completed",
    winner_server_id: null,
    round_number: 1,
    left_score: 5,
    right_score: 3,
    starts_at: "2026-07-23T10:00:00.000Z",
    ends_at: "2026-07-23T11:00:00.000Z",
    created_at: "2026-07-23T10:00:00.000Z",
    updated_at: "2026-07-23T11:00:00.000Z",
    left_server_name: null,
    left_slug: null,
    right_server_name: null,
    right_slug: null,
    winner_name: null,
  };
}

const EVENT_READ_TEST_COLUMNS: Record<string, string[]> = {
  competitive_events: ["id", "name", "slug", "description", "category", "event_type", "status", "visibility", "starts_at", "ends_at", "created_at", "updated_at"],
  competitive_event_servers: ["event_id", "server_id", "score", "wins", "losses", "draws"],
  competitive_event_matches: ["event_id", "match_status"],
  competitive_event_activity: ["event_id", "server_id", "activity_type", "message", "created_at"],
  linked_servers: ["id", "public_slug", "server_category", "status"],
};

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
  competitive_events: ["id", "name", "slug", "description", "category", "event_type", "status", "visibility", "created_by"],
  competitive_event_activity: ["id", "event_id", "server_id", "activity_type", "message", "metadata", "created_at"],
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
