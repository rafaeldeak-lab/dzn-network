set -euo pipefail

if [ "${MODE}" != "billing-phase-1-preview" ]; then
  echo "::error::34-seed-billing-phase-1-preview-fixtures.sh may only run in billing-phase-1-preview mode."
  exit 1
fi
if [ "${PREVIEW_PROJECT_NAME}" != "${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}" ] || [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
  echo "::error::Refusing Billing fixture seed for a non-dedicated or production Pages project."
  exit 1
fi
if [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${PREVIEW_DB_NAME}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME:-}" ]; then
  echo "::error::Refusing Billing fixture seed for production D1 database name."
  exit 1
fi
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID:-}" ]; then
  echo "::error::Refusing Billing fixture seed because preview D1 id equals production D1 id."
  exit 1
fi
if [ -z "${TOKEN_ENCRYPTION_KEY:-}" ] || [ -z "${OWNER_PREVIEW_SESSION_SECRET:-}" ]; then
  echo "::error::Missing ephemeral Billing preview TOKEN_ENCRYPTION_KEY or SESSION_SECRET."
  exit 1
fi
if [ -z "${BILLING_OWNER_A_SESSION_TOKEN:-}" ] || [ -z "${BILLING_OWNER_B_SESSION_TOKEN:-}" ]; then
  echo "::error::Missing ephemeral Billing owner session tokens."
  exit 1
fi

BILLING_ARTIFACT_DIR="${BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR:-dzn-billing-phase-1-preview}"
FIXTURE_PREFIX="billing-phase1-preview-"
SEED_SQL="${RUNNER_TEMP:-.}/billing-phase1-preview-seed.sql"
SEED_VERIFY_JSON="${RUNNER_TEMP:-.}/billing-phase1-preview-seed-verify.json"
trap 'rm -f "${SEED_SQL}" "${SEED_VERIFY_JSON}"' EXIT
mkdir -p "${BILLING_ARTIFACT_DIR}"

node <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");

const outPath = process.env.SEED_SQL || `${process.env.RUNNER_TEMP || "."}/billing-phase1-preview-seed.sql`;
const prefix = "billing-phase1-preview-";
const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;
const sessionSecret = process.env.OWNER_PREVIEW_SESSION_SECRET;
const ownerAToken = process.env.BILLING_OWNER_A_SESSION_TOKEN;
const ownerBToken = process.env.BILLING_OWNER_B_SESSION_TOKEN;
if (!tokenKey || !sessionSecret || !ownerAToken || !ownerBToken) {
  throw new Error("Missing ephemeral fixture secret material.");
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}
function hmacSession(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}
function encryptToken(alias, token) {
  const key = crypto.createHash("sha256").update(tokenKey).digest();
  const iv = crypto.createHash("sha256").update(`billing-phase1-preview-iv:${alias}`).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedToken: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: authTag.toString("base64url"),
  };
}
function userId(alias) {
  return `${prefix}${alias}`;
}
function guildRow(alias) {
  return `${prefix}${alias}-guild-row`;
}
function guildId(alias) {
  return `${prefix}${alias}-guild`;
}
function linkedServer(alias) {
  return `${prefix}${alias}`;
}
function reservation(alias) {
  return `${prefix}${alias}-reservation`;
}
function connection(alias) {
  return `${prefix}${alias}-connection`;
}
function validToken(alias) {
  return encryptToken(alias, `preview-only-nitrado-token-${alias}`);
}
function connectionSql(alias, owner, server, updatedAt) {
  const encrypted = validToken(alias);
  return `INSERT INTO nitrado_connections (
  id, user_id, linked_server_id, encrypted_token, token_iv, token_auth_tag, created_at, updated_at
) VALUES (
  ${sql(connection(alias))}, ${sql(userId(owner))}, ${sql(linkedServer(server))}, ${sql(encrypted.encryptedToken)}, ${sql(encrypted.iv)}, ${sql(encrypted.authTag)}, ${sql(updatedAt)}, ${sql(updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  linked_server_id = excluded.linked_server_id,
  encrypted_token = excluded.encrypted_token,
  token_iv = excluded.token_iv,
  token_auth_tag = excluded.token_auth_tag,
  updated_at = excluded.updated_at;`;
}
function serverSql({ alias, owner, guild, serviceId, serviceName, status = "pending", type = "PVP", category = "pvp", slug }) {
  return `INSERT INTO linked_servers (
  id, user_id, guild_id, discord_guild_id, nitrado_service_id, nitrado_service_name, server_name, server_type,
  server_category, tags_json, region, status, public_slug, listing_visibility, lifecycle_status, lifecycle_reason,
  lifecycle_updated_at, owner_action_required, owner_action_reason, latest_imported_event_at, game, platform,
  ip_address, player_slots, merged_into_server_id, created_at, updated_at
) VALUES (
  ${sql(linkedServer(alias))}, ${sql(userId(owner))}, ${sql(guildId(guild))}, ${sql(guildRow(guild))}, ${sql(serviceId)}, ${sql(serviceName)},
  ${sql(serviceName || alias)}, ${sql(type)}, ${sql(category)}, ${sql(JSON.stringify(["billing-preview"]))}, 'EU', ${sql(status)}, ${sql(slug || alias)},
  'hidden', 'active_live', 'billing_phase_1_preview_fixture', '2026-08-20T00:00:00.000Z', 0, NULL,
  '2026-08-20T00:00:00.000Z', 'DayZ', 'PlayStation', '203.0.113.21', 60, NULL, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  guild_id = excluded.guild_id,
  discord_guild_id = excluded.discord_guild_id,
  nitrado_service_id = excluded.nitrado_service_id,
  nitrado_service_name = excluded.nitrado_service_name,
  server_name = excluded.server_name,
  server_type = excluded.server_type,
  server_category = excluded.server_category,
  tags_json = excluded.tags_json,
  status = excluded.status,
  public_slug = excluded.public_slug,
  listing_visibility = excluded.listing_visibility,
  lifecycle_status = excluded.lifecycle_status,
  lifecycle_reason = excluded.lifecycle_reason,
  owner_action_required = excluded.owner_action_required,
  owner_action_reason = excluded.owner_action_reason,
  latest_imported_event_at = excluded.latest_imported_event_at,
  game = excluded.game,
  platform = excluded.platform,
  ip_address = excluded.ip_address,
  player_slots = excluded.player_slots,
  merged_into_server_id = excluded.merged_into_server_id,
  updated_at = excluded.updated_at;`;
}
function reservationSql(alias, owner, server) {
  return `INSERT INTO linked_server_allowance_reservations (
  id, user_id, discord_user_id, linked_server_id, purpose, status, expires_at, completed_at, released_at, expired_at, release_reason, created_at, updated_at
) VALUES (
  ${sql(reservation(alias))}, ${sql(userId(owner))}, ${sql(`${owner}-discord`)}, ${sql(linkedServer(server))}, 'onboarding', 'active',
  '2099-01-01T00:00:00.000Z', NULL, NULL, NULL, NULL, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  discord_user_id = excluded.discord_user_id,
  linked_server_id = excluded.linked_server_id,
  purpose = excluded.purpose,
  status = excluded.status,
  expires_at = excluded.expires_at,
  completed_at = NULL,
  released_at = NULL,
  expired_at = NULL,
  release_reason = NULL,
  updated_at = excluded.updated_at;`;
}

const sqlStatements = [
`INSERT INTO users (id, discord_id, username, avatar, created_at, updated_at)
VALUES
  (${sql(userId("owner-a"))}, 'owner-a-discord', 'BillingPreviewOwnerA', NULL, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  (${sql(userId("owner-b"))}, 'owner-b-discord', 'BillingPreviewOwnerB', NULL, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET discord_id = excluded.discord_id, username = excluded.username, updated_at = excluded.updated_at;`,
`INSERT INTO sessions (id, user_id, session_token_hash, expires_at, created_at)
VALUES
  (${sql(`${prefix}owner-a-session`)}, ${sql(userId("owner-a"))}, ${sql(hmacSession(ownerAToken))}, '2099-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  (${sql(`${prefix}owner-b-session`)}, ${sql(userId("owner-b"))}, ${sql(hmacSession(ownerBToken))}, '2099-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  session_token_hash = excluded.session_token_hash,
  expires_at = excluded.expires_at;`,
`INSERT INTO discord_guilds (id, guild_id, owner_user_id, name, icon, icon_url, permissions, is_owner, created_at, updated_at)
VALUES
  (${sql(guildRow("owner-a-900001"))}, ${sql(guildId("owner-a-900001"))}, ${sql(userId("owner-a"))}, 'Billing Preview Owner A Canonical 900001', NULL, NULL, '8', 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  (${sql(guildRow("owner-a-900002"))}, ${sql(guildId("owner-a-900002"))}, ${sql(userId("owner-a"))}, 'Billing Preview Owner A Canonical 900002', NULL, NULL, '8', 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  (${sql(guildRow("owner-a-draft"))}, ${sql(guildId("owner-a-draft"))}, ${sql(userId("owner-a"))}, 'Billing Preview Owner A Drafts', NULL, NULL, '8', 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  (${sql(guildRow("owner-b-draft"))}, ${sql(guildId("owner-b-draft"))}, ${sql(userId("owner-b"))}, 'Billing Preview Owner B Drafts', NULL, NULL, '8', 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')
ON CONFLICT(guild_id) DO UPDATE SET
  owner_user_id = excluded.owner_user_id,
  name = excluded.name,
  permissions = excluded.permissions,
  is_owner = excluded.is_owner,
  updated_at = excluded.updated_at;`,
`INSERT INTO owner_billing_accounts (
  id, discord_user_id, stripe_customer_id, stripe_subscription_id, plan_key, plan_status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
) VALUES
  (${sql(`${prefix}owner-a-billing`)}, 'owner-a-discord', NULL, NULL, 'pro', 'active', '2026-08-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 0, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  (${sql(`${prefix}owner-b-billing`)}, 'owner-b-discord', NULL, NULL, 'pro', 'active', '2026-08-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 0, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')
ON CONFLICT(discord_user_id) DO UPDATE SET
  stripe_customer_id = excluded.stripe_customer_id,
  stripe_subscription_id = excluded.stripe_subscription_id,
  plan_key = excluded.plan_key,
  plan_status = excluded.plan_status,
  current_period_start = excluded.current_period_start,
  current_period_end = excluded.current_period_end,
  cancel_at_period_end = excluded.cancel_at_period_end,
  updated_at = excluded.updated_at;`,
`INSERT INTO owner_plan_entitlements (
  discord_user_id, plan_key, max_linked_servers, can_use_reviews, can_use_public_listing, can_use_advanced_analytics,
  can_join_events, can_use_ad_bumps, included_bumps_per_month, bump_cooldown_hours, can_use_featured_slots, stat_history_days, updated_at
) VALUES
  ('owner-a-discord', 'pro', 3, 1, 1, 1, 1, 1, 2, 168, 0, 30, '2026-08-20T00:00:00.000Z'),
  ('owner-b-discord', 'pro', 3, 1, 1, 1, 1, 1, 2, 168, 0, 30, '2026-08-20T00:00:00.000Z')
ON CONFLICT(discord_user_id) DO UPDATE SET
  plan_key = excluded.plan_key,
  max_linked_servers = excluded.max_linked_servers,
  can_use_reviews = excluded.can_use_reviews,
  can_use_public_listing = excluded.can_use_public_listing,
  can_use_advanced_analytics = excluded.can_use_advanced_analytics,
  can_join_events = excluded.can_join_events,
  can_use_ad_bumps = excluded.can_use_ad_bumps,
  included_bumps_per_month = excluded.included_bumps_per_month,
  bump_cooldown_hours = excluded.bump_cooldown_hours,
  can_use_featured_slots = excluded.can_use_featured_slots,
  stat_history_days = excluded.stat_history_days,
  updated_at = excluded.updated_at;`,
`INSERT INTO server_subscriptions (
  id, guild_id, owner_discord_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan_key, status,
  current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
) VALUES
  (${sql(`${prefix}owner-a-900001-sub`)}, ${sql(guildId("owner-a-900001"))}, 'owner-a-discord', NULL, NULL, NULL, 'pro', 'active', '2026-08-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 0, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  (${sql(`${prefix}owner-a-900002-sub`)}, ${sql(guildId("owner-a-900002"))}, 'owner-a-discord', NULL, NULL, NULL, 'pro', 'active', '2026-08-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 0, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')
ON CONFLICT(guild_id) DO UPDATE SET
  owner_discord_id = excluded.owner_discord_id,
  plan_key = excluded.plan_key,
  status = excluded.status,
  current_period_start = excluded.current_period_start,
  current_period_end = excluded.current_period_end,
  cancel_at_period_end = excluded.cancel_at_period_end,
  updated_at = excluded.updated_at;`,
serverSql({ alias: "owner-a-canonical-900001", owner: "owner-a", guild: "owner-a-900001", serviceId: "900001", serviceName: "Pandora DayZ", status: "live", slug: `${prefix}owner-a-canonical-900001` }),
serverSql({ alias: "owner-a-canonical-900002", owner: "owner-a", guild: "owner-a-900002", serviceId: "900002", serviceName: "Warlords PvP", status: "live", slug: `${prefix}owner-a-canonical-900002` }),
serverSql({ alias: "owner-a-source-no-credential", owner: "owner-a", guild: "owner-a-draft", serviceId: null, serviceName: "Owner A source no credential", status: "pending" }),
serverSql({ alias: "owner-a-source-corrupted-credential", owner: "owner-a", guild: "owner-a-draft", serviceId: null, serviceName: "Owner A source corrupted credential", status: "pending" }),
serverSql({ alias: "owner-a-source-duplicate-900002", owner: "owner-a", guild: "owner-a-draft", serviceId: null, serviceName: "Owner A duplicate source for 900002", status: "pending" }),
serverSql({ alias: "owner-a-source-new-900003", owner: "owner-a", guild: "owner-a-draft", serviceId: null, serviceName: "Owner A source new 900003", status: "pending" }),
serverSql({ alias: "owner-b-source-cross-900001", owner: "owner-b", guild: "owner-b-draft", serviceId: null, serviceName: "Owner B cross-owner source 900001", status: "pending" }),
reservationSql("owner-a-source-no-credential", "owner-a", "owner-a-source-no-credential"),
reservationSql("owner-a-source-corrupted-credential", "owner-a", "owner-a-source-corrupted-credential"),
reservationSql("owner-a-source-duplicate-900002", "owner-a", "owner-a-source-duplicate-900002"),
reservationSql("owner-a-source-new-900003", "owner-a", "owner-a-source-new-900003"),
reservationSql("owner-b-source-cross-900001", "owner-b", "owner-b-source-cross-900001"),
connectionSql("owner-a-canonical-900001", "owner-a", "owner-a-canonical-900001", "2026-08-20T00:01:00.000Z"),
connectionSql("owner-a-canonical-900002", "owner-a", "owner-a-canonical-900002", "2026-08-20T00:02:00.000Z"),
connectionSql("owner-a-source-duplicate-900002", "owner-a", "owner-a-source-duplicate-900002", "2026-08-20T00:10:00.000Z"),
connectionSql("owner-a-source-new-900003", "owner-a", "owner-a-source-new-900003", "2026-08-20T00:11:00.000Z"),
connectionSql("owner-b-source-cross-900001", "owner-b", "owner-b-source-cross-900001", "2026-08-20T00:12:00.000Z"),
`INSERT INTO nitrado_connections (
  id, user_id, linked_server_id, encrypted_token, token_iv, token_auth_tag, created_at, updated_at
) VALUES (
  ${sql(connection("owner-a-source-corrupted-credential"))}, ${sql(userId("owner-a"))}, ${sql(linkedServer("owner-a-source-corrupted-credential"))},
  'not-valid-ciphertext', 'not-valid-iv', 'not-valid-tag', '2026-08-20T00:13:00.000Z', '2026-08-20T00:13:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  linked_server_id = excluded.linked_server_id,
  encrypted_token = excluded.encrypted_token,
  token_iv = excluded.token_iv,
  token_auth_tag = excluded.token_auth_tag,
  updated_at = excluded.updated_at;`,
];

fs.writeFileSync(outPath, `${sqlStatements.join("\n\n")}\n`);
NODE

npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --file "${SEED_SQL}" >/dev/null
rm -f "${SEED_SQL}"

npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "SELECT (SELECT COUNT(*) FROM users WHERE id LIKE '${FIXTURE_PREFIX}%') AS users, (SELECT COUNT(*) FROM sessions WHERE id LIKE '${FIXTURE_PREFIX}%') AS sessions, (SELECT COUNT(*) FROM linked_servers WHERE id LIKE '${FIXTURE_PREFIX}%') AS linked_servers, (SELECT COUNT(*) FROM nitrado_connections WHERE id LIKE '${FIXTURE_PREFIX}%') AS nitrado_connections, (SELECT COUNT(*) FROM linked_server_allowance_reservations WHERE id LIKE '${FIXTURE_PREFIX}%') AS reservations, (SELECT COUNT(*) FROM linked_server_allowance_reservations WHERE id LIKE '${FIXTURE_PREFIX}%' AND status = 'active') AS active_reservations;" > "${SEED_VERIFY_JSON}"

node <<'NODE'
const fs = require("node:fs");
const artifact = process.env.BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR || "dzn-billing-phase-1-preview";
const prefix = "billing-phase1-preview-";
const verifyPath = process.env.SEED_VERIFY_JSON || `${process.env.RUNNER_TEMP || "."}/billing-phase1-preview-seed-verify.json`;
function rowsFromWranglerJson(path) {
  const raw = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "").trim();
  const start = raw.search(/[\[{]/);
  if (start < 0) throw new Error(`Missing JSON output for ${path}.`);
  const parsed = JSON.parse(raw.slice(start));
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => item?.results ?? item?.result?.[0]?.results ?? item?.result?.results ?? []);
}
const row = rowsFromWranglerJson(verifyPath)[0] || {};
const counts = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
const expectedMinimums = {
  users: 2,
  sessions: 2,
  linked_servers: 7,
  nitrado_connections: 6,
  reservations: 5,
  active_reservations: 5,
};
for (const [key, minimum] of Object.entries(expectedMinimums)) {
  if ((counts[key] || 0) < minimum) {
    throw new Error(`Billing fixture seed count ${key}=${counts[key] || 0}, expected at least ${minimum}.`);
  }
}
const aliases = [
  "owner-a-canonical-900001",
  "owner-a-canonical-900002",
  "owner-a-source-no-credential",
  "owner-a-source-corrupted-credential",
  "owner-a-source-duplicate-900002",
  "owner-a-source-new-900003",
  "owner-b-source-cross-900001",
];
fs.writeFileSync(`${artifact}/fixture-result-summary.json`, JSON.stringify({
  ok: true,
  fixturePrefix: prefix,
  mockServiceIds: ["900001", "900002", "900003"],
  fixtureAliases: aliases,
  syntheticOwners: ["owner-a", "owner-b"],
  activePlansSeeded: true,
  sessionsSeeded: true,
  plaintextTokensStored: false,
  encryptedTokenValuesInArtifact: false,
  counts,
}, null, 2));
fs.writeFileSync(`${artifact}/ownership-integrity-summary.json`, JSON.stringify({
  ok: true,
  fixturePrefix: prefix,
  ownerACanonicalServices: ["900001", "900002"],
  ownerBForeignClaimTarget: "900001",
  crossOwnerConflictExpectedStatus: 409,
  foreignOwnerDataInArtifact: false,
}, null, 2));
fs.writeFileSync(`${artifact}/allowance-summary.json`, JSON.stringify({
  ok: true,
  fixturePrefix: prefix,
  activeReservationsSeeded: counts.active_reservations,
  reservationCompletionExpectedDuringVerification: true,
  reservationReleaseExpectedDuringVerification: true,
}, null, 2));
console.log(`Billing preview fixtures seeded with prefix ${prefix}; linkedServers=${counts.linked_servers}; activeReservations=${counts.active_reservations}`);
NODE
