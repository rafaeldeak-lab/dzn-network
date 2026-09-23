import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dashboardAdvancedStatsMessage } from "../components/onboarding/dashboard-detail-display";

function source(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

const advancedStatsRoute = source("functions/api/servers/[serverId]/dashboard/advanced-stats.ts");
const advancedStatsBuilder = source("functions/_lib/advanced-leaderboards.ts");
const warsRoute = source("functions/api/servers/[serverId]/wars/index.ts");
const recentEventsRoute = source("functions/api/sync/recent-events.ts");
const postingDestinationsRoute = source("functions/api/servers/[serverId]/posting-destinations.ts");
const discordChannelsRoute = source("functions/api/servers/[serverId]/discord-channels.ts");
const advertisingBumpRoute = source("functions/api/servers/[serverId]/advertising/bump.ts");
const dashboardSource = source("components/onboarding/dashboard.tsx");

assert.equal(
  advancedStatsRoute.includes("getServerAdvancedShowcasePayload"),
  true,
  "Advanced Stats GET must load the selected server's bounded aggregate showcase.",
);
assert.equal(advancedStatsRoute.includes("ownerScoped: true"), true, "Advanced Stats must resolve the authenticated owner's exact server.");
assert.equal(advancedStatsBuilder.includes("SERVER_ADVANCED_CACHE_TTL_MS"), true, "Advanced Stats aggregation must remain short-lived cached.");
assert.equal(advancedStatsBuilder.includes("SERVER_ADVANCED_EVENT_SAMPLE_LIMIT = 6_000"), true, "Advanced Stats event reads must have an explicit hard bound.");
assert.equal(advancedStatsBuilder.includes("sampled_kill_events"), true, "Advanced Stats player rankings must aggregate a bounded kill sample.");
assert.equal(advancedStatsBuilder.includes("sampled_build_events"), true, "Advanced Stats build rankings must aggregate a bounded build sample.");
assert.equal(advancedStatsBuilder.includes("FROM server_stats"), true, "Advanced Stats lifetime headline totals must use the durable aggregate.");
assert.equal(advancedStatsBuilder.includes("lockedOwnerAnalytics\n    ? [await canonicalPromise, [], [], []]"), true, "Locked owner accounts must skip raw event reconstruction.");
assert.equal(advancedStatsBuilder.includes("readServerShowcaseAccess"), true, "Advanced Stats must resolve exact-server complimentary access without rewriting billing.");
assert.equal(
  advancedStatsRoute.includes("advanced_stats_snapshot_pending"),
  true,
  "Advanced Stats GET must retain a controlled fallback when aggregation is unavailable.",
);
assert.equal(
  advancedStatsRoute.includes("available: false"),
  true,
  "Advanced Stats optional unavailability must be represented in the payload.",
);
assert.equal(
  advancedStatsRoute.includes("status: 503"),
  false,
  "Advanced Stats optional snapshot reads must not fail the dashboard with HTTP 503.",
);
assert.equal(
  dashboardSource.includes("dashboardAdvancedStatsMessage(data.reason)"),
  true,
  "Dashboard must map internal advanced stats reason keys to user-facing copy.",
);
assert.equal(
  dashboardAdvancedStatsMessage("advanced_stats_snapshot_pending"),
  "Advanced showcase is not available yet. Core gameplay statistics remain available.",
  "Pending snapshots must not promise an unimplemented publisher will run after another import.",
);
assert.equal(
  dashboardSource.includes('data.reason ?? "advanced_stats_snapshot_pending"'),
  false,
  "Dashboard must not render raw advanced_stats_snapshot_pending fallback text.",
);

assert.equal(
  warsRoute.includes("skipSchemaEnsure: true"),
  true,
  "Server Wars GET must skip request-time schema setup.",
);
assert.equal(
  warsRoute.includes("server_wars_temporarily_unavailable"),
  true,
  "Server Wars GET must return a controlled optional fallback.",
);
assert.equal(
  warsRoute.includes("active_events"),
  true,
  "Server Wars fallback must expose the stable snake_case payload shape.",
);
assert.equal(
  warsRoute.includes("status: 503"),
  false,
  "Server Wars optional GET failure must not surface as HTTP 503.",
);

assert.equal(
  recentEventsRoute.includes("recent_events_temporarily_unavailable"),
  true,
  "Recent events must degrade to a controlled response when optional history cannot load.",
);
assert.equal(
  recentEventsRoute.includes("stale: true"),
  true,
  "Recent events fallback must be labelled stale.",
);
assert.equal(
  recentEventsRoute.includes("readRecentAdmSyncEvents") &&
    !recentEventsRoute.includes("getRecentAdmSyncEvents") &&
    !recentEventsRoute.includes("ensureAdmSyncSchema"),
  true,
  "Recent events hot route must use its bounded read without invoking ADM schema setup.",
);
assert.equal(
  recentEventsRoute.includes("LIMIT ?"),
  true,
  "Recent events hot route must cap returned history.",
);

assert.equal(
  postingDestinationsRoute.includes("fetchDiscordPostingChannels"),
  false,
  "Posting destinations GET must not call Discord live.",
);
assert.equal(
  postingDestinationsRoute.includes("getPostingContextForRead"),
  true,
  "Posting destinations GET must use a lightweight read context.",
);
assert.equal(
  postingDestinationsRoute.includes("checkDiscordPostingPermissions("),
  true,
  "Posting destinations mutations may still validate permissions.",
);
assert.equal(
  postingDestinationsRoute.includes("savedPostingChannel"),
  true,
  "Posting destinations GET must use saved channel state.",
);

assert.equal(
  discordChannelsRoute.includes('url.searchParams.get("refresh") === "1"'),
  true,
  "Discord channel live fetch must require an explicit refresh parameter.",
);
assert.equal(
  discordChannelsRoute.includes("readCachedDiscordPostingChannels"),
  true,
  "Discord channel default GET must read cached/saved channels.",
);
assert.equal(
  discordChannelsRoute.includes("using_cached_channel_state"),
  true,
  "Discord channel response must expose cached-channel evidence.",
);
assert.equal(
  discordChannelsRoute.includes("error: classified.message") &&
    discordChannelsRoute.includes("manualFallback: true") &&
    discordChannelsRoute.includes("usingCachedChannelState: true") &&
    discordChannelsRoute.includes("warning: classified.message"),
  true,
  "Explicit Discord refresh failures must degrade inside the module payload.",
);

assert.equal(
  advertisingBumpRoute.includes("getOwnerEntitlementsReadOnly"),
  true,
  "Advertising status GET must use a read-only entitlement lookup.",
);
assert.equal(
  advertisingBumpRoute.indexOf("if (request.method === \"POST\")") <
    advertisingBumpRoute.indexOf("await ensureBillingSchema(env)"),
  true,
  "Billing schema setup must be limited to the protected bump mutation.",
);

console.log("Dashboard optional fallback tests passed.");
