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

const ownerDataSource = readFileSync("functions/_lib/owner-console.ts", "utf8");
assert.doesNotMatch(ownerDataSource, /\bnitrado_connections\b/i);
assert.doesNotMatch(ownerDataSource, /\bencrypted_token\b|\btoken_iv\b|\btoken_auth_tag\b|\bDISCORD_BOT_TOKEN\b|\bSESSION_SECRET\b/i);
assert.doesNotMatch(ownerDataSource, /\bfetch\s*\(/i);
assert.match(ownerDataSource, /server_sync_state/);
assert.match(ownerDataSource, /adm_sync_state/);
assert.match(ownerDataSource, /server_public_cache/);

const ownerUiSource = readFileSync("components/owner/owner-console.tsx", "utf8");
for (const label of [
  "Live sync active",
  "Token needs re-save",
  "Legacy offline - historical stats preserved",
  "Archived / hidden - active sync disabled",
  "No owner actions recorded yet.",
  "Phase 2",
  "Read-only",
]) {
  assert.match(ownerUiSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(ownerUiSource, /\bencrypted_token\b|\btoken_iv\b|\btoken_auth_tag\b|\bDISCORD_BOT_TOKEN\b|\bTOKEN_ENCRYPTION_KEY\b/i);

const pageSource = readFileSync("app/owner/page.tsx", "utf8");
assert.match(pageSource, /OwnerConsole/);

const packageJson = readFileSync("package.json", "utf8");
assert.match(packageJson, /node scripts\/patch-pages-routes\.mjs/, "Build must patch Cloudflare Pages routes for owner page protection.");

const routesPatch = readFileSync("scripts/patch-pages-routes.mjs", "utf8");
assert.match(routesPatch, /"\/owner"/, "Cloudflare Pages routes must include the exact /owner page.");
assert.match(routesPatch, /"\/owner\/\*"/, "Cloudflare Pages routes must include nested owner routes.");
assert.match(routesPatch, /"\/api\/\*"/, "Cloudflare Pages routes must preserve API function routing.");

console.log("Owner console read-only access and data contract checks passed.");
