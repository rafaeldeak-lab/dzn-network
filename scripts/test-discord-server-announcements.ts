import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildBumpEmbed,
  buildFreeListingEmbed,
  buildProListingEmbed,
  buildWeeklySpotlightEmbed,
  sanitizeDiscordAnnouncementText,
  validateDiscordInviteUrl,
} from "../functions/_lib/discord-server-announcements";
import { readDznFeatureFlags } from "../functions/_lib/feature-flags";
import { validatePublicListingInput } from "../functions/_lib/review-moderation";

assert.equal(readDznFeatureFlags({}).discordServerAnnouncementsEnabled, false);
assert.equal(readDznFeatureFlags({ DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: "false" }).discordServerAnnouncementsEnabled, false);
assert.equal(readDznFeatureFlags({ DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: "true" }).discordServerAnnouncementsEnabled, true);

for (const invite of [
  "https://discord.gg/XPaycZqchQ",
  "https://www.discord.gg/XPaycZqchQ",
  "https://discord.com/invite/XPaycZqchQ",
  "https://www.discord.com/invite/XPaycZqchQ",
]) {
  assert.equal(validateDiscordInviteUrl(invite)?.startsWith("https://"), true, `${invite} should be accepted`);
  assert.equal(validatePublicListingInput({ public_discord_invite: invite }).ok, true, `${invite} should be accepted by public listing validation`);
}

for (const invite of [
  "discord.gg/XPaycZqchQ",
  "http://discord.gg/XPaycZqchQ",
  "https://discordapp.com/invite/XPaycZqchQ",
  "https://example.com/invite/XPaycZqchQ",
]) {
  assert.equal(validateDiscordInviteUrl(invite), null, `${invite} should be rejected`);
  assert.equal(validatePublicListingInput({ public_discord_invite: invite }).ok, false, `${invite} should be rejected by public listing validation`);
}

assert.equal(sanitizeDiscordAnnouncementText("@everyone join @here", 200), "everyone join here");

const safeServer = {
  id: "server-nuketown",
  server_name: "@everyone NukeTown DEATHMATCH",
  public_slug: "nuketown",
  public_short_description: "Fast PvP without mass mentions.",
  public_description: "Stored server profile data only.",
  public_discord_invite: "https://discord.gg/XPaycZqchQ",
  current_player_count: 4,
  max_player_count: 10,
  network_rank: 1,
};

const fairnessRule = "Paid promotion does not affect leaderboard rank, review score, kill stats, K/D, crowns, season wins, or gameplay results.";

for (const payload of [
  buildFreeListingEmbed({ server: safeServer }),
  buildProListingEmbed({ server: safeServer }),
  buildBumpEmbed({ server: safeServer, planKey: "free" }),
  buildBumpEmbed({ server: safeServer, planKey: "pro" }),
  buildWeeklySpotlightEmbed({ server: safeServer }),
]) {
  const json = JSON.stringify(payload);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(json.includes("@everyone"), false);
  assert.equal(json.includes("@here"), false);
  assert.match(json, /View DZN Profile/);
  assert.match(json, /View Stats \/ Leaderboard/);
  assert.match(json, /Advertise Your Server/);
  assert.match(json, /Join Server Discord/);
  assert.match(json, new RegExp(fairnessRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(json, /TOKEN_ENCRYPTION_KEY|DISCORD_BOT_TOKEN|SESSION_SECRET|webhook|encrypted_token/i);
}

const migration = readFileSync("migrations/0056_discord_server_announcements.sql", "utf8");
for (const column of [
  "discord_announcement_posts",
  "server_id",
  "event_type",
  "channel_id",
  "message_id",
  "thread_id",
  "dedupe_key",
  "status",
  "failure_reason",
  "created_at",
  "updated_at",
]) {
  assert.match(migration, new RegExp(column));
}
assert.doesNotMatch(migration, /DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+player_profiles|CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats/i);

const announcementSource = readFileSync("functions/_lib/discord-server-announcements.ts", "utf8");
assert.match(announcementSource, /DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED/);
assert.match(announcementSource, /DZN_DISCORD_ADVERT_CHANNEL_ID/);
assert.match(announcementSource, /DZN_DISCORD_SHOWCASE_CHANNEL_ID/);
assert.match(announcementSource, /FREE_BUMP_COOLDOWN_DAYS = 30/);
assert.match(announcementSource, /PRO_BUMP_COOLDOWN_DAYS = 7/);
assert.match(announcementSource, /new_server:\$\{serverId/);
assert.match(announcementSource, /server_bump:\$\{serverId/);
assert.match(announcementSource, /allowed_mentions:\s*\{\s*parse:\s*\[\]\s*\}/);
assert.match(announcementSource, /skipped_hidden_archived/);
assert.match(announcementSource, /return skipped\("skipped_hidden_archived"/);
assert.doesNotMatch(announcementSource, /recordAnnouncementSkip\(env, input, dedupeKey, "skipped_hidden_archived"/);
assert.match(announcementSource, /skipped_dedupe/);
assert.match(announcementSource, /Discord announcement send failed/);
assert.match(announcementSource, /return skipped\("skipped_feature_disabled"/);
assert.ok(
  announcementSource.indexOf("return skipped(\"skipped_feature_disabled\"") < announcementSource.indexOf("const db = requireDb(env)"),
  "Feature-disabled announcements must return before D1 reads/writes.",
);
assert.doesNotMatch(announcementSource, /DZN_DISCORD_NOTIFICATIONS_ENABLED\s*=\s*["']true["']|autoPostingEnabled:\s*true/i);

const onboardingSaveSource = readFileSync("functions/api/onboarding/save.ts", "utf8");
assert.match(onboardingSaveSource, /createdNewLinkedServer/);
assert.match(onboardingSaveSource, /eventType:\s*"new_server"/);
assert.match(onboardingSaveSource, /waitUntil\(/);
assert.match(onboardingSaveSource, /\.catch\(\(error\)/);

const bumpSource = readFileSync("functions/api/servers/[serverId]/advertising/bump.ts", "utf8");
assert.match(bumpSource, /eventType:\s*"server_bump"/);
assert.match(bumpSource, /planKey:\s*listingLimits\.listingPlanKey/);
assert.match(bumpSource, /waitUntil\(/);
assert.match(bumpSource, /\.catch\(\(error\)/);
assert.doesNotMatch(bumpSource, /network_rank|leaderboard|kill_count|player_profiles/i);

const ownerDiscordSource = readFileSync("functions/_lib/owner-discord-control.ts", "utf8");
assert.match(ownerDiscordSource, /getDiscordAnnouncementHealth/);
assert.match(ownerDiscordSource, /serverAnnouncements/);

const ownerUiSource = readFileSync("components/owner/owner-console.tsx", "utf8");
for (const label of [
  "Discord Announcement System",
  "Feature flag enabled",
  "Advert channel configured",
  "Showcase channel configured",
  "Bot token configured",
  "Last server announcement",
  "Last bump post",
  "Last weekly spotlight",
  "Recent failures",
]) {
  assert.match(ownerUiSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(ownerUiSource, /\bGuild ID\b|\bGuild name\b/);

const envExample = readFileSync(".env.example", "utf8");
assert.match(envExample, /DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED=false/);
assert.match(envExample, /DZN_DISCORD_ADVERT_CHANNEL_ID=/);
assert.match(envExample, /DZN_DISCORD_SHOWCASE_CHANNEL_ID=/);

const cloudflareEnv = readFileSync("cloudflare-env.d.ts", "utf8");
assert.match(cloudflareEnv, /DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED\?: string/);
assert.match(cloudflareEnv, /DZN_DISCORD_ADVERT_CHANNEL_ID\?: string/);
assert.match(cloudflareEnv, /DZN_DISCORD_SHOWCASE_CHANNEL_ID\?: string/);

console.log("Discord server announcement infrastructure tests passed.");
