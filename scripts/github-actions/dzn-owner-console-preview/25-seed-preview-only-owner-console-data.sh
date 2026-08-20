set -euo pipefail

case "${PREVIEW_DB_NAME}" in
  *owner_console_preview*) ;;
  *)
    echo "::error::Refusing preview seed for non-preview owner console database name."
    exit 1
    ;;
esac
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID}" ]; then
  echo "::error::Refusing seed because preview D1 id equals production D1 id."
  exit 1
fi

node <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");
const ownerDiscordId = process.env.OWNER_CONSOLE_PREVIEW_OWNER_ID;
const creatorDiscordId = process.env.OWNER_CONSOLE_PREVIEW_CREATOR_ID;
const sessionSecret = process.env.OWNER_PREVIEW_SESSION_SECRET;
const ownerToken = "owner-console-preview-owner-token";
const creatorToken = "owner-console-preview-creator-token";
const nonOwnerToken = "owner-console-preview-non-owner-token";
function hmac(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}
function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}
const expires = "2099-01-01T00:00:00.000Z";
const statements = `
INSERT INTO users (id, discord_id, username, avatar, created_at, updated_at)
VALUES
  ('owner-console-platform-owner', ${sql(ownerDiscordId)}, 'OwnerPreview', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-platform-creator', ${sql(creatorDiscordId)}, 'CreatorPreview', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-non-owner-user', '999000000000000001', 'NonOwnerPreview', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-server-owner', '999000000000000002', 'ServerOwnerPreview', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET discord_id = excluded.discord_id, username = excluded.username, updated_at = CURRENT_TIMESTAMP;

INSERT INTO sessions (id, user_id, session_token_hash, expires_at, created_at)
VALUES
  ('owner-console-owner-session', 'owner-console-platform-owner', ${sql(hmac(ownerToken))}, ${sql(expires)}, CURRENT_TIMESTAMP),
  ('owner-console-creator-session', 'owner-console-platform-creator', ${sql(hmac(creatorToken))}, ${sql(expires)}, CURRENT_TIMESTAMP),
  ('owner-console-non-owner-session', 'owner-console-non-owner-user', ${sql(hmac(nonOwnerToken))}, ${sql(expires)}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  session_token_hash = excluded.session_token_hash,
  expires_at = excluded.expires_at;

INSERT INTO discord_guilds (id, guild_id, owner_user_id, name, icon, icon_url, permissions, is_owner, created_at, updated_at)
VALUES
  ('owner-console-creator-host-guild-row', 'owner-console-creator-host-guild', 'owner-console-platform-creator', 'Creator Preview Host Guild', NULL, NULL, '8', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-nuketown-guild-row', 'owner-console-nuketown-guild', 'owner-console-server-owner', 'NukeTown Owner Guild', NULL, NULL, '8', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-pandora-guild-row', 'owner-console-pandora-guild', 'owner-console-server-owner', 'PANDORA Owner Guild', NULL, NULL, '8', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-warlords-guild-row', 'owner-console-warlords-guild', 'owner-console-server-owner', 'Warlords Test Guild', NULL, NULL, '8', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(guild_id) DO UPDATE SET name = excluded.name, owner_user_id = excluded.owner_user_id, updated_at = CURRENT_TIMESTAMP;

INSERT INTO linked_servers (
  id, user_id, guild_id, discord_guild_id, nitrado_service_id, nitrado_service_name, server_name, server_type,
  tags_json, region, status, public_slug, listing_visibility, lifecycle_status, lifecycle_reason,
  lifecycle_updated_at, owner_action_required, owner_action_reason, latest_imported_event_at, created_at, updated_at
)
VALUES
  ('owner-console-creator-host', 'owner-console-platform-creator', 'owner-console-creator-host-guild', 'owner-console-creator-host-guild-row', '18765762', 'Creator Preview DEATHMATCH', 'Creator Preview DEATHMATCH', 'DEATHMATCH',
    '["deathmatch","creator-preview"]', 'EU', 'live', 'owner-console-creator-host', 'public', 'active_live', 'creator_owned_event_host_fixture', CURRENT_TIMESTAMP, 0, NULL, '2026-07-01T18:05:22.000Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-nuketown', 'owner-console-server-owner', 'owner-console-nuketown-guild', 'owner-console-nuketown-guild-row', '18765761', 'NukeTown DEATHMATCH', 'NukeTown DEATHMATCH', 'DEATHMATCH',
    '["deathmatch"]', 'EU', 'live', 'owner-console-nuketown', 'public', 'active_live', 'healthy_active_sync', CURRENT_TIMESTAMP, 0, NULL, '2026-07-01T18:05:22.000Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-pandora', 'owner-console-server-owner', 'owner-console-pandora-guild', 'owner-console-pandora-guild-row', '17428528', 'PANDORA', 'PANDORA', 'PVP',
    '["legacy"]', 'EU', 'inactive', 'owner-console-pandora', 'public', 'legacy_offline', 'historical_stats_preserved', CURRENT_TIMESTAMP, 0, NULL, '2026-06-29T13:48:58.000Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-warlords', 'owner-console-server-owner', 'owner-console-warlords-guild', 'owner-console-warlords-guild-row', '900002', 'Warlords PvP', 'Warlords PvP', 'PVP',
    '["test"]', 'EU', 'archived', 'owner-console-warlords', 'hidden', 'archived_hidden', 'owner_confirmed_fake_test_listing', CURRENT_TIMESTAMP, 0, NULL, '2026-06-01T00:00:00.000Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
  nitrado_service_id = excluded.nitrado_service_id,
  server_name = excluded.server_name,
  status = excluded.status,
  public_slug = excluded.public_slug,
  listing_visibility = excluded.listing_visibility,
  lifecycle_status = excluded.lifecycle_status,
  lifecycle_reason = excluded.lifecycle_reason,
  owner_action_required = excluded.owner_action_required,
  owner_action_reason = excluded.owner_action_reason,
  latest_imported_event_at = excluded.latest_imported_event_at,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO server_subscriptions (id, guild_id, owner_discord_id, plan_key, status, created_at, updated_at)
VALUES
  ('owner-console-creator-host-sub', 'owner-console-creator-host-guild', ${sql(creatorDiscordId)}, 'pro', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-nuketown-sub', 'owner-console-nuketown-guild', '999000000000000002', 'pro', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-pandora-sub', 'owner-console-pandora-guild', '999000000000000002', 'starter', 'inactive', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-warlords-sub', 'owner-console-warlords-guild', '999000000000000002', 'starter', 'inactive', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(guild_id) DO UPDATE SET plan_key = excluded.plan_key, status = excluded.status, updated_at = CURRENT_TIMESTAMP;

INSERT INTO server_sync_state (
  id, guild_id, last_status_check_at, next_status_check_due_at, last_successful_status_check_at, current_player_count,
  max_player_count, server_online, server_status, status_data_freshness, last_successful_adm_pull_at,
  last_seen_adm_filename, last_processed_adm_filename, last_processed_adm_offset, adm_status,
  next_metadata_check_at, next_player_count_check_at, next_adm_discovery_at, next_adm_processing_at, next_retry_after, last_skip_reason,
  created_at, updated_at
)
VALUES
  ('owner-console-nuketown-sync', 'owner-console-nuketown-guild', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 10, 1, 'online', 'nitrado_live',
    CURRENT_TIMESTAMP, 'DayZServer_PS4_x64_2026-07-01_18-02-29.ADM', 'DayZServer_PS4_x64_2026-07-01_18-02-29.ADM', 4096, 'caught_up_waiting_for_growth',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-creator-host-sync', 'owner-console-creator-host-guild', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 10, 1, 'online', 'nitrado_live',
    CURRENT_TIMESTAMP, 'DayZServer_PS4_x64_2026-07-01_18-02-29.ADM', 'DayZServer_PS4_x64_2026-07-01_18-02-29.ADM', 4096, 'caught_up_waiting_for_growth',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-pandora-sync', 'owner-console-pandora-guild', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 60, 0, 'legacy_offline', 'last_known',
    '2026-06-29T13:48:58.000Z', 'DayZServer_PS4_x64_2026-06-29_13-02-07.ADM', 'DayZServer_PS4_x64_2026-06-29_13-02-07.ADM', 2048, 'final_sync_complete',
    NULL, NULL, NULL, NULL, NULL, 'skipped_legacy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-warlords-sync', 'owner-console-warlords-guild', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0, 0, 'archived_hidden', 'hidden',
    '2026-06-01T00:00:00.000Z', 'WarlordsTest.ADM', 'WarlordsTest.ADM', 0, 'archived',
    NULL, NULL, NULL, NULL, NULL, 'skipped_archived', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(guild_id) DO UPDATE SET
  current_player_count = excluded.current_player_count,
  max_player_count = excluded.max_player_count,
  server_status = excluded.server_status,
  status_data_freshness = excluded.status_data_freshness,
  last_seen_adm_filename = excluded.last_seen_adm_filename,
  last_processed_adm_filename = excluded.last_processed_adm_filename,
  last_processed_adm_offset = excluded.last_processed_adm_offset,
  adm_status = excluded.adm_status,
  last_skip_reason = excluded.last_skip_reason,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO adm_sync_state (id, linked_server_id, latest_adm_file, last_processed_file, last_processed_line, last_processed_offset, last_sync_status, last_sync_message, last_sync_at, created_at, updated_at)
VALUES
  ('owner-console-nuketown-adm', 'owner-console-nuketown', 'DayZServer_PS4_x64_2026-07-01_18-02-29.ADM', 'DayZServer_PS4_x64_2026-07-01_18-02-29.ADM', 144, 4096, 'success', 'caught_up_waiting_for_growth', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-pandora-adm', 'owner-console-pandora', 'DayZServer_PS4_x64_2026-06-29_13-02-07.ADM', 'DayZServer_PS4_x64_2026-06-29_13-02-07.ADM', 88, 2048, 'final_sync_complete', 'historical_stats_preserved', '2026-06-29T13:48:58.000Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-warlords-adm', 'owner-console-warlords', 'WarlordsTest.ADM', 'WarlordsTest.ADM', 1, 0, 'archived', 'owner_confirmed_fake_test_listing', '2026-06-01T00:00:00.000Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(linked_server_id) DO UPDATE SET
  latest_adm_file = excluded.latest_adm_file,
  last_processed_file = excluded.last_processed_file,
  last_processed_line = excluded.last_processed_line,
  last_processed_offset = excluded.last_processed_offset,
  last_sync_status = excluded.last_sync_status,
  last_sync_message = excluded.last_sync_message,
  last_sync_at = excluded.last_sync_at,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO server_stats (id, linked_server_id, total_kills, total_deaths, total_joins, total_disconnects, unique_players, last_event_at, updated_at)
VALUES
  ('owner-console-nuketown-stats', 'owner-console-nuketown', 14, 14, 22, 20, 9, '2026-07-01T18:05:22.000Z', CURRENT_TIMESTAMP),
  ('owner-console-pandora-stats', 'owner-console-pandora', 42, 39, 130, 128, 31, '2026-06-29T13:48:58.000Z', CURRENT_TIMESTAMP),
  ('owner-console-warlords-stats', 'owner-console-warlords', 1, 1, 2, 2, 1, '2026-06-01T00:00:00.000Z', CURRENT_TIMESTAMP)
ON CONFLICT(linked_server_id) DO UPDATE SET
  total_kills = excluded.total_kills,
  total_deaths = excluded.total_deaths,
  total_joins = excluded.total_joins,
  total_disconnects = excluded.total_disconnects,
  unique_players = excluded.unique_players,
  last_event_at = excluded.last_event_at,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM server_build_stats WHERE linked_server_id IN ('owner-console-nuketown', 'owner-console-pandora', 'owner-console-warlords');
INSERT INTO server_build_stats (linked_server_id, nitrado_service_id, structures_built, build_items_placed, storage_items_placed, traps_placed, build_score, top_builder_name, top_builder_count, last_build_at, updated_at)
VALUES
  ('owner-console-pandora', '17428528', 6, 10, 3, 1, 28, 'PandoraBuilder', 6, '2026-06-29T12:30:00.000Z', CURRENT_TIMESTAMP)
ON CONFLICT(linked_server_id) DO UPDATE SET
  nitrado_service_id = excluded.nitrado_service_id,
  structures_built = excluded.structures_built,
  build_items_placed = excluded.build_items_placed,
  storage_items_placed = excluded.storage_items_placed,
  traps_placed = excluded.traps_placed,
  build_score = excluded.build_score,
  top_builder_name = excluded.top_builder_name,
  top_builder_count = excluded.top_builder_count,
  last_build_at = excluded.last_build_at,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO server_public_cache (id, guild_id, plan_key, public_server_name, current_player_count, max_player_count, server_online, server_status, last_status_update_at, last_adm_update_at, updated_at)
VALUES
  ('owner-console-creator-host-cache', 'owner-console-creator-host-guild', 'pro', 'Creator Preview DEATHMATCH', 1, 10, 1, 'online', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-nuketown-cache', 'owner-console-nuketown-guild', 'pro', 'NukeTown DEATHMATCH', 1, 10, 1, 'online', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('owner-console-pandora-cache', 'owner-console-pandora-guild', 'starter', 'PANDORA', 0, 60, 0, 'legacy_offline', CURRENT_TIMESTAMP, '2026-06-29T13:48:58.000Z', CURRENT_TIMESTAMP)
ON CONFLICT(guild_id) DO UPDATE SET
  public_server_name = excluded.public_server_name,
  current_player_count = excluded.current_player_count,
  max_player_count = excluded.max_player_count,
  server_online = excluded.server_online,
  server_status = excluded.server_status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO automation_cron_runs (id, source, endpoint, job_type, started_at, finished_at, status, error_message, processed_count, skipped_count, failed_count, created_at)
VALUES
  ('owner-console-public-health', 'github-preview', '/api/public/servers', 'public', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'success', NULL, 4, 0, 0, CURRENT_TIMESTAMP),
  ('owner-console-adm-cycle', 'github-preview', '/api/autodev/adm-health', 'adm-cycle-watch', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'success', NULL, 2, 1, 0, CURRENT_TIMESTAMP),
  ('owner-console-auto-update', 'github-preview', '/api/sync/metadata/run', 'auto-update', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'success', NULL, 2, 1, 0, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET status = excluded.status, processed_count = excluded.processed_count, skipped_count = excluded.skipped_count, failed_count = excluded.failed_count, created_at = CURRENT_TIMESTAMP;
`;

fs.writeFileSync("owner-console-preview-seed.sql", statements);
fs.appendFileSync(process.env.GITHUB_ENV, `OWNER_CONSOLE_OWNER_COOKIE=dzn_session=${ownerToken}\n`);
fs.appendFileSync(process.env.GITHUB_ENV, `OWNER_CONSOLE_CREATOR_COOKIE=dzn_session=${creatorToken}\n`);
fs.appendFileSync(process.env.GITHUB_ENV, `OWNER_CONSOLE_NON_OWNER_COOKIE=dzn_session=${nonOwnerToken}\n`);
NODE

npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --file owner-console-preview-seed.sql
echo "Owner console preview seed completed."
