import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { getEventsListPayload, resolveEventStatusFilter } from "../functions/_lib/events";
import { assertSameServerCategory, categoryMismatchPayload, normalizeServerCategory } from "../functions/_lib/server-categories";
import type { Env } from "../functions/_lib/types";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function includesAll(file: string, snippets: string[]) {
  for (const snippet of snippets) {
    assert.equal(file.includes(snippet), true, `Expected source to include: ${snippet}`);
  }
}

assert.equal(normalizeServerCategory("DM"), "deathmatch");
assert.equal(normalizeServerCategory("PvP Only"), "pvp");
assert.equal(normalizeServerCategory("PvE Only"), "pve");
assert.equal(normalizeServerCategory("PvP/PvE"), "pvp_pve");
assert.equal(normalizeServerCategory("Faction Wars"), "faction_wars");

assert.equal(assertSameServerCategory({ server_category: "deathmatch" }, { category: "DM" }), "deathmatch");
assert.equal(assertSameServerCategory({ server_category: "PvP Only" }, { category: "pvp" }), "pvp");
assert.throws(() => assertSameServerCategory({ server_category: "deathmatch" }, { category: "pvp" }), /same category/i);
assert.throws(() => assertSameServerCategory({ server_category: "pvp" }, { category: "pve" }), /same category/i);
assert.throws(() => assertSameServerCategory({ server_category: "roleplay" }, { category: "hardcore" }), /same category/i);
assert.deepEqual(categoryMismatchPayload(), {
  ok: false,
  error: "CATEGORY_MISMATCH",
  message: "Only servers in the same category can compete in this event.",
});
assert.deepEqual(resolveEventStatusFilter("upcoming"), ["upcoming", "registration_open", "standby"]);
assert.deepEqual(resolveEventStatusFilter("active"), ["live"]);
assert.deepEqual(resolveEventStatusFilter("completed"), ["ended"]);

const migration = source("migrations/0032_events_competitive_ecosystem.sql");
includesAll(migration, [
  "ALTER TABLE linked_servers ADD COLUMN server_category TEXT",
  "competitive_enabled",
  "CREATE TABLE IF NOT EXISTS competitive_events",
  "CREATE TABLE IF NOT EXISTS competitive_event_servers",
  "CREATE TABLE IF NOT EXISTS competitive_event_matches",
  "CREATE TABLE IF NOT EXISTS competitive_event_activity",
  "CREATE TABLE IF NOT EXISTS competitive_seasons",
  "CREATE TABLE IF NOT EXISTS competitive_season_standings",
  "idx_competitive_events_category",
  "idx_competitive_event_matches_category",
]);
assert.equal(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+player_profiles|CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+player_stats/i.test(migration), false, "Events migration must be additive and must not create a duplicate player_stats table.");

const eventsLib = source("functions/_lib/events.ts");
includesAll(eventsLib, [
  "ensureCompetitiveEventsSchema",
  "createCompetitiveEvent",
  "joinCompetitiveEvent",
  "createCategorySafeMatchmaking",
  "normalizeServerCategory",
  "categoryMismatchPayload",
  "serverHasEventEntitlement",
  "FULL_EVENT_PLANS",
  "options.full === true && entitlement",
  "Math.min(sanitizeLimit(options.limit, 10, 24), 10)",
  "resolveEventStatusFilter",
  "NO_CATEGORY",
  "Set your server category before joining events.",
  "Set your server category before creating events.",
  "Event creation is a Pro/Partner feature.",
  "Only same-category servers can register.",
  "assertSameServerCategory(primary, opponent)",
  "sanitizePlainText",
  "makeUniqueEventSlug",
]);

const joinRoute = source("functions/api/events/[slug]/join.ts");
includesAll(joinRoute, ["joinCompetitiveEvent", "readJson<JoinBody>", "server_id"]);
const serverSettingsRoute = source("functions/api/servers/[serverId]/settings.ts");
includesAll(serverSettingsRoute, ["readOwnerServerSettings", "updateServerCategory", "server_category", "NOT_AUTHENTICATED"]);
const serverSettingsPolicy = source("functions/_lib/server-settings.ts");
includesAll(serverSettingsPolicy, ["normalizeOwnerServerCategory", "CATEGORY_INVALID", "CATEGORY_COOLDOWN_ACTIVE", "CATEGORY_LOCKED_DURING_EVENT", "You do not have access to this server."]);
const matchmakingRoute = source("functions/api/events/matchmaking.ts");
includesAll(matchmakingRoute, ["createCategorySafeMatchmaking", "opponent_server_id", "event_slug"]);
const eventsRoute = source("functions/api/events.ts");
includesAll(eventsRoute, ["getEventsListPayload", "full", "category", "status", "type"]);
const eventCreateRoute = source("functions/api/events/create.ts");
includesAll(eventCreateRoute, ["createCompetitiveEvent", "getSessionUser", "hosting_server_id"]);

for (const route of [
  "app/events/page.tsx",
  "app/events/create/page.tsx",
  "app/events/tournaments/page.tsx",
  "app/events/[slug]/page.tsx",
  "app/events/[slug]/bracket/page.tsx",
  "app/events/challenges/page.tsx",
  "app/servers/[slug]/events/page.tsx",
]) {
  assert.equal(existsSync(route), true, `Expected route to exist: ${route}`);
}

for (const component of [
  "EventHero",
  "TournamentCard",
  "LiveBattleCard",
  "BracketView",
  "LeaderboardTeaser",
  "SeasonBanner",
  "ServerEventProfile",
  "LiveActivityFeed",
  "EventStatusBadge",
  "ServerCategoryBadge",
  "EventFilterPanel",
  "PremiumLockedCard",
  "CountdownTimer",
  "TournamentTable",
  "ChallengeBattleCard",
]) {
  assert.equal(existsSync(`components/events/${component}.tsx`), true, `Expected reusable component ${component}.tsx`);
}

const detailUi = source("components/events/events-platform.tsx");
includesAll(detailUi, [
  "SAME CATEGORY ONLY",
  "Cross-server matching is an exclusive Pro/Partner platform feature.",
  "EventCreatePage",
  "CREATE EVENT",
  "Set your server category before creating an event.",
  "The event category is locked to the selected hosting server.",
  "/api/events/create",
  "eventMatchesStatusFilter",
  "Demo data shown until live events are created",
  "Deathmatch can only fight Deathmatch",
  "ServerCategoryBadge",
]);
assert.equal(source("components/events/EventHero.tsx").includes('href="/events/create"'), true, "Create Event CTA must route to /events/create.");
assert.equal(source("components/events/EventTabs.tsx").includes("/events/tournaments?status=active"), true, "Active tab must use the active status alias.");
assert.equal(source("components/events/ChallengeBattleCard.tsx").includes("Cross-server matching is an exclusive Pro/Partner platform feature."), false, "Challenge cards should not repeat the full premium lock sentence.");
assert.equal(source("components/events/PremiumLockedCard.tsx").includes("PRO / PARTNER FEATURE"), true);
assert.equal(source("components/events/LeaderboardTeaser.tsx").includes("TOP 10 MASTER TEASER"), true);

assert.equal(existsSync("functions/api/servers/[serverId]/ctf/dashboard.ts"), true, "Existing CTF dashboard route must still exist.");
assert.equal(existsSync("functions/api/servers/[serverId]/ctf/matchmaking.ts"), true, "Existing CTF matchmaking route must still exist.");
assert.equal(source("functions/api/leaderboards.ts").includes("./public/leaderboards"), true, "Existing /api/leaderboards alias must still work.");
assert.equal(source("components/dzn/dzn-landing-page.tsx").includes('{ label: "Events", href: "/events" }'), true, "Top nav Events link must open the Events Hub.");
assert.equal(source("components/onboarding/dashboard.tsx").includes("Set your server category to join events and matchmaking."), true, "Dashboard must remind owners to set a server category.");
assert.equal(source("components/onboarding/dashboard.tsx").includes('href="/events/create"'), true, "Dashboard must expose event creation after category selection.");
assert.equal(source("components/onboarding/setup-wizard.tsx").includes("Server Category"), true, "Onboarding must expose server category selection.");

void main();

async function main() {
  const teaserPayload = await getEventsListPayload({} as Env, null, { full: true, limit: 50 });
  assert.equal(teaserPayload.teaserMode, true, "Unauthenticated full=true must stay in teaser mode.");
  assert.equal(teaserPayload.events.length <= 10, true, "Teaser events must be capped to top 10.");
  const upcomingPayload = await getEventsListPayload({} as Env, null, { status: "upcoming", limit: 50 });
  assert.equal(upcomingPayload.events.every((event) => ["upcoming", "registration_open", "standby"].includes(event.status)), true, "Upcoming filter must hide live events.");
  const activePayload = await getEventsListPayload({} as Env, null, { status: "active", limit: 50 });
  assert.equal(activePayload.events.every((event) => event.status === "live"), true, "Active filter must only show live events.");

  console.log("Events competitive ecosystem tests passed.");
}
