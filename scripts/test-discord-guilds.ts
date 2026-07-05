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
assert.equal(setupWizardSource.includes("mergeChecksWithBotStatus"), true);
assert.equal(setupWizardSource.includes("status.guild_id !== selectedGuildId"), true);
assert.equal(setupWizardSource.includes("Bot token readable"), true);
assert.equal(setupWizardSource.includes("VERIFICATION_STAGES"), true);
assert.equal(setupWizardSource.includes("verificationProgress"), true);
assert.equal(setupWizardSource.includes("Current step:"), true);
assert.equal(setupWizardSource.includes("Run the test to confirm DZN can read DISCORD_BOT_TOKEN at runtime."), true);
assert.equal(setupWizardSource.includes("Use either Method A or Method B. You do not need both."), true);
assert.equal(setupWizardSource.includes("Preferred when you already know the Service ID."), true);
assert.equal(setupWizardSource.includes("Use this only if you do not know the Service ID."), true);
assert.equal(setupWizardSource.includes("DZN only needs the service permission"), true);
assert.equal(setupWizardSource.includes("The same Nitrado long-life token can be reused for multiple services"), true);
assert.equal(setupWizardSource.includes("DZN encrypts it and never shows it again."), true);
assert.equal(setupWizardSource.includes("ADM logs found. Stats will appear after the next readable activity import."), true);
assert.equal(setupWizardSource.includes("admBackfill"), true);
assert.equal(setupWizardSource.includes("Processing newest ADM logs"), true);
assert.equal(setupWizardSource.includes("Newest visible file"), true);
assert.equal(setupWizardSource.includes("Latest processed ADM file"), true);
assert.equal(setupWizardSource.includes("Server Category"), true);
assert.equal((setupWizardSource.match(/Server Category/g) ?? []).length, 1, "Setup should expose one primary category selector.");

const onboardingTestSource = readFileSync("functions/api/onboarding/test.ts", "utf8");
assert.equal(onboardingTestSource.includes("verifyDiscordBotForSetup"), true);
assert.equal(onboardingTestSource.includes("linkedServer.guild_id"), true);
assert.equal(onboardingTestSource.includes("discordBotGuildId"), true);
assert.equal(onboardingTestSource.includes("discordBotCheckedAt"), true);
assert.equal(onboardingTestSource.includes("discordBotErrorMessage"), true);
assert.equal(onboardingTestSource.includes("Token encryption key is missing in production. Add TOKEN_ENCRYPTION_KEY in Cloudflare Pages and redeploy."), true);
assert.equal(onboardingTestSource.includes("Your saved Nitrado token cannot be decrypted. Re-save your Nitrado long-life token."), true);
assert.equal(onboardingTestSource.includes("DISCORD_BOT_TOKEN is missing from Cloudflare Pages production. Add or rotate it, redeploy Pages, then click Verify Bot Connection."), true);
assert.equal(onboardingTestSource.includes("planAdmBackfillJobsForServer"), true);
assert.equal(onboardingTestSource.includes("triggerType: \"setup\""), true);
assert.equal(onboardingTestSource.includes("skipMetadataRefresh: true"), true);
assert.equal(onboardingTestSource.includes("admBackfill"), true);

const tokenValidationSource = readFileSync("functions/api/nitrado/validate-token.ts", "utf8");
assert.equal(tokenValidationSource.includes("storePendingNitradoToken"), true);
assert.equal(tokenValidationSource.includes("classifyTokenSaveError"), true);
assert.equal(tokenValidationSource.includes("Token encryption key is missing in production. Add TOKEN_ENCRYPTION_KEY in Cloudflare Pages and redeploy."), true);
assert.equal(tokenValidationSource.includes("Your saved Nitrado token cannot be decrypted. Re-save your Nitrado long-life token."), true);

assert.equal(botStatusSource.includes("DISCORD_BOT_TOKEN is missing from Cloudflare Pages production. Add/rotate it, redeploy Pages, then click Verify Bot Connection."), true);

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes("function selectChannel"), true);
assert.equal(dashboardSource.includes("setMessage(\"\")"), true);
assert.equal(dashboardSource.includes("selectedChannelPermission"), true);
assert.equal(dashboardSource.includes("loadDiscordChannelCache"), true);
assert.equal(dashboardSource.includes("saveDiscordChannelCache"), true);
assert.equal(dashboardSource.includes("last_channel_fetch_success_at"), true);
assert.equal(dashboardSource.includes("Bot status"), true);
assert.equal(dashboardSource.includes("Not checked yet"), true);
assert.equal(dashboardSource.includes("Missing permissions"), true);
assert.equal(dashboardSource.includes("Saved channel — ending"), true);
assert.equal(dashboardSource.includes("Configured channel — ID ending"), true);
assert.equal(dashboardSource.includes("Saved destinations / #"), false);
assert.equal(dashboardSource.includes("#saved-"), false);
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

const eventDiscordChannelsSource = readFileSync("functions/api/servers/[serverId]/discord/channels.ts", "utf8");
assert.equal(eventDiscordChannelsSource.includes("listOwnerDiscordEventChannels"), true);
assert.equal(eventDiscordChannelsSource.includes("NOT_AUTHENTICATED"), true);
assert.equal(eventDiscordChannelsSource.includes("status: 401"), true);
assert.equal(eventDiscordChannelsSource.includes("DISCORD_CHANNELS_UNAVAILABLE"), true);
assert.equal(eventDiscordChannelsSource.includes("status: 200"), true);

const eventHubSource = readFileSync("functions/_lib/event-hub.ts", "utf8");
for (const snippet of [
  "verifyDiscordPostingChannel",
  "linked_servers.nitrado_service_id = ?",
  "linked_servers.public_slug = ?",
  "getCachedDiscordChannelOptions",
  "source: \"cached\"",
  "CHANNEL_NOT_IN_CONNECTED_GUILD",
  "BOT_MISSING_PERMISSIONS",
  "DISCORD_CHANNELS_UNAVAILABLE",
  "DISCORD_TEST_MESSAGE_FAILED",
  "RATE_LIMITED",
  "View Channel",
  "Send Messages",
  "Embed Links",
  "Read Message History",
  "server_discord_channel_settings",
  "event_live_scoreboard",
  "event_results",
  "DZN Event Channel Connected",
]) {
  assert.equal(eventHubSource.includes(snippet), true, `Missing Event Hub Discord snippet: ${snippet}`);
}
assert.equal(eventHubSource.includes("bot_access_token"), false, "Event channel settings must not use legacy per-server bot tokens.");
assert.equal(eventHubSource.includes("TOKEN_ENCRYPTION_KEY"), false, "Event channel settings must not touch Nitrado token encryption.");

const eventSettingsUi = readFileSync("components/onboarding/server-settings-page.tsx", "utf8");
for (const snippet of [
  "Discord Event Channel",
  "Refresh Discord Channels",
  "Save Discord Event Channel",
  "Send Test Event Message",
  "Primary Event Channel",
  "Advanced channel routing",
  "Announcement Channel Optional",
  "Live Scoreboard Channel Optional",
  "Results Channel Optional",
  "Uses Primary Event Channel",
  "Missing bot permissions",
  "discordChannelHelpCopy",
  "void refreshDiscordEventChannels(serverId, false)",
]) {
  assert.equal(eventSettingsUi.includes(snippet), true, `Missing Server Settings event channel UI: ${snippet}`);
}
assert.equal(eventSettingsUi.includes("Default Event Channel"), false, "Owner event settings should not show the old Default Event Channel label.");
assert.equal(eventSettingsUi.includes("Test Bot Message"), false, "Owner event settings should use Send Test Event Message.");

const onboardingApiSource = readFileSync("components/onboarding/api.ts", "utf8");
assert.equal(onboardingApiSource.includes("getDiscordPostingChannels"), true);
assert.equal(onboardingApiSource.includes("!response.ok && !data.diagnostics"), true);

console.log("Discord guild permission tests passed.");
