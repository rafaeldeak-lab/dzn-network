import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  OWNER_SERVER_CATEGORIES,
  PUBLIC_LISTING_TAGS,
  categoryPolicyForPlan,
  normalizeOwnerServerCategory,
  normalizePublicTags,
  sanitizePublicDescription,
} from "../functions/_lib/server-settings";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function includesAll(file: string, snippets: string[]) {
  for (const snippet of snippets) {
    assert.equal(file.includes(snippet), true, `Expected source to include: ${snippet}`);
  }
}

assert.deepEqual(OWNER_SERVER_CATEGORIES.map((category) => category.value), ["pvp", "deathmatch", "pve", "pvp_pve"]);
assert.equal(normalizeOwnerServerCategory("PvP Only"), "pvp");
assert.equal(normalizeOwnerServerCategory("Death Match"), "deathmatch");
assert.equal(normalizeOwnerServerCategory("PvE"), "pve");
assert.equal(normalizeOwnerServerCategory("Hybrid"), "pvp_pve");
assert.equal(normalizeOwnerServerCategory("hardcore"), null);

assert.equal(categoryPolicyForPlan("free", "active").cooldownDays, 30);
assert.equal(categoryPolicyForPlan("starter", "active").monthlyLimit, 1);
assert.equal(categoryPolicyForPlan("pro", "active").cooldownDays, 7);
assert.equal(categoryPolicyForPlan("partner", "trialing").monthlyLimit, 2);
assert.equal(categoryPolicyForPlan("pro", "canceled").cooldownDays, 30);

const validTags = normalizePublicTags(["KOS", "Modded", "Trader / Economy", "KOS"]);
assert.equal(validTags.ok, true);
if (validTags.ok) assert.deepEqual(validTags.value, ["KOS", "Modded", "Trader / Economy"]);
assert.equal(normalizePublicTags(PUBLIC_LISTING_TAGS.slice(0, 9)).ok, false);
assert.equal(normalizePublicTags(["Not A Real Tag"]).ok, false);

assert.equal(sanitizePublicDescription("<script>alert(1)</script> A clean public description for a DZN server listing that is long enough."), "A clean public description for a DZN server listing that is long enough.");
assert.equal(sanitizePublicDescription("javascript:alert(1) A clean public description for a DZN server listing that is long enough."), false);

for (const path of [
  "app/dashboard/server-settings/page.tsx",
  "components/onboarding/server-settings-page.tsx",
  "functions/api/servers/[serverId]/settings.ts",
  "functions/api/servers/[serverId]/settings/category.ts",
  "functions/api/servers/[serverId]/settings/tags.ts",
  "functions/api/servers/[serverId]/settings/listing.ts",
]) {
  assert.equal(existsSync(path), true, `Expected server settings file: ${path}`);
}

const migration = source("migrations/0041_owner_server_settings.sql");
includesAll(migration, [
  "category_cooldown_until",
  "category_effective_at",
  "listing_visibility TEXT DEFAULT 'public'",
  "CREATE TABLE IF NOT EXISTS server_category_change_events",
  "CREATE TABLE IF NOT EXISTS server_listing_change_events",
]);
assert.equal(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats|ALTER\s+TABLE\s+player_profiles/i.test(migration), false, "Server settings migration must be additive and must not touch player stats/profile tables.");

const eventHubMigration = source("migrations/0042_owner_event_hub.sql");
includesAll(eventHubMigration, [
  "CREATE TABLE IF NOT EXISTS server_discord_channel_settings",
  "channel_type TEXT NOT NULL",
  "default_event",
  "event_live_scoreboard",
  "event_results",
  "UNIQUE(linked_server_id, channel_type)",
]);
assert.equal(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats|ALTER\s+TABLE\s+player_profiles|TOKEN_ENCRYPTION_KEY|bot_access_token/i.test(eventHubMigration), false, "Event channel migration must be additive and must not touch player/token tables.");

const settingsLib = source("functions/_lib/server-settings.ts");
includesAll(settingsLib, [
  "Category cooldowns protect fair competition and cannot be bypassed by upgrading.",
  "CATEGORY_COOLDOWN_ACTIVE",
  "CATEGORY_MONTHLY_LIMIT_REACHED",
  "CATEGORY_LOCKED_DURING_EVENT",
  "competitive_event_servers",
  "ctf_match_participants",
  "server_category_change_events",
  "server_listing_change_events",
  "rebuildPublicCacheForServer",
  "getSavedDiscordEventChannelSummary",
  "discordEventChannels",
]);
assert.equal(settingsLib.includes("TOKEN_ENCRYPTION_KEY"), false, "Server settings must not touch token encryption.");

const settingsRoute = source("functions/api/servers/[serverId]/settings.ts");
includesAll(settingsRoute, ["onRequestGet", "onRequestPatch", "NOT_AUTHENTICATED", "readOwnerServerSettings", "updateServerCategory"]);
const categoryRoute = source("functions/api/servers/[serverId]/settings/category.ts");
includesAll(categoryRoute, ["onRequestPost", "NOT_AUTHENTICATED", "updateServerCategory"]);
const tagsRoute = source("functions/api/servers/[serverId]/settings/tags.ts");
includesAll(tagsRoute, ["onRequestPost", "NOT_AUTHENTICATED", "updateServerTags"]);
const listingRoute = source("functions/api/servers/[serverId]/settings/listing.ts");
includesAll(listingRoute, ["onRequestPost", "NOT_AUTHENTICATED", "updateServerListing"]);
const discordChannelsRoute = source("functions/api/servers/[serverId]/settings/discord-channels/index.ts");
includesAll(discordChannelsRoute, ["onRequestPost", "NOT_AUTHENTICATED", "saveOwnerDiscordEventChannels"]);
const discordChannelsTestRoute = source("functions/api/servers/[serverId]/settings/discord-channels/test.ts");
includesAll(discordChannelsTestRoute, ["onRequestPost", "NOT_AUTHENTICATED", "testOwnerDiscordEventChannel"]);
const discordChannelListRoute = source("functions/api/servers/[serverId]/discord/channels.ts");
includesAll(discordChannelListRoute, ["onRequestGet", "NOT_AUTHENTICATED", "listOwnerDiscordEventChannels"]);

const dashboard = source("components/onboarding/dashboard.tsx");
includesAll(dashboard, [
  "serverSettingsHref(server.id",
  "/dashboard/server-settings",
  "/dashboard/events",
  "Link href=\"/setup\"",
  "Set Category",
  "Open Event Hub",
]);
assert.equal(/Server Settings[\s\S]{0,120}href="\/setup"/.test(dashboard), false, "Dashboard Server Settings buttons must not route to setup.");

const settingsUi = source("components/onboarding/server-settings-page.tsx");
includesAll(settingsUi, [
  "Manage how your server appears across DZN",
  "Open Setup Page",
  "View Public Page",
  "Discord Event Channels",
  "Choose where DZN should post event announcements, live scoreboards, and final results for this server.",
  "Default Event Channel",
  "Live Event Scoreboard Channel",
  "Event Results Channel",
  "Refresh Discord Channels",
  "Save Event Channels",
  "Test Bot Message",
  "View Channel, Send Messages, Embed Links, Read Message History",
  "Change server category?",
  "Hidden servers keep ADM sync running",
  "Category cooldowns protect fair competition",
]);

for (const publicFile of ["functions/api/public/servers.ts", "functions/api/public/home-stats.ts"]) {
  const file = source(publicFile);
  assert.equal(file.includes("listing_visibility"), true, `${publicFile} should respect hidden public listings.`);
}
