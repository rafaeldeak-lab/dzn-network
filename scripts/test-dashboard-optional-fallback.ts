import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

const advancedStatsRoute = source("functions/api/servers/[serverId]/dashboard/advanced-stats.ts");
const warsRoute = source("functions/api/servers/[serverId]/wars/index.ts");
const recentEventsRoute = source("functions/api/sync/recent-events.ts");
const postingDestinationsRoute = source("functions/api/servers/[serverId]/posting-destinations.ts");
const discordChannelsRoute = source("functions/api/servers/[serverId]/discord-channels.ts");
const advertisingBumpRoute = source("functions/api/servers/[serverId]/advertising/bump.ts");
const dashboardSource = source("components/onboarding/dashboard.tsx");

assert.equal(
  advancedStatsRoute.includes("getServerAdvancedShowcasePayload"),
  false,
  "Advanced Stats GET must not reconstruct heavy showcase analytics on demand.",
);
assert.equal(
  advancedStatsRoute.includes("advanced_stats_snapshot_pending"),
  true,
  "Advanced Stats GET must return a controlled pending snapshot state.",
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
  dashboardSource.includes("friendlyAdvancedStatsReason"),
  true,
  "Dashboard must map internal advanced stats reason keys to user-facing copy.",
);
assert.equal(
  dashboardSource.includes("Advanced stats snapshot pending. DZN found ADM logs. Stats will appear after the next readable activity import."),
  true,
  "Dashboard must show friendly copy for pending advanced stats snapshots.",
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
