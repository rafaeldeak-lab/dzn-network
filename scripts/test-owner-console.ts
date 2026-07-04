import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizePlatformOwnerUser,
  isPlatformOwnerDiscordId,
  parsePlatformOwnerDiscordIds,
} from "../functions/_lib/platform-owner";
import {
  buildOwnerResourceState,
  getOwnerLifecycleLabel,
  mapOwnerServerRowForTest,
} from "../functions/_lib/owner-console";
import {
  buildOwnerDiscordPreviewEmbed,
  sanitizeOwnerDiscordChannelMappingInput,
} from "../functions/_lib/owner-discord-control";

const ownerEnv = { DZN_PLATFORM_OWNER_DISCORD_IDS: "111111111111111111, 222222222222222222 , not-an-id" };

assert.deepEqual(parsePlatformOwnerDiscordIds(ownerEnv.DZN_PLATFORM_OWNER_DISCORD_IDS), [
  "111111111111111111",
  "222222222222222222",
]);
assert.equal(isPlatformOwnerDiscordId(ownerEnv, "111111111111111111"), true);
assert.equal(isPlatformOwnerDiscordId(ownerEnv, "222222222222222222"), true);
assert.equal(isPlatformOwnerDiscordId(ownerEnv, "333333333333333333"), false);

assert.deepEqual(authorizePlatformOwnerUser(ownerEnv, null), {
  ok: false,
  status: 401,
  reason: "unauthorized",
});
assert.deepEqual(authorizePlatformOwnerUser(ownerEnv, { discord_id: "333333333333333333" }), {
  ok: false,
  status: 403,
  reason: "forbidden",
});
assert.equal(authorizePlatformOwnerUser(ownerEnv, { discord_id: "111111111111111111" }).ok, true);

const discordPreview = buildOwnerDiscordPreviewEmbed(
  { DZN_DISCORD_NOTIFICATIONS_ENABLED: "false" },
  { type: "new_server", title: "Custom owner preview", description: "Preview text only", colorHex: "#22d3ee" },
);
assert.equal(discordPreview.type, "new_server");
assert.equal(discordPreview.title, "Custom owner preview");
assert.equal(discordPreview.previewOnly, true);
assert.equal(discordPreview.sent, false);
assert.equal(discordPreview.footer, "Preview only - not sent");
assert.doesNotMatch(JSON.stringify(discordPreview), /\btoken\b|\bsecret\b|\bwebhook\b|\bTOKEN_ENCRYPTION_KEY\b/i);

const fallbackDiscordPreview = buildOwnerDiscordPreviewEmbed({}, { type: "unknown" });
assert.equal(fallbackDiscordPreview.type, "weekly_recap");
assert.equal(fallbackDiscordPreview.sent, false);

assert.deepEqual(sanitizeOwnerDiscordChannelMappingInput({
  slot: "announcements",
  guildId: "123456789012345678",
  channelId: "234567890123456789",
}), {
  slot: "announcements",
  guildId: "123456789012345678",
  channelId: "234567890123456789",
});
assert.deepEqual(sanitizeOwnerDiscordChannelMappingInput({
  slot: "bad-slot",
  guildId: "not-a-guild",
  channelId: "bad-channel",
}), {
  slot: null,
  guildId: null,
  channelId: null,
});

const activeResources = buildOwnerResourceState({ lifecycle_status: "active_live", status: "live", listing_visibility: "public" });
assert.equal(activeResources.admSyncEnabled, true);
assert.equal(activeResources.metadataRefreshEnabled, true);
assert.equal(activeResources.playerCountPollingEnabled, true);
assert.equal(activeResources.discordPostingEnabled, true);
assert.equal(activeResources.serverWarsEligible, true);
assert.equal(activeResources.consumingScheduledResources, true);

const archivedResources = buildOwnerResourceState({ lifecycle_status: "archived_hidden", status: "archived", listing_visibility: "hidden" });
assert.equal(archivedResources.admSyncEnabled, false);
assert.equal(archivedResources.metadataRefreshEnabled, false);
assert.equal(archivedResources.playerCountPollingEnabled, false);
assert.equal(archivedResources.discordPostingEnabled, false);
assert.equal(archivedResources.serverWarsEligible, false);
assert.equal(archivedResources.excludedFromActiveSync, true);
assert.equal(archivedResources.skippedReason, "skipped_archived");

const legacyResources = buildOwnerResourceState({ lifecycle_status: "legacy_offline", status: "inactive", listing_visibility: "public" });
assert.equal(legacyResources.consumingScheduledResources, false);
assert.equal(legacyResources.excludedFromActiveSync, true);
assert.equal(legacyResources.skippedReason, "skipped_legacy");

const tokenResources = buildOwnerResourceState({ lifecycle_status: "token_needs_resave", status: "live", listing_visibility: "public" });
assert.equal(tokenResources.admSyncEnabled, false);
assert.equal(tokenResources.metadataRefreshEnabled, false);
assert.equal(tokenResources.playerCountPollingEnabled, false);
assert.equal(tokenResources.skippedReason, "skipped_token_needs_resave");

assert.equal(getOwnerLifecycleLabel("active_live"), "Live sync active");
assert.equal(getOwnerLifecycleLabel("legacy_offline"), "Legacy offline - historical stats preserved");
assert.equal(getOwnerLifecycleLabel("archived_hidden"), "Archived / hidden - active sync disabled");

const nuketown = mapOwnerServerRowForTest({
  id: "server-nuketown",
  server_name: "NukeTown DEATHMATCH",
  public_slug: "nuketown",
  nitrado_service_id: "18765761",
  lifecycle_status: "active_live",
  status: "live",
  listing_visibility: "public",
  current_player_count: 1,
  max_player_count: 10,
  latest_adm_file: "DayZServer_PS4_x64_2026-07-01_18-02-29.ADM",
});
assert.equal(nuketown.knownRole, "nuketown");
assert.equal(nuketown.lifecycleStatus, "active_live");
assert.equal(nuketown.resource.consumingScheduledResources, true);

const maskedOwner = mapOwnerServerRowForTest({
  id: "server-owner-mask",
  server_name: "Owner Mask Test",
  owner_discord_id: "111111111111111111",
  lifecycle_status: "active_live",
  status: "live",
});
assert.equal(maskedOwner.owner.discordId, "1111...1111");
assert.notEqual(maskedOwner.owner.discordId, "111111111111111111");

const warlords = mapOwnerServerRowForTest({
  id: "server-warlords",
  server_name: "Warlords PvP",
  nitrado_service_id: "900002",
  lifecycle_status: "archived_hidden",
  status: "archived",
  listing_visibility: "hidden",
});
assert.equal(warlords.knownRole, "warlords");
assert.equal(warlords.lifecycleStatus, "archived_hidden");
assert.equal(warlords.resource.excludedFromActiveSync, true);

const pandora = mapOwnerServerRowForTest({
  id: "server-pandora",
  server_name: "PANDORA",
  public_slug: "pandora",
  lifecycle_status: "legacy_offline",
  status: "inactive",
  listing_visibility: "public",
  total_kills: 42,
  build_score: 12,
});
assert.equal(pandora.knownRole, "pandora");
assert.equal(pandora.lifecycleStatus, "legacy_offline");
assert.equal(pandora.stats.totalKills, 42);
assert.equal(pandora.stats.buildScore, 12);
assert.equal(pandora.resource.consumingScheduledResources, false);

const ownerPageFunction = readFileSync("functions/owner.ts", "utf8");
assert.match(ownerPageFunction, /requirePlatformOwner/);
assert.match(ownerPageFunction, /mode:\s*"page"/);
assert.match(ownerPageFunction, /methodNotAllowed/);

for (const file of [
  "functions/api/owner/overview.ts",
  "functions/api/owner/servers.ts",
  "functions/api/owner/servers/[serverId].ts",
  "functions/api/owner/audit-log.ts",
]) {
  const source = readFileSync(file, "utf8");
  assert.match(source, /requirePlatformOwner/, `${file} must require platform-owner auth`);
  assert.match(source, /onRequestGet/, `${file} must expose a read-only GET`);
  assert.match(source, /methodNotAllowed/, `${file} must reject write methods`);
}

for (const file of [
  "functions/api/owner/discord/overview.ts",
  "functions/api/owner/discord/post-types.ts",
  "functions/api/owner/discord/channels.ts",
  "functions/api/owner/discord/options.ts",
  "functions/api/owner/discord/templates.ts",
]) {
  const source = readFileSync(file, "utf8");
  assert.match(source, /requirePlatformOwner/, `${file} must require platform-owner auth`);
  assert.match(source, /onRequestGet/, `${file} must expose a read-only GET`);
  assert.match(source, /methodNotAllowed/, `${file} must reject write methods`);
  assert.doesNotMatch(source, /discord-posting|sendDiscord|sendOrEdit|webhook/i, `${file} must not use live Discord send paths`);
}

const previewEmbedApiSource = readFileSync("functions/api/owner/discord/preview-embed.ts", "utf8");
assert.match(previewEmbedApiSource, /requirePlatformOwner/);
assert.match(previewEmbedApiSource, /onRequestPost/);
assert.match(previewEmbedApiSource, /sent:\s*false/);
assert.match(previewEmbedApiSource, /preview_only/);
assert.doesNotMatch(previewEmbedApiSource, /discord-posting|sendDiscord|sendOrEdit|fetch\s*\(|webhook/i);

for (const file of [
  "functions/api/owner/discord/channel-mappings.ts",
  "functions/api/owner/discord/channel-mappings/[slot]/disable.ts",
  "functions/api/owner/discord/channel-mappings/[slot]/permission-check.ts",
  "functions/api/owner/discord/test-embed.ts",
  "functions/api/owner/discord/audit-log.ts",
]) {
  const source = readFileSync(file, "utf8");
  assert.match(source, /requirePlatformOwner/, `${file} must require platform-owner auth`);
  assert.doesNotMatch(source, /DISCORD_BOT_TOKEN|DISCORD_CLIENT_SECRET|TOKEN_ENCRYPTION_KEY|SESSION_SECRET|encrypted_token|discord_webhook_url/i, `${file} must not return or reference secret values`);
}

const channelMappingsApiSource = readFileSync("functions/api/owner/discord/channel-mappings.ts", "utf8");
assert.match(channelMappingsApiSource, /onRequestGet/);
assert.match(channelMappingsApiSource, /onRequestPost/);
assert.match(channelMappingsApiSource, /productionSendingDisabled:\s*true/);
assert.match(channelMappingsApiSource, /autoPostingEnabled:\s*false/);

const permissionCheckApiSource = readFileSync("functions/api/owner/discord/channel-mappings/[slot]/permission-check.ts", "utf8");
assert.match(permissionCheckApiSource, /runOwnerDiscordPermissionCheck/);
assert.match(permissionCheckApiSource, /autoPostingEnabled:\s*false/);

const testEmbedApiSource = readFileSync("functions/api/owner/discord/test-embed.ts", "utf8");
assert.match(testEmbedApiSource, /sendOwnerDiscordTestEmbed/);
assert.match(testEmbedApiSource, /confirmation/);
assert.match(testEmbedApiSource, /productionSendingDisabled:\s*true/);
assert.match(testEmbedApiSource, /autoPostingEnabled:\s*false/);

const ownerDataSource = readFileSync("functions/_lib/owner-console.ts", "utf8");
assert.doesNotMatch(ownerDataSource, /\bnitrado_connections\b/i);
assert.doesNotMatch(ownerDataSource, /\bencrypted_token\b|\btoken_iv\b|\btoken_auth_tag\b|\bDISCORD_BOT_TOKEN\b|\bSESSION_SECRET\b/i);
assert.doesNotMatch(ownerDataSource, /\bfetch\s*\(/i);
assert.match(ownerDataSource, /server_sync_state/);
assert.match(ownerDataSource, /adm_sync_state/);
assert.match(ownerDataSource, /server_public_cache/);

const ownerDiscordSource = readFileSync("functions/_lib/owner-discord-control.ts", "utf8");
assert.match(ownerDiscordSource, /readDznFeatureFlags/);
assert.match(ownerDiscordSource, /discordNotificationsEnabled/);
assert.match(ownerDiscordSource, /botTokenPresent/);
assert.match(ownerDiscordSource, /productionSendingDisabled:\s*true/);
assert.match(ownerDiscordSource, /Preview only - not sent/);
assert.match(ownerDiscordSource, /OWNER_DISCORD_PREVIEW_OPTIONS/);
assert.match(ownerDiscordSource, /getOwnerDiscordOptions/);
assert.match(ownerDiscordSource, /All Network \/ Network-wide/);
assert.match(ownerDiscordSource, /New server joined DZN/);
assert.match(ownerDiscordSource, /Daily network recap/);
assert.match(ownerDiscordSource, /Longest kill update/);
assert.match(ownerDiscordSource, /Milestone reached/);
assert.match(ownerDiscordSource, /Free\/Pro\/Premium promotion post/);
assert.match(ownerDiscordSource, /Valid Discord Server ID is required/);
assert.match(ownerDiscordSource, /saveOwnerDiscordChannelMapping/);
assert.match(ownerDiscordSource, /runOwnerDiscordPermissionCheck/);
assert.match(ownerDiscordSource, /sendOwnerDiscordTestEmbed/);
assert.match(ownerDiscordSource, /confirmation !== "SEND_TEST_EMBED"/);
assert.match(ownerDiscordSource, /test_embed_preview_generated/);
assert.match(ownerDiscordSource, /test_embed_sent/);
assert.match(ownerDiscordSource, /auto_posting_enabled:\s*false/);
assert.match(ownerDiscordSource, /discord_owner_audit_log/);
assert.doesNotMatch(ownerDiscordSource, /TOKEN_ENCRYPTION_KEY|SESSION_SECRET|CLOUDFLARE/i);
assert.doesNotMatch(ownerDiscordSource, /DZN_DISCORD_NOTIFICATIONS_ENABLED\s*=\s*["']true["']|discordNotificationsEnabled\s*=\s*true/i);

const phase2aMigration = readFileSync("migrations/0055_discord_control_phase_2a.sql", "utf8");
assert.match(phase2aMigration, /CREATE TABLE IF NOT EXISTS discord_channel_mappings/);
assert.match(phase2aMigration, /CREATE TABLE IF NOT EXISTS discord_owner_audit_log/);
assert.doesNotMatch(phase2aMigration, /DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|CREATE TABLE IF NOT EXISTS player_stats|ALTER TABLE\s+player_profiles/i);

const ownerUiSource = readFileSync("components/owner/owner-console.tsx", "utf8");
for (const label of [
  "Live sync active",
  "Token needs re-save",
  "Legacy offline - historical stats preserved",
  "Archived / hidden - active sync disabled",
  "Discord Control",
  "DZN Discord command centre",
  "Post Preview Builder",
  "What do you want to post?",
  "Which DZN server is this about?",
  "Where should this post?",
  "Post destinations",
  "Discord Server",
  "Discord Server ID",
  "Discord Server Name",
  "Discord Channel ID",
  "Friendly channel name",
  "What is a Discord Server ID?",
  "Discord internally calls a server a guild",
  "All Network / Network-wide",
  "Not configured yet",
  "Preview Embed",
  "Check permissions",
  "SEND_TEST_EMBED",
  "Send Test Embed",
  "Discord Audit Log",
  "Production Discord posting",
  "Preview only - not sent",
  "Manual test send only",
  "No owner actions recorded yet.",
  "Phase 2",
  "Coming soon - read-only for now",
]) {
  assert.match(ownerUiSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(ownerUiSource, /\bGuild ID\b|\bGuild name\b|Channel Mapping Setup|Embed Preview Builder/);
assert.match(ownerUiSource, /testConfirmation !== "SEND_TEST_EMBED"/);
assert.match(ownerUiSource, /selectedDestinationConfigured/);
assert.match(ownerUiSource, /selectedDestinationPermissionOk/);
assert.doesNotMatch(ownerUiSource, /\bencrypted_token\b|\btoken_iv\b|\btoken_auth_tag\b|\bDISCORD_BOT_TOKEN\b|\bTOKEN_ENCRYPTION_KEY\b/i);
assert.match(ownerUiSource, /dzn-owner-console-active/, "Owner console must set a route-scoped app-shell class.");
assert.match(ownerUiSource, /h-dvh overflow-hidden/, "Owner console shell must lock to viewport height.");
assert.match(ownerUiSource, /lg:grid-cols-\[240px_minmax\(0,1fr\)\]/, "Owner console should keep a compact fixed desktop sidebar.");
assert.match(ownerUiSource, /h-full min-h-0/, "Owner console panels must use constrained internal height.");
assert.match(ownerUiSource, /overflow-auto/, "Large owner console lists should use internal scrolling.");

const globalsSource = readFileSync("app/globals.css", "utf8");
assert.match(globalsSource, /body\.dzn-owner-console-active/);
assert.match(globalsSource, /overflow:\s*hidden/);
assert.match(globalsSource, /body\.dzn-owner-console-active \.dzn-beta-ticker/);

const betaTickerSource = readFileSync("components/site/beta-ticker.tsx", "utf8");
assert.match(betaTickerSource, /usePathname/);
assert.match(betaTickerSource, /pathname === "\/owner" \|\| pathname\.startsWith\("\/owner\/"\)/);
assert.match(betaTickerSource, /if \(isOwnerRoute \|\| !mounted \|\| hidden\) return null;/);

const pageSource = readFileSync("app/owner/page.tsx", "utf8");
assert.match(pageSource, /OwnerConsole/);

const packageJson = readFileSync("package.json", "utf8");
assert.match(packageJson, /node scripts\/patch-pages-routes\.mjs/, "Build must patch Cloudflare Pages routes for owner page protection.");

const routesPatch = readFileSync("scripts/patch-pages-routes.mjs", "utf8");
assert.match(routesPatch, /"\/owner"/, "Cloudflare Pages routes must include the exact /owner page.");
assert.match(routesPatch, /"\/owner\/\*"/, "Cloudflare Pages routes must include nested owner routes.");
assert.match(routesPatch, /"\/api\/\*"/, "Cloudflare Pages routes must preserve API function routing.");

console.log("Owner console read-only access and data contract checks passed.");
