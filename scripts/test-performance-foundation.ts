import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  canonicalPublicCacheKey,
  hasPrivateRequestSignal,
  privateNoStoreHeaders,
  publicCacheHeaders,
} from "../functions/_lib/performance";
import {
  computeSuggestionHotScore,
  moderateSuggestionContent,
  normalizeSuggestionText,
  validateSuggestionInput,
} from "../functions/_lib/event-suggestions";

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
  assertCacheHelpers();
  assertSuggestionSchemaAndIndexes();
  assertSuggestionApis();
  assertLoadingUx();
  assertPublicApiSafety();
  assertDocsAndRoadmap();
  assertWorkflowBoundaries();
  console.log("Performance foundation tests passed.");
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
  assert.equal(moderateSuggestionContent("please k!ll yourself").ok, false, "threat/self-harm harassment phrase should be blocked");
  assert.equal(moderateSuggestionContent("<script>alert(1)</script>").ok, false, "HTML/script content should be blocked before sanitization");
  assert.equal(moderateSuggestionContent("join discord.gg/example").ok, false, "Discord invites should be blocked");
  assert.equal(moderateSuggestionContent("@everyone vote for this").ok, false, "mass mentions should be blocked");
  const hotWithReports = computeSuggestionHotScore({ upvotes: 10, downvotes: 2, reports: 6, createdAt: new Date().toISOString() });
  const hotWithoutReports = computeSuggestionHotScore({ upvotes: 10, downvotes: 2, reports: 0, createdAt: new Date().toISOString() });
  assert.equal(hotWithoutReports > hotWithReports, true, "report penalty should reduce trending score");
}

function assertCacheHelpers() {
  const publicHeaders = publicCacheHeaders({ maxAge: 15, staleWhileRevalidate: 45 }, "MISS");
  assertIncludes(publicHeaders.get("cache-control") ?? "", "public, max-age=15");
  assert.equal(publicHeaders.get("x-dzn-cache"), "MISS");
  const privateHeaders = privateNoStoreHeaders();
  assertIncludes(privateHeaders.get("cache-control") ?? "", "private, no-store");
  assert.equal(privateHeaders.get("x-dzn-cache"), "BYPASS");
  assert.equal(hasPrivateRequestSignal(new Request("https://example.test/api", { headers: { authorization: "Bearer secret" } })), true);
  assert.equal(hasPrivateRequestSignal(new Request("https://example.test/api", { headers: { cookie: "dzn_session=abc" } })), true);
  const cacheKey = canonicalPublicCacheKey(new Request("https://example.test/api/events/suggestions?token=secret&sort=newest&limit=20"), ["sort", "limit"]);
  assertIncludes(cacheKey, "sort=newest");
  assertIncludes(cacheKey, "limit=20");
  assertNotIncludes(cacheKey, "token=secret", "cache key must ignore non-allowlisted parameters");
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
    "idx_event_suggestions_submitted_user_created",
    "idx_event_suggestions_fingerprint",
    "idx_event_suggestion_votes_suggestion",
    "idx_event_suggestion_votes_user",
    "idx_event_suggestion_reports_suggestion_status",
    "idx_event_suggestion_reports_user_open",
    "idx_event_suggestion_moderation_suggestion_time",
  ]) {
    assertIncludes(migration, indexName);
  }
  assertIncludes(migration, "PRIMARY KEY (suggestion_id, user_id)", "one active vote row per user and suggestion");
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|CREATE TABLE IF NOT EXISTS player_stats/i, "migration must be additive and must not create player_stats");
}

function assertSuggestionApis() {
  const helper = source("functions/_lib/event-suggestions.ts");
  assertIncludes(helper, "validateEventSuggestionSchema");
  assertIncludes(helper, "PRAGMA table_info");
  assertIncludes(helper, "EVENT_SUGGESTIONS_SCHEMA_NOT_READY");
  assertIncludes(helper, "pending_moderation");
  assertIncludes(helper, "public_voting");
  assertIncludes(helper, "converted_to_event");
  assertIncludes(helper, "nearDuplicateScore");
  assertIncludes(helper, "VOTE_RATE_LIMITED");
  assertIncludes(helper, "SELF_VOTE_DENIED");
  assertIncludes(helper, "status, visibility, premium_tier");
  assertIncludes(helper, "'draft', 'private'");
  assertIncludes(helper, "db.batch");
  assertNotIncludes(helper, "SELECT * FROM event_suggestions", "suggestions helper should avoid broad suggestion reads");
  assert.doesNotMatch(helper, /DISCORD_BOT_TOKEN|discord\.com\/api|allowed_mentions|queue|scheduled|NITRADO/i, "suggestion helper must not send Discord or call automation/upstream systems");

  const publicRoute = source("functions/api/events/suggestions/index.ts");
  assertIncludes(publicRoute, "withPublicGetEdgeCache");
  assertIncludes(publicRoute, "allowedParams: [\"sort\", \"limit\", \"cursor\"]");
  assertIncludes(publicRoute, "privateNoStoreHeaders()");
  assert.doesNotMatch(publicRoute, /DISCORD_BOT_TOKEN|NITRADO|scheduler|cron/i);

  for (const path of [
    "functions/api/events/suggestions/[suggestionId]/vote.ts",
    "functions/api/events/suggestions/[suggestionId]/report.ts",
  ]) {
    const route = source(path);
    assertIncludes(route, "getSessionUser");
    assertIncludes(route, "privateNoStoreHeaders()");
    assert.doesNotMatch(route, /publicCacheHeaders|withPublicGetEdgeCache/, `${path} must not be publicly cached`);
  }

  const ownerList = source("functions/api/owner/events/suggestions.ts");
  assertIncludes(ownerList, "requirePlatformOwner");
  assertIncludes(ownerList, "privateNoStoreHeaders()");

  for (const path of [
    "functions/api/owner/events/suggestions/[suggestionId]/moderate.ts",
    "functions/api/owner/events/suggestions/[suggestionId]/convert.ts",
  ]) {
    const route = source(path);
    const handler = route.slice(route.indexOf("export const onRequestPost"));
    assertOrder(handler, "requirePlatformCreatorEventAdmin", "readJson", `${path} must authorize creator before reading request body`);
    assertIncludes(route, "privateNoStoreHeaders()");
  }

  const publicPage = source("components/events/event-suggestions-page.tsx");
  assertIncludes(publicPage, "/api/events/suggestions");
  assertIncludes(publicPage, "/vote");
  assertIncludes(publicPage, "/report");
  assertIncludes(publicPage, "window.location.href");
  assertNotIncludes(publicPage, "DZN_PLATFORM_CREATOR_DISCORD_ID", "creator env key must stay server-only");

  const ownerPage = source("components/owner/owner-events-page.tsx");
  assertIncludes(ownerPage, "Suggestions overview");
  assertIncludes(ownerPage, "/api/owner/events/suggestions");
  assertIncludes(ownerPage, "Convert to draft");
  assertIncludes(ownerPage, "creatorEventAdmin");
  assertNotIncludes(ownerPage, "DZN_PLATFORM_CREATOR_DISCORD_ID", "owner UI must not expose creator ID config");
}

function assertLoadingUx() {
  const layout = source("app/layout.tsx");
  assertIncludes(layout, "NavigationProgress");
  assertIncludes(layout, "Suspense");
  const progress = source("components/site/navigation-progress.tsx");
  assertIncludes(progress, "START_DELAY_MS = 120");
  assertIncludes(progress, "popstate");
  assertIncludes(progress, "target.hasAttribute(\"download\")");
  assertIncludes(progress, "event.metaKey");
  assertIncludes(progress, "next.origin !== window.location.origin");
  assertIncludes(progress, "next.hash !== current.hash");
  assertIncludes(progress, "sr-only");

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
  assertIncludes(eventsApi, "publicCacheHeaders({ maxAge: 15, staleWhileRevalidate: 45 })");

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
    assert.doesNotMatch(ci, /wrangler\s+(deploy|d1|pages deploy)|CLOUDFLARE|DISCORD_BOT_TOKEN|DZN_DISCORD_NOTIFICATIONS_ENABLED=true/i, "performance CI must not deploy, migrate, or use production/Discord secrets");
  }
}

void main();
