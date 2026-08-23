set -euo pipefail

node <<'NODE'
const fs = require("node:fs");
const prefix = process.env.EVENT_PLATFORM_PERFORMANCE_PREVIEW_SEED_PREFIX || "phase2a-preview-";
if (prefix !== "phase2a-preview-") {
  console.error("Phase 2A preview seed prefix constant mismatch.");
  process.exit(1);
}
const apiMemberId = "owner-console-non-owner-user";
const runKey = String(process.env.PHASE2A_RUN_KEY || "").trim();
const conversionTargetId = String(process.env.PHASE2A_CONVERSION_TARGET_ID || "").trim();
const conversionTargetEventId = String(process.env.PHASE2A_CONVERSION_EVENT_ID || "").trim();
const creatorHostId = String(process.env.PHASE2A_CREATOR_HOST_ID || "phase2a-preview-creator-host").trim();
const foreignHostId = String(process.env.PHASE2A_FOREIGN_HOST_ID || "phase2a-preview-foreign-host").trim();
if (!/^[1-9][0-9]*-[1-9][0-9]*$/.test(runKey)) {
  console.error("Phase 2A run-scoped fixture key is missing or malformed.");
  process.exit(1);
}
if (!/^[A-Za-z0-9-]+$/.test(conversionTargetId) || conversionTargetId.length >= 72) {
  console.error("Phase 2A run-scoped conversion target id is missing or malformed.");
  process.exit(1);
}
if (conversionTargetEventId !== `suggestion-draft-${conversionTargetId}`) {
  console.error("Phase 2A run-scoped conversion event id does not match the application contract.");
  process.exit(1);
}
if (!/^phase2a-preview-[a-z0-9-]+$/.test(creatorHostId) || !/^phase2a-preview-[a-z0-9-]+$/.test(foreignHostId) || creatorHostId === foreignHostId) {
  console.error("Phase 2A host authorization fixture ids are missing or malformed.");
  process.exit(1);
}
function sql(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}
const ownerIds = String(process.env.DZN_PLATFORM_OWNER_DISCORD_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const creatorId = String(process.env.DZN_PLATFORM_CREATOR_DISCORD_ID || "").trim();
const serverSubquery = "(SELECT id FROM linked_servers WHERE public_slug = 'owner-console-nuketown' OR id = 'owner-console-nuketown' LIMIT 1)";
const publicSuggestionServerSubquery = "(SELECT id FROM linked_servers WHERE id = 'phase2a-preview-public-suggestion-server' LIMIT 1)";
const hiddenSuggestionServerSubquery = "(SELECT id FROM linked_servers WHERE id = 'phase2a-preview-hidden-suggestion-server' LIMIT 1)";
const mergedSuggestionServerSubquery = "(SELECT id FROM linked_servers WHERE id = 'phase2a-preview-merged-suggestion-server' LIMIT 1)";
const now = "2026-07-22T20:00:00.000Z";
const users = [
  ["phase2a-preview-member", "990000000000002001", "Phase2A Member"],
  ["phase2a-preview-other-member", "990000000000002002", "Phase2A Voter"],
  ["phase2a-preview-owner", "990000000000002003", "Phase2A Owner"],
  ["phase2a-preview-creator", "990000000000002004", "Phase2A Creator"],
];
const suggestions = [
  ["phase2a-preview-pending", "phase2a-preview-member", "Supply Run Showdown", "Teams race to complete a clean supply route with creator review before public voting.", "server_vs_server", "cross_platform", "Chernarus", null, 1, "pending_moderation", "submitted", null, 0, 0, 0, 0.1],
  ["phase2a-preview-public-voting", "phase2a-preview-other-member", "Coastal Cup Scramble", "A public voting candidate for compact teams with a weekend scoring window.", "player_vs_player", "pc", "Sakhal", null, 1, "public_voting", "public_voting", null, 4, 1, 0, 8.5],
  ["phase2a-preview-shortlisted", "phase2a-preview-member", "Northern Ridge Trial", "A shortlisted server challenge with clear map boundaries and manual evidence.", "community_challenge", "xbox", "Livonia", null, 1, "shortlisted", "shortlisted", null, 6, 1, 0, 9.2],
  ["phase2a-preview-accepted", "phase2a-preview-other-member", "Radio Tower Finals", "An accepted creator-reviewed event suggestion ready for draft conversion checks.", "clan_squad", "playstation", "Chernarus", null, 1, "accepted", "accepted", null, 8, 2, 0, 10.4],
  ["phase2a-preview-converted-private-draft", "phase2a-preview-member", "Private Draft Conversion", "A converted suggestion linked to a private draft that must stay hidden publicly.", "server_vs_server", "cross_platform", "Chernarus", null, 1, "converted_to_event", "converted_to_event", "phase2a-preview-private-draft-event", 9, 1, 0, 12.0],
  ["phase2a-preview-reported", "phase2a-preview-other-member", "Reported But Not Promoted", "A public suggestion with an internal report count that must not be exposed publicly.", "manual_referee", "pc", "Namalsk", null, 1, "public_voting", "public_voting", null, 1, 1, 1, 1.0],
  ["phase2a-preview-tie-a", "phase2a-preview-member", "Tie Break Alpha", "Equal score cursor pagination fixture alpha with deterministic ordering.", "stat_race", "pc", "Chernarus", null, 1, "public_voting", "public_voting", null, 3, 0, 0, 5.0],
  ["phase2a-preview-tie-b", "phase2a-preview-other-member", "Tie Break Bravo", "Equal score cursor pagination fixture bravo with deterministic ordering.", "stat_race", "pc", "Chernarus", null, 1, "public_voting", "public_voting", null, 3, 0, 0, 5.0],
  ["phase2a-preview-server-linked", "phase2a-preview-member", "Nuketown Server Trial", "A public suggestion linked through a public server slug instead of an internal browser ID.", "server_vs_server", "cross_platform", "Chernarus", serverSubquery, 0, "public_voting", "public_voting", null, 2, 0, 0, 4.5],
  ["phase2a-preview-visible-server-suggestion", "phase2a-preview-member", "Visible Server Projection", "A public suggestion linked to a currently public server whose display identity may remain public.", "server_vs_server", "cross_platform", "Chernarus", publicSuggestionServerSubquery, 0, "public_voting", "public_voting", null, 2, 0, 0, 4.4],
  ["phase2a-preview-hidden-server-suggestion", "phase2a-preview-member", "Hidden Server Projection", "A public suggestion linked to a server that is hidden after submission and must not leak its identity.", "server_vs_server", "cross_platform", "Chernarus", hiddenSuggestionServerSubquery, 0, "public_voting", "public_voting", null, 2, 0, 0, 4.3],
  ["phase2a-preview-merged-server-suggestion", "phase2a-preview-member", "Merged Server Projection", "A public suggestion linked to a merged server and must not leak its old or target identity.", "server_vs_server", "cross_platform", "Chernarus", mergedSuggestionServerSubquery, 0, "public_voting", "public_voting", null, 2, 0, 0, 4.2],
  ["phase2a-preview-open-any", "phase2a-preview-other-member", "Open Host Challenge", "An open-to-any-server suggestion for route and filter coverage.", "community_challenge", "unsure", "Any official map", null, 1, "accepted", "accepted", null, 5, 0, 0, 7.5],
  [conversionTargetId, "phase2a-preview-other-member", `Verifier Conversion Target ${runKey}`, "A deterministic run-scoped shortlisted suggestion reserved for the preview verifier conversion sequence and concurrency checks.", "community_challenge", "pc", "Chernarus", null, 1, "shortlisted", "shortlisted", null, 0, 0, 0, 6.25],
];
const ownerPlaceholders = ownerIds.length > 0 ? ownerIds.map(() => "?").join(", ") : "NULL";
const ownerValues = ownerIds.map(sql).join(", ");
fs.writeFileSync("phase2a-session-verification.sql", `
SELECT
  (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-owner-session' AND user_id = 'owner-console-platform-owner' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS ownerSessionValid,
  (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-creator-session' AND user_id = 'owner-console-platform-creator' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS creatorSessionValid,
  (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-non-owner-session' AND user_id = 'owner-console-non-owner-user' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS apiVerifierSessionValid,
  (SELECT COUNT(*) FROM users WHERE id = 'owner-console-non-owner-user') AS apiVerifierUserPresent,
  (SELECT COUNT(*) FROM users WHERE id = 'owner-console-non-owner-user' AND discord_id IN (${ownerValues || "NULL"})) AS apiVerifierOwnerMatches,
  (SELECT COUNT(*) FROM users WHERE id = 'owner-console-non-owner-user' AND discord_id = ${sql(creatorId)}) AS apiVerifierCreatorMatches,
  (SELECT COUNT(*) FROM event_suggestions WHERE submitted_by_user_id = 'owner-console-non-owner-user' AND converted_event_id IS NOT NULL) AS unexpectedConvertedVerifierRows,
  (SELECT COUNT(*) FROM linked_servers WHERE id = ${sql(creatorHostId)} AND (user_id IS NULL OR user_id != 'owner-console-platform-creator')) AS creatorHostOwnershipCollision,
  (SELECT COUNT(*) FROM linked_servers WHERE id = ${sql(foreignHostId)} AND (user_id IS NULL OR user_id != 'phase2a-preview-member')) AS foreignHostOwnershipCollision;
`.trim());
fs.writeFileSync("phase2a-protected-row-preflight.sql", `
SELECT
  (SELECT COUNT(*) FROM sessions) AS sessionCountBefore,
  (SELECT COUNT(*) FROM competitive_events) AS competitiveEventCountBefore,
  (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-owner-session' AND user_id = 'owner-console-platform-owner' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS ownerSessionValid,
  (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-creator-session' AND user_id = 'owner-console-platform-creator' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS creatorSessionValid,
  (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-non-owner-session' AND user_id = 'owner-console-non-owner-user' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS apiVerifierSessionValid,
  (SELECT COUNT(*) FROM event_suggestions WHERE id = ${sql(conversionTargetId)}) AS runScopedSuggestionCountBefore,
  (SELECT COUNT(*) FROM competitive_events WHERE id = ${sql(conversionTargetEventId)}) AS runScopedEventCountBefore,
  (SELECT COUNT(*) FROM competitive_event_activity WHERE event_id = ${sql(conversionTargetEventId)}) AS runScopedActivityCountBefore,
  (SELECT COUNT(*) FROM event_suggestion_moderation_actions WHERE suggestion_id = ${sql(conversionTargetId)}) AS runScopedActionCountBefore;
`.trim());
fs.writeFileSync("dzn-event-platform-performance-preview/seed-summary.json", JSON.stringify({
  knownGoodExistingMemberSessionChecked: true,
  canonicalSessionsVerifiedReadOnly: true,
  obsoletePreviewSessionLeftUntouched: true,
  sessionRowsInserted: 0,
  sessionRowsUpdated: 0,
  sessionRowsDeleted: 0,
  runScopedConversionTarget: conversionTargetId,
  runScopedConversionEventId: conversionTargetEventId,
  creatorOwnedHostFixtureChecked: true,
  foreignOwnedHostFixtureChecked: true,
  hostAuthorizationFixturesUpsertedNonDestructively: true,
  apiVerifierSuggestionRowsReset: true,
  noSessionHashCreated: true,
  noPagesSecretChanged: true,
}, null, 2));
const statements = [];
statements.push("PRAGMA foreign_keys = ON;");
statements.push(`DELETE FROM event_suggestion_moderation_actions WHERE suggestion_id IN (SELECT id FROM event_suggestions WHERE submitted_by_user_id = ${sql(apiMemberId)} AND converted_event_id IS NULL);`);
statements.push(`DELETE FROM event_suggestion_reports WHERE suggestion_id IN (SELECT id FROM event_suggestions WHERE submitted_by_user_id = ${sql(apiMemberId)} AND converted_event_id IS NULL);`);
statements.push(`DELETE FROM event_suggestion_votes WHERE suggestion_id IN (SELECT id FROM event_suggestions WHERE submitted_by_user_id = ${sql(apiMemberId)} AND converted_event_id IS NULL);`);
statements.push(`DELETE FROM event_suggestion_servers WHERE suggestion_id IN (SELECT id FROM event_suggestions WHERE submitted_by_user_id = ${sql(apiMemberId)} AND converted_event_id IS NULL);`);
statements.push(`DELETE FROM event_suggestions WHERE submitted_by_user_id = ${sql(apiMemberId)} AND converted_event_id IS NULL;`);
for (const [id, discordId, username] of users) {
  statements.push(`INSERT INTO users (id, discord_id, username, avatar, created_at, updated_at) VALUES (${sql(id)}, ${sql(discordId)}, ${sql(username)}, NULL, ${sql(now)}, ${sql(now)}) ON CONFLICT(id) DO UPDATE SET discord_id = excluded.discord_id, username = excluded.username, updated_at = excluded.updated_at;`);
}
const hostGuilds = [
  ["phase2a-preview-creator-host-guild-row", "phase2a-preview-creator-host-guild", "owner-console-platform-creator", "Phase2A Creator Host Guild"],
  ["phase2a-preview-foreign-host-guild-row", "phase2a-preview-foreign-host-guild", "phase2a-preview-member", "Phase2A Foreign Host Guild"],
];
for (const [id, guildId, ownerUserId, name] of hostGuilds) {
  statements.push(`INSERT INTO discord_guilds (id, guild_id, owner_user_id, name, icon, icon_url, permissions, is_owner, created_at, updated_at) VALUES (${sql(id)}, ${sql(guildId)}, ${sql(ownerUserId)}, ${sql(name)}, NULL, NULL, '8', 1, ${sql(now)}, ${sql(now)}) ON CONFLICT(guild_id) DO UPDATE SET owner_user_id = excluded.owner_user_id, name = excluded.name, updated_at = excluded.updated_at;`);
}
const hostServers = [
  [creatorHostId, "owner-console-platform-creator", "phase2a-preview-creator-host-guild", "phase2a-preview-creator-host-guild-row", "9900002001", "Phase2A Creator Host", "phase2a-preview-creator-host", "pro", "active", "deathmatch"],
  [foreignHostId, "phase2a-preview-member", "phase2a-preview-foreign-host-guild", "phase2a-preview-foreign-host-guild-row", "9900002002", "Phase2A Foreign Host", "phase2a-preview-foreign-host", "premium", "active", "deathmatch"],
];
for (const [id, userId, guildId, discordGuildId, serviceId, name, slug, planKey, status, category] of hostServers) {
  statements.push(`INSERT INTO linked_servers (id, user_id, guild_id, discord_guild_id, nitrado_service_id, nitrado_service_name, server_name, display_name, hostname, server_type, server_category, tags_json, region, status, public_slug, listing_visibility, lifecycle_status, lifecycle_reason, lifecycle_updated_at, created_at, updated_at) VALUES (${sql(id)}, ${sql(userId)}, ${sql(guildId)}, ${sql(discordGuildId)}, ${sql(serviceId)}, ${sql(name)}, ${sql(name)}, ${sql(name)}, ${sql(name)}, 'DEATHMATCH', ${sql(category)}, ${sql(JSON.stringify(["deathmatch", "phase2a-preview"]))}, 'EU', 'live', ${sql(slug)}, 'public', 'active_live', 'phase2a_host_authorization_fixture', ${sql(now)}, ${sql(now)}, ${sql(now)}) ON CONFLICT(id) DO UPDATE SET guild_id = excluded.guild_id, discord_guild_id = excluded.discord_guild_id, nitrado_service_id = excluded.nitrado_service_id, nitrado_service_name = excluded.nitrado_service_name, server_name = excluded.server_name, display_name = excluded.display_name, hostname = excluded.hostname, server_type = excluded.server_type, server_category = excluded.server_category, tags_json = excluded.tags_json, region = excluded.region, status = excluded.status, public_slug = excluded.public_slug, listing_visibility = excluded.listing_visibility, lifecycle_status = excluded.lifecycle_status, lifecycle_reason = excluded.lifecycle_reason, lifecycle_updated_at = excluded.lifecycle_updated_at, updated_at = excluded.updated_at;`);
  statements.push(`INSERT INTO server_subscriptions (id, guild_id, owner_discord_id, plan_key, status, created_at, updated_at) VALUES (${sql(`${id}-subscription`)}, ${sql(guildId)}, ${userId === "owner-console-platform-creator" ? sql(creatorId) : sql("990000000000002001")}, ${sql(planKey)}, ${sql(status)}, ${sql(now)}, ${sql(now)}) ON CONFLICT(guild_id) DO UPDATE SET owner_discord_id = excluded.owner_discord_id, plan_key = excluded.plan_key, status = excluded.status, updated_at = excluded.updated_at;`);
}
const visibilityServers = [
  ["phase2a-preview-public-suggestion-server", "phase2a-preview-public-suggestion-guild", "Phase2A Public Suggestion Server", "phase2a-preview-public-suggestion-server", "live", "public", null],
  ["phase2a-preview-hidden-suggestion-server", "phase2a-preview-hidden-suggestion-guild", "Phase2A Hidden Suggestion Server", "phase2a-preview-hidden-suggestion-server", "live", "hidden", null],
  ["phase2a-preview-merged-suggestion-server", "phase2a-preview-merged-suggestion-guild", "Phase2A Merged Suggestion Server", "phase2a-preview-merged-suggestion-server", "merged", "public", "phase2a-preview-public-suggestion-server"],
];
for (const [id, guildId, name, slug, status, listingVisibility, mergedInto] of visibilityServers) {
  statements.push(`INSERT INTO discord_guilds (id, guild_id, owner_user_id, name, icon, icon_url, permissions, is_owner, created_at, updated_at) VALUES (${sql(`${id}-guild-row`)}, ${sql(guildId)}, ${sql("phase2a-preview-member")}, ${sql(name)}, NULL, NULL, '8', 1, ${sql(now)}, ${sql(now)}) ON CONFLICT(guild_id) DO UPDATE SET owner_user_id = excluded.owner_user_id, name = excluded.name, updated_at = excluded.updated_at;`);
  statements.push(`INSERT INTO linked_servers (id, user_id, guild_id, discord_guild_id, nitrado_service_id, nitrado_service_name, server_name, display_name, hostname, server_type, server_category, tags_json, region, status, public_slug, listing_visibility, merged_into_server_id, lifecycle_status, lifecycle_reason, lifecycle_updated_at, created_at, updated_at) VALUES (${sql(id)}, ${sql("phase2a-preview-member")}, ${sql(guildId)}, ${sql(`${id}-guild-row`)}, ${sql(`${id}-service`)}, ${sql(name)}, ${sql(name)}, ${sql(name)}, ${sql(name)}, 'DEATHMATCH', 'deathmatch', ${sql(JSON.stringify(["deathmatch", "phase2a-preview"]))}, 'EU', ${sql(status)}, ${sql(slug)}, ${sql(listingVisibility)}, ${mergedInto ? sql(mergedInto) : "NULL"}, 'active_live', 'phase2a_suggestion_visibility_fixture', ${sql(now)}, ${sql(now)}, ${sql(now)}) ON CONFLICT(id) DO UPDATE SET guild_id = excluded.guild_id, discord_guild_id = excluded.discord_guild_id, nitrado_service_id = excluded.nitrado_service_id, nitrado_service_name = excluded.nitrado_service_name, server_name = excluded.server_name, display_name = excluded.display_name, hostname = excluded.hostname, server_type = excluded.server_type, server_category = excluded.server_category, tags_json = excluded.tags_json, region = excluded.region, status = excluded.status, public_slug = excluded.public_slug, listing_visibility = excluded.listing_visibility, merged_into_server_id = excluded.merged_into_server_id, lifecycle_status = excluded.lifecycle_status, lifecycle_reason = excluded.lifecycle_reason, lifecycle_updated_at = excluded.lifecycle_updated_at, updated_at = excluded.updated_at;`);
}
const eventFixtures = [
  ["phase2a-preview-private-draft-event", "Phase 2A Private Draft", "phase2a-preview-private-draft", "Private draft converted from a preview suggestion; not public.", "deathmatch", "community_cup", "draft", "private", "pro", "Draft rules pending creator review.", null],
  ["phase2a-preview-public-draft-event", "Phase 2A Public Draft Fixture", "phase2a-preview-public-draft", "Public visibility draft fixture that must never appear in public event lists.", "deathmatch", "community_cup", "draft", "public", "pro", "Draft rules are private until creator publication.", "Draft rewards are private until creator publication."],
  ["phase2a-preview-unlisted-draft-event", "Phase 2A Unlisted Draft Fixture", "phase2a-preview-unlisted-draft", "Unlisted draft fixture that must never appear in public event lists.", "deathmatch", "community_cup", "draft", "unlisted", "pro", "Unlisted draft rules are private until creator publication.", "Unlisted draft rewards are private until creator publication."],
  ["phase2a-preview-public-live-event", "Phase 2A Public Live Fixture", "phase2a-preview-public-live", "A public non-draft fixture for cache and public listing verification.", "deathmatch", "community_cup", "live", "public", "pro", "Public fixture rules.", "Public fixture rewards."],
  ["phase2a-preview-unlisted-live-event", "Phase 2A Unlisted Live Fixture", "phase2a-preview-unlisted-live", "An unlisted non-draft fixture that remains eligible for public list behaviour under the current contract.", "deathmatch", "community_cup", "upcoming", "unlisted", "pro", "Unlisted fixture rules.", "Unlisted fixture rewards."],
];
for (const [id, name, slug, description, category, eventType, status, visibility, tier, rules, rewards] of eventFixtures) {
  statements.push(`INSERT INTO competitive_events (id, name, slug, description, category, event_type, status, visibility, premium_tier, starts_at, ends_at, created_by, rules, rewards, created_at, updated_at) VALUES (${sql(id)}, ${sql(name)}, ${sql(slug)}, ${sql(description)}, ${sql(category)}, ${sql(eventType)}, ${sql(status)}, ${sql(visibility)}, ${sql(tier)}, ${sql("2026-08-10T18:00:00.000Z")}, ${sql("2026-08-10T21:00:00.000Z")}, ${sql("phase2a-preview-creator")}, ${sql(rules)}, ${rewards ? sql(rewards) : "NULL"}, ${sql(now)}, ${sql(now)}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, description = excluded.description, category = excluded.category, event_type = excluded.event_type, status = excluded.status, visibility = excluded.visibility, premium_tier = excluded.premium_tier, starts_at = excluded.starts_at, ends_at = excluded.ends_at, rules = excluded.rules, rewards = excluded.rewards, updated_at = excluded.updated_at;`);
}
for (const [id, userId, title, description, format, platform, map, serverExpression, openToAny, moderationStatus, publicStatus, convertedEventId, upvotes, downvotes, reports, hotScore] of suggestions) {
  const normalized = String(title).toLowerCase();
  const serverSql = typeof serverExpression === "string" && serverExpression.startsWith("(") ? serverExpression : "NULL";
  statements.push(`INSERT INTO event_suggestions (id, submitted_by_user_id, title, description, normalized_title, content_fingerprint, competition_format, platform, map_name, suggested_server_id, open_to_any_server, suggested_date_start, suggested_date_end, structure_notes, moderation_status, public_status, creator_decision, converted_event_id, creator_response, upvote_count, downvote_count, report_count, hot_score, created_at, updated_at, published_at, moderated_at) VALUES (${sql(id)}, ${sql(userId)}, ${sql(title)}, ${sql(description)}, ${sql(normalized)}, ${sql(`phase2a:${id}`)}, ${sql(format)}, ${sql(platform)}, ${sql(map)}, ${serverSql}, ${Number(openToAny)}, ${sql("2026-08-10T18:00:00.000Z")}, ${sql("2026-08-10T21:00:00.000Z")}, ${sql("Preview fixture structure notes.")}, ${sql(moderationStatus)}, ${sql(publicStatus)}, ${convertedEventId ? sql("converted_to_event") : "NULL"}, ${convertedEventId ? sql(convertedEventId) : "NULL"}, ${publicStatus === "accepted" || publicStatus === "converted_to_event" ? sql("Creator reviewed for preview.") : "NULL"}, ${Number(upvotes)}, ${Number(downvotes)}, ${Number(reports)}, ${Number(hotScore)}, ${sql(now)}, ${sql(now)}, ${["public_voting", "shortlisted", "accepted", "converted_to_event"].includes(publicStatus) ? sql(now) : "NULL"}, ${["shortlisted", "accepted", "converted_to_event"].includes(moderationStatus) ? sql(now) : "NULL"}) ON CONFLICT(id) DO UPDATE SET submitted_by_user_id = excluded.submitted_by_user_id, title = excluded.title, description = excluded.description, normalized_title = excluded.normalized_title, content_fingerprint = excluded.content_fingerprint, competition_format = excluded.competition_format, platform = excluded.platform, map_name = excluded.map_name, suggested_server_id = excluded.suggested_server_id, open_to_any_server = excluded.open_to_any_server, suggested_date_start = excluded.suggested_date_start, suggested_date_end = excluded.suggested_date_end, structure_notes = excluded.structure_notes, moderation_status = excluded.moderation_status, public_status = excluded.public_status, creator_decision = excluded.creator_decision, converted_event_id = excluded.converted_event_id, creator_response = excluded.creator_response, upvote_count = excluded.upvote_count, downvote_count = excluded.downvote_count, report_count = excluded.report_count, hot_score = excluded.hot_score, updated_at = excluded.updated_at, published_at = excluded.published_at, moderated_at = excluded.moderated_at;`);
}
statements.push(`INSERT OR IGNORE INTO event_suggestion_servers (suggestion_id, linked_server_id, relationship_type, created_at) SELECT ${sql("phase2a-preview-server-linked")}, id, 'suggested', ${sql(now)} FROM linked_servers WHERE public_slug = 'owner-console-nuketown' OR id = 'owner-console-nuketown' LIMIT 1;`);
statements.push(`INSERT INTO event_suggestion_votes (suggestion_id, user_id, vote_value, created_at, updated_at) VALUES (${sql("phase2a-preview-public-voting")}, ${sql("phase2a-preview-member")}, 1, ${sql(now)}, ${sql(now)}) ON CONFLICT(suggestion_id, user_id) DO UPDATE SET vote_value = excluded.vote_value, updated_at = excluded.updated_at;`);
statements.push(`INSERT INTO event_suggestion_votes (suggestion_id, user_id, vote_value, created_at, updated_at) VALUES (${sql("phase2a-preview-reported")}, ${sql("phase2a-preview-member")}, -1, ${sql(now)}, ${sql(now)}) ON CONFLICT(suggestion_id, user_id) DO UPDATE SET vote_value = excluded.vote_value, updated_at = excluded.updated_at;`);
statements.push(`INSERT OR IGNORE INTO event_suggestion_reports (id, suggestion_id, reporter_user_id, reason, safe_note, status, created_at) VALUES (${sql("phase2a-preview-report-open")}, ${sql("phase2a-preview-reported")}, ${sql("phase2a-preview-member")}, 'spam', ${sql("Preview moderation-only report note.")}, 'open', ${sql(now)});`);
statements.push(`INSERT OR IGNORE INTO competitive_event_activity (id, event_id, server_id, activity_type, message, metadata, created_at) VALUES (${sql("phase2a-preview-public-live-activity")}, ${sql("phase2a-preview-public-live-event")}, NULL, 'event_created', ${sql("Phase 2A public live fixture activity.")}, ${sql(JSON.stringify({ fixture: "phase2a-public-live" }))}, ${sql(now)});`);
statements.push(`INSERT OR IGNORE INTO competitive_event_activity (id, event_id, server_id, activity_type, message, metadata, created_at) VALUES (${sql("phase2a-preview-conversion-activity")}, ${sql("phase2a-preview-private-draft-event")}, NULL, 'suggestion_converted_to_draft', ${sql("Community suggestion converted to draft for preview.")}, ${sql(JSON.stringify({ suggestion_id: "phase2a-preview-converted-private-draft" }))}, ${sql(now)});`);
statements.push(`INSERT OR IGNORE INTO event_suggestion_moderation_actions (id, suggestion_id, actor_user_id, action, previous_status, new_status, safe_reason, created_at) VALUES (${sql("phase2a-preview-conversion-action")}, ${sql("phase2a-preview-converted-private-draft")}, ${sql("phase2a-preview-creator")}, 'convert_to_event_draft', 'accepted', 'converted_to_event', ${sql("Preview conversion audit.")}, ${sql(now)});`);
fs.writeFileSync("phase2a-preview-seed.sql", `${statements.join("\n")}\n`);
NODE

VERIFY_SESSION_SQL="$(cat phase2a-session-verification.sql)"
npx wrangler d1 execute DB \
  --config wrangler.event-platform-performance-preview.toml \
  --remote \
  --json \
  --command "${VERIFY_SESSION_SQL}" \
  > dzn-event-platform-performance-preview/session-verification-raw.json \
  2> dzn-event-platform-performance-preview/session-verification.stderr.log
PROTECTED_ROW_PREFLIGHT_SQL="$(cat phase2a-protected-row-preflight.sql)"
npx wrangler d1 execute DB \
  --config wrangler.event-platform-performance-preview.toml \
  --remote \
  --json \
  --command "${PROTECTED_ROW_PREFLIGHT_SQL}" \
  > dzn-event-platform-performance-preview/protected-row-invariants-before.json \
  2> dzn-event-platform-performance-preview/protected-row-invariants-before.stderr.log

node <<'NODE'
const fs = require("node:fs");
function fail(category, message) {
  fs.writeFileSync("dzn-event-platform-performance-preview/failure-summary.json", JSON.stringify({
    ok: false,
    category,
    message,
    stage: "sessionVerification",
    branch: process.env.CANDIDATE_BRANCH,
    commit: process.env.CANDIDATE_SHA,
    mode: "event-platform-performance-preview",
  }, null, 2));
  console.error(message);
  process.exit(1);
}
function parse(path) {
  const raw = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "").trimStart();
  if (!raw || !["[", "{"].includes(raw[0])) fail("PHASE2A_VERIFIED_MEMBER_SESSION_UNAVAILABLE", `Malformed Wrangler JSON in ${path}.`);
  return JSON.parse(raw);
}
function rows(path) {
  const parsed = parse(path);
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => item?.results ?? item?.result?.[0]?.results ?? item?.result?.results ?? []);
}
const row = rows("dzn-event-platform-performance-preview/session-verification-raw.json")[0] || {};
const protectedRow = rows("dzn-event-platform-performance-preview/protected-row-invariants-before.json")[0] || {};
const summary = {
  ownerSessionPresent: Number(row.ownerSessionValid || 0) === 1,
  creatorSessionPresent: Number(row.creatorSessionValid || 0) === 1,
  apiVerifierSessionPresent: Number(row.apiVerifierSessionValid || 0) === 1,
  apiVerifierUserPresent: Number(row.apiVerifierUserPresent || 0) === 1,
  apiVerifierSessionUnexpired: Number(row.apiVerifierSessionValid || 0) === 1,
  apiVerifierIsPlatformOwner: Number(row.apiVerifierOwnerMatches || 0) > 0,
  apiVerifierIsPlatformCreator: Number(row.apiVerifierCreatorMatches || 0) > 0,
  expectedUserMappingsValid: Number(row.ownerSessionValid || 0) === 1 && Number(row.creatorSessionValid || 0) === 1 && Number(row.apiVerifierSessionValid || 0) === 1,
  noSecretRotationPerformed: true,
  obsoletePreviewSessionLeftUntouched: true,
  sessionRowsInserted: 0,
  sessionRowsUpdated: 0,
  sessionRowsDeleted: 0,
};
fs.writeFileSync("dzn-event-platform-performance-preview/session-verification.json", JSON.stringify(summary, null, 2));
if (Number(row.unexpectedConvertedVerifierRows || 0) !== 0) {
  fail("PHASE2A_API_VERIFIER_UNEXPECTED_CONVERTED_ROW", "Existing API verifier suggestion has a converted event; refusing broad cleanup.");
}
if (Number(row.creatorHostOwnershipCollision || 0) !== 0 || Number(row.foreignHostOwnershipCollision || 0) !== 0) {
  fail("PHASE2A_HOST_AUTH_FIXTURE_COLLISION", "Phase 2A host authorization fixture has unexpected ownership; refusing non-destructive upsert.");
}
if (!summary.ownerSessionPresent || !summary.creatorSessionPresent || !summary.apiVerifierSessionPresent || !summary.apiVerifierUserPresent || summary.apiVerifierIsPlatformOwner || summary.apiVerifierIsPlatformCreator) {
  fail("PHASE2A_VERIFIED_MEMBER_SESSION_UNAVAILABLE", "Known-good Phase 2A preview member session is unavailable or role-unsafe.");
}
const collisionCounts = {
  runScopedSuggestionCountBefore: Number(protectedRow.runScopedSuggestionCountBefore || 0),
  runScopedEventCountBefore: Number(protectedRow.runScopedEventCountBefore || 0),
  runScopedActivityCountBefore: Number(protectedRow.runScopedActivityCountBefore || 0),
  runScopedActionCountBefore: Number(protectedRow.runScopedActionCountBefore || 0),
};
if (Object.values(collisionCounts).some((count) => count !== 0)) {
  fail("PHASE2A_RUN_SCOPED_FIXTURE_COLLISION", `Run-scoped Phase 2A conversion fixture already exists: ${JSON.stringify(collisionCounts)}`);
}
fs.writeFileSync("dzn-event-platform-performance-preview/protected-row-invariants.json", JSON.stringify({
  sessionCountBefore: Number(protectedRow.sessionCountBefore || 0),
  sessionCountAfterSeed: null,
  sessionCountUnchanged: null,
  requiredSessionMappingsValid: summary.expectedUserMappingsValid,
  competitiveEventCountBefore: Number(protectedRow.competitiveEventCountBefore || 0),
  competitiveEventCountAfterSeed: null,
  competitiveEventCountDidNotDecrease: null,
  runScopedSuggestionCountBefore: collisionCounts.runScopedSuggestionCountBefore,
  runScopedEventCountBefore: collisionCounts.runScopedEventCountBefore,
  runScopedActivityCountBefore: collisionCounts.runScopedActivityCountBefore,
  runScopedActionCountBefore: collisionCounts.runScopedActionCountBefore,
  runScopedSuggestionCountAfterSeed: null,
  runScopedEventCountAfterSeed: null,
  protectedSessionDeleteStatements: 0,
  protectedEventDeleteStatements: 0,
}, null, 2));
console.log("Phase 2A known-good preview session verification passed.");
NODE

node <<'NODE'
const fs = require("node:fs");
const sqlText = fs.readFileSync("phase2a-preview-seed.sql", "utf8");
const checks = [
  { pattern: /\bDELETE\s+FROM\s+sessions\b/i, category: "PHASE2A_PROTECTED_SESSION_MUTATION_BLOCKED", table: "sessions", type: "DELETE" },
  { pattern: /\bDELETE\s+FROM\s+competitive_events\b/i, category: "PHASE2A_PROTECTED_EVENT_MUTATION_BLOCKED", table: "competitive_events", type: "DELETE" },
  { pattern: /\bTRUNCATE\b/i, category: "PHASE2A_DESTRUCTIVE_SEED_SQL_BLOCKED", table: "unknown", type: "TRUNCATE" },
  { pattern: /\bDROP\s+TABLE\b/i, category: "PHASE2A_DESTRUCTIVE_SEED_SQL_BLOCKED", table: "unknown", type: "DROP_TABLE" },
  { pattern: /\bDROP\s+INDEX\b/i, category: "PHASE2A_DESTRUCTIVE_SEED_SQL_BLOCKED", table: "unknown", type: "DROP_INDEX" },
  { pattern: /\bALTER\s+TABLE\s+sessions\b/i, category: "PHASE2A_PROTECTED_SESSION_MUTATION_BLOCKED", table: "sessions", type: "ALTER_TABLE" },
  { pattern: /\bALTER\s+TABLE\s+competitive_events\b/i, category: "PHASE2A_PROTECTED_EVENT_MUTATION_BLOCKED", table: "competitive_events", type: "ALTER_TABLE" },
];
for (const check of checks) {
  if (!check.pattern.test(sqlText)) continue;
  fs.writeFileSync("dzn-event-platform-performance-preview/failure-summary.json", JSON.stringify({
    ok: false,
    category: check.category,
    message: "Protected or destructive Phase 2A seed SQL was blocked before remote execution.",
    stage: "seedSqlSafetyScan",
    protectedTable: check.table,
    statementType: check.type,
    mode: "event-platform-performance-preview",
    branch: process.env.CANDIDATE_BRANCH,
    commit: process.env.CANDIDATE_SHA,
  }, null, 2));
  console.error(`${check.category}: protected table=${check.table}; statement=${check.type}; seed SQL not printed.`);
  process.exit(1);
}
console.log("Phase 2A generated seed SQL safety scan passed.");
NODE

npx wrangler d1 execute DB \
  --config wrangler.event-platform-performance-preview.toml \
  --remote \
  --file phase2a-preview-seed.sql \
  | tee dzn-event-platform-performance-preview/seed.txt
npx wrangler d1 execute DB \
  --config wrangler.event-platform-performance-preview.toml \
  --remote \
  --json \
  --command "SELECT (SELECT COUNT(*) FROM sessions) AS sessionCountAfterSeed, (SELECT COUNT(*) FROM competitive_events) AS competitiveEventCountAfterSeed, (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-owner-session' AND user_id = 'owner-console-platform-owner' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS ownerSessionValid, (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-creator-session' AND user_id = 'owner-console-platform-creator' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS creatorSessionValid, (SELECT COUNT(*) FROM sessions WHERE id = 'owner-console-non-owner-session' AND user_id = 'owner-console-non-owner-user' AND COALESCE(session_token_hash, '') <> '' AND datetime(expires_at) > datetime('now')) AS apiVerifierSessionValid, (SELECT COUNT(*) FROM event_suggestions WHERE id = '${PHASE2A_CONVERSION_TARGET_ID}') AS runScopedSuggestionCountAfterSeed, (SELECT COUNT(*) FROM competitive_events WHERE id = '${PHASE2A_CONVERSION_EVENT_ID}') AS runScopedEventCountAfterSeed;" \
  > dzn-event-platform-performance-preview/protected-row-invariants-after-seed.json \
  2> dzn-event-platform-performance-preview/protected-row-invariants-after-seed.stderr.log
node <<'NODE'
const fs = require("node:fs");
function fail(category, message) {
  fs.writeFileSync("dzn-event-platform-performance-preview/failure-summary.json", JSON.stringify({
    ok: false,
    category,
    message,
    stage: "protectedRowInvariantsAfterSeed",
    branch: process.env.CANDIDATE_BRANCH,
    commit: process.env.CANDIDATE_SHA,
    mode: "event-platform-performance-preview",
  }, null, 2));
  console.error(message);
  process.exit(1);
}
function parse(path) {
  const raw = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "").trimStart();
  if (!raw || !["[", "{"].includes(raw[0])) fail("PHASE2A_D1_FINAL_VERIFICATION_FAILED", `Malformed Wrangler JSON in ${path}.`);
  return JSON.parse(raw);
}
function rows(path) {
  const parsed = parse(path);
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => item?.results ?? item?.result?.[0]?.results ?? item?.result?.results ?? []);
}
const invariantPath = "dzn-event-platform-performance-preview/protected-row-invariants.json";
const invariants = JSON.parse(fs.readFileSync(invariantPath, "utf8"));
const after = rows("dzn-event-platform-performance-preview/protected-row-invariants-after-seed.json")[0] || {};
invariants.sessionCountAfterSeed = Number(after.sessionCountAfterSeed || 0);
invariants.sessionCountUnchanged = invariants.sessionCountAfterSeed === Number(invariants.sessionCountBefore || 0);
invariants.requiredSessionMappingsValid =
  invariants.requiredSessionMappingsValid &&
  Number(after.ownerSessionValid || 0) === 1 &&
  Number(after.creatorSessionValid || 0) === 1 &&
  Number(after.apiVerifierSessionValid || 0) === 1;
invariants.competitiveEventCountAfterSeed = Number(after.competitiveEventCountAfterSeed || 0);
invariants.competitiveEventCountDidNotDecrease = invariants.competitiveEventCountAfterSeed >= Number(invariants.competitiveEventCountBefore || 0);
invariants.runScopedSuggestionCountAfterSeed = Number(after.runScopedSuggestionCountAfterSeed || 0);
invariants.runScopedEventCountAfterSeed = Number(after.runScopedEventCountAfterSeed || 0);
if (!invariants.sessionCountUnchanged || !invariants.requiredSessionMappingsValid || !invariants.competitiveEventCountDidNotDecrease || invariants.runScopedSuggestionCountAfterSeed !== 1 || invariants.runScopedEventCountAfterSeed !== 0) {
  fail("PHASE2A_D1_FINAL_VERIFICATION_FAILED", "Protected row invariants failed after Phase 2A seed.");
}
fs.writeFileSync(invariantPath, JSON.stringify(invariants, null, 2));
console.log("Phase 2A protected row invariants after seed passed.");
NODE
npx wrangler d1 execute DB \
  --config wrangler.event-platform-performance-preview.toml \
  --remote \
  --json \
  --command "SELECT COUNT(*) AS suggestion_count FROM event_suggestions WHERE id LIKE 'phase2a-preview-%'; SELECT COUNT(*) AS linked_server_count FROM event_suggestion_servers WHERE suggestion_id = 'phase2a-preview-server-linked'; SELECT COUNT(*) AS private_draft_count FROM competitive_events WHERE id = 'phase2a-preview-private-draft-event' AND status = 'draft' AND visibility = 'private'; SELECT COUNT(*) AS open_report_count FROM event_suggestion_reports WHERE suggestion_id = 'phase2a-preview-reported' AND status = 'open'; SELECT COUNT(*) AS vote_count FROM event_suggestion_votes WHERE suggestion_id LIKE 'phase2a-preview-%'; SELECT COUNT(*) AS conversion_activity_count FROM competitive_event_activity WHERE id = 'phase2a-preview-conversion-activity'; SELECT COUNT(*) AS conversion_action_count FROM event_suggestion_moderation_actions WHERE id = 'phase2a-preview-conversion-action'; PRAGMA foreign_key_check;" \
  > dzn-event-platform-performance-preview/d1-verification.json \
  2> dzn-event-platform-performance-preview/d1-verification.stderr.log
