import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { canManageDiscordGuild } from "../functions/_lib/discord";
import { evaluateDiscordChannelPermissionsForTest } from "../functions/_lib/discord-posting";

assert.equal(canManageDiscordGuild({ owner: true, permissions: "0" }), true);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "8" }), true);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "1099511627784" }), true);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "0" }), false);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "not-a-number" }), false);

const permissionOne = BigInt(1);
const administrator = permissionOne << BigInt(3);
const viewChannel = permissionOne << BigInt(10);
const sendMessages = permissionOne << BigInt(11);
const embedLinks = permissionOne << BigInt(14);
const readHistory = permissionOne << BigInt(16);
const requiredPostingPermissions = viewChannel | sendMessages | embedLinks | readHistory;
const guildId = "guild-1";
const botUserId = "bot-1";
const botRoleId = "bot-role";

const administratorResult = evaluateDiscordChannelPermissionsForTest({
  guildId,
  botUserId,
  botRoleIds: [botRoleId],
  botRoleNames: ["DZN Bot"],
  basePermissions: administrator,
});
assert.equal(administratorResult.can_post, true);
assert.equal(administratorResult.permission_source, "administrator");
assert.equal(administratorResult.missing_permissions.length, 0);
assert.equal(administratorResult.diagnostics.bot_has_administrator, true);

const guildRoleResult = evaluateDiscordChannelPermissionsForTest({
  guildId,
  botUserId,
  botRoleIds: [botRoleId],
  basePermissions: requiredPostingPermissions,
});
assert.equal(guildRoleResult.can_post, true);
assert.equal(guildRoleResult.missing_permissions.length, 0);

const channelDenyResult = evaluateDiscordChannelPermissionsForTest({
  guildId,
  botUserId,
  botRoleIds: [botRoleId],
  basePermissions: requiredPostingPermissions,
  channelPermissionOverwrites: [
    { id: botRoleId, type: 0, allow: "0", deny: sendMessages.toString() },
  ],
});
assert.equal(channelDenyResult.can_post, false);
assert.deepEqual(channelDenyResult.missing_permissions, ["Send Messages"]);
assert.equal(channelDenyResult.permission_source, "channel_overwrite");

const memberAllowResult = evaluateDiscordChannelPermissionsForTest({
  guildId,
  botUserId,
  botRoleIds: [botRoleId],
  basePermissions: requiredPostingPermissions,
  channelPermissionOverwrites: [
    { id: botRoleId, type: 0, allow: "0", deny: sendMessages.toString() },
    { id: botUserId, type: 1, allow: sendMessages.toString(), deny: "0" },
  ],
});
assert.equal(memberAllowResult.can_post, true);
assert.equal(memberAllowResult.permission_source, "member_overwrite");
assert.equal(memberAllowResult.missing_permissions.length, 0);

const categoryDenyResult = evaluateDiscordChannelPermissionsForTest({
  guildId,
  botUserId,
  botRoleIds: [botRoleId],
  basePermissions: requiredPostingPermissions,
  categoryPermissionOverwrites: [
    { id: botRoleId, type: 0, allow: "0", deny: sendMessages.toString() },
  ],
});
assert.equal(categoryDenyResult.can_post, false);
assert.deepEqual(categoryDenyResult.missing_permissions, ["Send Messages"]);
assert.equal(categoryDenyResult.permission_source, "category_overwrite");

const missingSendOnlyResult = evaluateDiscordChannelPermissionsForTest({
  guildId,
  botUserId,
  botRoleIds: [botRoleId],
  basePermissions: viewChannel | embedLinks | readHistory,
});
assert.equal(missingSendOnlyResult.can_post, false);
assert.deepEqual(missingSendOnlyResult.missing_permissions, ["Send Messages"]);

const botStatusSource = readFileSync("functions/api/discord/bot-status.ts", "utf8");
assert.equal(botStatusSource.includes("DISCORD_BOT_TOKEN"), true);
assert.equal(botStatusSource.includes("fetchDiscordPostingChannels"), true);
assert.equal(botStatusSource.includes("bot_not_in_guild"), true);
assert.equal(botStatusSource.includes("permissions\", \"8\""), true);
assert.equal(botStatusSource.includes("channels_fetched_count"), true);
assert.equal(botStatusSource.includes("postable_channels_count"), true);
assert.equal(botStatusSource.includes("canManageDiscordGuild"), true);

const setupWizardSource = readFileSync("components/onboarding/setup-wizard.tsx", "utf8");
assert.equal(setupWizardSource.includes("Add DZN Bot"), true);
assert.equal(setupWizardSource.includes("Verify Bot Connection"), true);
assert.equal(setupWizardSource.includes("Connecting a Discord server lets DZN know which server you own"), true);
assert.equal(setupWizardSource.includes("Installing the DZN bot lets DZN read channels"), true);
assert.equal(setupWizardSource.includes("discordBotConnected"), true);
assert.equal(setupWizardSource.includes("discordChannelsAvailable"), true);
assert.equal(setupWizardSource.includes("DZN Bot is not installed in this Discord server yet"), true);

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes("function selectChannel"), true);
assert.equal(dashboardSource.includes("setMessage(\"\")"), true);
assert.equal(dashboardSource.includes("selectedChannelPermission"), true);
assert.equal(dashboardSource.includes("loadDiscordChannelCache"), true);
assert.equal(dashboardSource.includes("saveDiscordChannelCache"), true);
assert.equal(dashboardSource.includes("last_channel_fetch_success_at"), true);
assert.equal(dashboardSource.includes("Connected (last known)"), true);
assert.equal(dashboardSource.includes("Last successful channel refresh"), true);
assert.equal(dashboardSource.includes("Saved auto-post setups continue running even if channel refresh temporarily fails."), true);
assert.equal(dashboardSource.includes("Recheck Channels"), true);
assert.equal(dashboardSource.includes("Request failed: 503"), false);
assert.equal(dashboardSource.includes("DZN Bot can post in this channel."), true);
assert.equal(dashboardSource.includes("DZN Bot has Administrator and can post in this channel."), true);
assert.equal(dashboardSource.includes("DZN can see this channel, but cannot post here yet."), true);
assert.equal(dashboardSource.includes("Selected channel debug"), true);
assert.equal(dashboardSource.includes("missing_permissions:"), true);
assert.equal(dashboardSource.includes("bot_has_administrator:"), true);
assert.equal(dashboardSource.includes("permission source:"), true);
assert.equal(dashboardSource.includes("base guild permissions:"), true);
assert.equal(dashboardSource.includes("effective channel permissions:"), true);
assert.equal(dashboardSource.includes("Recheck Selected Channel"), true);
assert.equal(dashboardSource.includes("Make sure you select the DZN Bot role in Discord channel permissions, not @everyone"), true);
assert.equal(dashboardSource.includes("Channel or category overrides may still block the bot"), true);
assert.equal(dashboardSource.includes("Run Auto Post Dispatcher Now"), true);
assert.equal(dashboardSource.includes("Run Now Result"), true);
assert.equal(dashboardSource.includes("Processed"), true);
assert.equal(dashboardSource.includes("Sent"), true);
assert.equal(dashboardSource.includes("old hash"), true);
assert.equal(dashboardSource.includes("new hash"), true);
assert.equal(dashboardSource.includes("dispatch diagnostics"), true);
assert.equal(dashboardSource.includes("Last dispatch status"), true);
assert.equal(dashboardSource.includes("last_dispatch_status"), true);
assert.equal(dashboardSource.includes("discord_message_id"), true);
assert.equal(dashboardSource.includes("queued job count"), true);
assert.equal(dashboardSource.includes("last_payload_hash"), true);
assert.equal(dashboardSource.includes("DashboardTabKey"), true);
assert.equal(dashboardSource.includes("Overview"), true);
assert.equal(dashboardSource.includes("Sync Health"), true);
assert.equal(dashboardSource.includes("Public Listing"), true);
assert.equal(dashboardSource.includes("Billing & Boosts"), true);
assert.equal(dashboardSource.includes("Settings & Danger"), true);
assert.equal(dashboardSource.includes("DashboardStatTile"), true);
assert.equal(dashboardSource.includes("activeTab === \"overview\""), true);
assert.equal(dashboardSource.includes("activeTab === \"sync-health\""), true);
assert.equal(dashboardSource.includes("activeTab === \"public-listing\""), true);
assert.equal(dashboardSource.includes("activeTab === \"billing\""), true);
assert.equal(dashboardSource.includes("activeTab === \"discord-posts\""), true);
assert.equal(dashboardSource.includes("activeTab === \"settings-danger\""), true);
assert.equal(dashboardSource.includes("setActiveTab(\"public-listing\")"), true);
assert.equal(dashboardSource.includes("setActiveTab(\"sync-health\")"), true);

const autoPostRunNowSource = readFileSync("functions/api/servers/[serverId]/auto-posts/run-now.ts", "utf8");
assert.equal(autoPostRunNowSource.includes("dispatchDiscordPostsForGuild"), true);
assert.equal(autoPostRunNowSource.includes("active DZN subscription"), true);
assert.equal(autoPostRunNowSource.includes("force: true"), true);

const discordChannelsEndpointSource = readFileSync("functions/api/servers/[serverId]/discord-channels.ts", "utf8");
assert.equal(discordChannelsEndpointSource.includes("channel_fetch_unavailable"), true);
assert.equal(discordChannelsEndpointSource.includes("Existing saved setups remain active"), true);
assert.equal(discordChannelsEndpointSource.includes("retryable"), true);
assert.equal(discordChannelsEndpointSource.includes("status: 503"), true);
assert.equal(discordChannelsEndpointSource.includes("last_fetch_success_at"), true);
assert.equal(discordChannelsEndpointSource.includes("using_cached_channel_state"), true);

const onboardingApiSource = readFileSync("components/onboarding/api.ts", "utf8");
assert.equal(onboardingApiSource.includes("getDiscordPostingChannels"), true);
assert.equal(onboardingApiSource.includes("!response.ok && !data.diagnostics"), true);

console.log("Discord guild permission tests passed.");
